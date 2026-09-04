/**
 * Clipboard sniffing for the homepage search box.
 *
 * Designer's constraint: never take over the screen on a guess. This returns
 * ranked *candidates* that get offered as rows in the search dropdown, and an
 * empty list falls back to plain name search. Precision beats recall — a wrong
 * confident guess is worse than no guess.
 */

export interface Candidate {
  slug: string;
  label: string;
  /** Prefill for the tool's primary field. */
  value: string;
  /** Extra query params to preset (e.g. direction=decode). */
  params?: Record<string, string>;
  score: number;
}

const b64ish = /^[A-Za-z0-9+/\-_]+={0,2}$/;

function tryB64(s: string): string | null {
  let x = s.replace(/-/g, '+').replace(/_/g, '/');
  while (x.length % 4) x += '=';
  try {
    const bin = atob(x);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // reject control-character soup: that means it decoded to binary, not text
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

export function sniff(raw: string): Candidate[] {
  const s = raw.trim();
  const out: Candidate[] = [];
  // 4 is the shortest unambiguous payload we accept: `#fff`.
  if (s.length < 4) return out;

  // JWT — three base64url segments, first decodes to JSON with "alg"
  const parts = s.replace(/^Bearer\s+/i, '').split('.');
  if (parts.length === 3 && parts.every((p) => b64ish.test(p))) {
    const head = tryB64(parts[0]!);
    if (head && /"alg"/.test(head)) {
      out.push({ slug: 'jwt', label: 'JWT — 解码 header 与 payload', value: s, score: 100 });
    }
  }

  // JSON — needs at least a bracket pair, so it can't fire on a lone `{`
  if (/^[[{]/.test(s) && s.length >= 2) {
    try {
      JSON.parse(s);
      out.push({ slug: 'json', label: 'JSON — 格式化', value: s, score: 95 });
      if (s.startsWith('[')) {
        out.push({ slug: 'csv-json', label: 'JSON 数组 — 转为 CSV', value: s, params: { dir: 'to-csv' }, score: 60 });
      }
    } catch { /* not json, keep looking */ }
  }

  // Unix timestamp — bounded to a plausible window (2001…2033) to avoid
  // claiming every 10-digit number is a date
  if (/^\d{10}$/.test(s) && Number(s) > 1_000_000_000 && Number(s) < 2_000_000_000) {
    out.push({ slug: 'timestamp', label: `Unix 秒 — ${new Date(Number(s) * 1000).toISOString().slice(0, 10)}`, value: s, score: 90 });
  }
  if (/^\d{13}$/.test(s) && Number(s) > 1e12 && Number(s) < 2e12) {
    out.push({ slug: 'timestamp', label: `Unix 毫秒 — ${new Date(Number(s)).toISOString().slice(0, 10)}`, value: s, score: 90 });
  }

  // UUID
  if (/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(s)) {
    const ver = s.replace(/[{}]/g, '')[14];
    out.push({ slug: 'uuid', label: `UUID v${ver} — 生成同类 ID`, value: '', score: 70 });
  }

  // CIDR / IP
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s)) {
    out.push({ slug: 'cidr', label: 'IPv4 — 计算网段信息', value: s, score: 92 });
  }

  // URL
  if (/^https?:\/\//i.test(s)) {
    if (/%[0-9a-f]{2}/i.test(s)) {
      out.push({ slug: 'url', label: 'URL — 解码 percent-encoding', value: s, params: { dir: 'decode' }, score: 85 });
    }
    out.push({ slug: 'qr', label: 'URL — 生成二维码', value: s, score: 55 });
  } else if (/%[0-9a-f]{2}/i.test(s)) {
    out.push({ slug: 'url', label: '含 percent-encoding — 解码', value: s, params: { dir: 'decode' }, score: 75 });
  }

  // Hex bytes / hash by length
  const hexClean = s.replace(/[\s:]/g, '');
  if (/^(0x)?[0-9a-f]+$/i.test(hexClean) && hexClean.replace(/^0x/i, '').length % 2 === 0) {
    const h = hexClean.replace(/^0x/i, '');
    const known: Record<number, string> = { 32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' };
    if (known[h.length]) {
      out.push({ slug: 'hash', label: `${h.length} 位十六进制 — 长度符合 ${known[h.length]}`, value: '', score: 50 });
    }
    if (h.length <= 16) {
      out.push({ slug: 'base-convert', label: '十六进制数值 — 进制转换', value: s, score: 65 });
    }
    if (h.length >= 8 && h.length <= 512) {
      out.push({ slug: 'hex', label: 'Hex 字节 — 解码为文本', value: s, params: { dir: 'decode' }, score: 45 });
    }
  }

  // Base64 last: it is the greediest pattern, so it must not outrank the others
  if (s.length >= 8 && b64ish.test(s.replace(/\s/g, '')) && !/^\d+$/.test(s)) {
    const decoded = tryB64(s.replace(/\s/g, ''));
    if (decoded && decoded.length > 2 && /[\x20-\x7e\u4e00-\u9fff]/.test(decoded)) {
      const preview = decoded.slice(0, 32).replace(/\n/g, ' ');
      out.push({
        slug: 'base64',
        label: `Base64 — 解码为「${preview}${decoded.length > 32 ? '…' : ''}」`,
        value: s,
        params: { dir: 'decode' },
        score: 80,
      });
    }
  }

  // Cron
  const f = s.split(/\s+/);
  if (f.length === 5 && f.every((x) => /^[\d*/,\-?]+$/.test(x)) && s.includes('*')) {
    out.push({ slug: 'cron', label: 'Cron 表达式 — 解释并预测运行时刻', value: s, score: 88 });
  }

  // Colour. The leading # is required: bare `abc123` is far more likely to be
  // an id or a short hash than a colour, and a wrong confident guess is worse
  // than no guess. rgb()/hsl() notations are unambiguous even without it.
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) {
    out.push({ slug: 'color', label: '颜色 — 转换与对比度检查', value: s, score: 93 });
  } else if (/^(rgba?|hsla?|oklch)\([^)]+\)$/i.test(s)) {
    out.push({ slug: 'color', label: '颜色 — 转换为 HEX / OKLCH', value: s, score: 93 });
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)))
    .slice(0, 4);
}
