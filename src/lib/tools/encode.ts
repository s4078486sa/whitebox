import type { ToolMeta, ToolImpl, Values, RunResult } from '../types.ts';
import { ToolError } from '../types.ts';

const S = (v: Values, k: string) => String(v[k] ?? '');
const B = (v: Values, k: string) => v[k] === true || v[k] === 'true';
const N = (v: Values, k: string) => Number(v[k]);

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ── base64 ────────────────────────────────────────────────
export const base64: [ToolMeta, ToolImpl] = [
  {
    slug: 'base64',
    name: 'Base64 编解码',
    blurb: '文本与 Base64 互转，支持 URL-safe 变体',
    category: 'encode',
    aliases: ['base64', 'b64', 'atob', 'btoa', 'base', '编码'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入',
        mono: true,
        sample: 'Whitebox — 一切在你的浏览器里发生。',
        placeholder: '粘贴文本或 Base64',
      },
      {
        id: 'dir',
        type: 'select',
        label: '方向',
        default: 'encode',
        options: [
          { value: 'encode', label: '编码 →' },
          { value: 'decode', label: '← 解码' },
        ],
      },
      {
        id: 'variant',
        type: 'select',
        label: '变体',
        default: 'std',
        options: [
          { value: 'std', label: '标准 (+/=)' },
          { value: 'url', label: 'URL-safe (-_)' },
        ],
      },
    ],
  },
  {
    run(v) {
      const text = S(v, 'text');
      if (!text) return { text: '' };
      const url = S(v, 'variant') === 'url';
      if (S(v, 'dir') === 'encode') {
        let out = bytesToB64(enc.encode(text));
        if (url) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return { text: out, meta: `${enc.encode(text).length} B → ${out.length} 字符` };
      }
      let s = text.trim().replace(/\s+/g, '');
      if (url) s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      try {
        const bytes = b64ToBytes(s);
        return { text: dec.decode(bytes), meta: `${bytes.length} B` };
      } catch {
        throw new ToolError('不是合法的 Base64：含有编码字符集之外的字符', 'text');
      }
    },
  },
];

// ── url encode ────────────────────────────────────────────
export const urlcodec: [ToolMeta, ToolImpl] = [
  {
    slug: 'url',
    name: 'URL 编解码',
    blurb: 'percent-encoding，可选整段或组件模式',
    category: 'encode',
    aliases: ['url', 'urlencode', 'urldecode', 'percent', 'uri', '转义'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入',
        mono: true,
        sample: 'https://example.com/search?q=白盒 工具&lang=zh',
      },
      {
        id: 'dir',
        type: 'select',
        label: '方向',
        default: 'encode',
        options: [
          { value: 'encode', label: '编码 →' },
          { value: 'decode', label: '← 解码' },
        ],
      },
      {
        id: 'mode',
        type: 'select',
        label: '范围',
        default: 'component',
        hint: '组件模式会转义 & = ? / 等分隔符',
        options: [
          { value: 'component', label: '组件 (encodeURIComponent)' },
          { value: 'full', label: '整个 URL (encodeURI)' },
        ],
      },
    ],
  },
  {
    run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      const comp = S(v, 'mode') === 'component';
      try {
        return {
          text:
            S(v, 'dir') === 'encode'
              ? comp
                ? encodeURIComponent(t)
                : encodeURI(t)
              : comp
                ? decodeURIComponent(t)
                : decodeURI(t),
        };
      } catch {
        throw new ToolError('解码失败：存在不完整的 % 转义序列（如 %E4 后缺字节）', 'text');
      }
    },
  },
];

// ── html entities ─────────────────────────────────────────
const NAMED: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
export const htmlent: [ToolMeta, ToolImpl] = [
  {
    slug: 'html-entities',
    name: 'HTML 实体',
    blurb: '转义与反转义 HTML 实体',
    category: 'encode',
    aliases: ['html', 'entity', 'entities', 'escape', '实体', 'xss'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入',
        mono: true,
        sample: '<script>alert("hi & bye")</script>',
      },
      {
        id: 'dir',
        type: 'select',
        label: '方向',
        default: 'encode',
        options: [
          { value: 'encode', label: '转义 →' },
          { value: 'decode', label: '← 反转义' },
        ],
      },
      {
        id: 'all',
        type: 'checkbox',
        label: '转义所有非 ASCII 字符',
        default: false,
      },
    ],
  },
  {
    run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      if (S(v, 'dir') === 'encode') {
        let out = t.replace(/[&<>"']/g, (c) => NAMED[c]!);
        if (B(v, 'all')) {
          out = Array.from(out)
            .map((c) => (c.codePointAt(0)! > 127 ? `&#${c.codePointAt(0)};` : c))
            .join('');
        }
        return { text: out };
      }
      const d = document.createElement('textarea');
      d.innerHTML = t;
      return { text: d.value };
    },
  },
];

// ── hex ───────────────────────────────────────────────────
export const hexcodec: [ToolMeta, ToolImpl] = [
  {
    slug: 'hex',
    name: 'Hex 编解码',
    blurb: 'UTF-8 文本与十六进制字节互转',
    category: 'encode',
    aliases: ['hex', 'hexdump', '十六进制', 'bytes', 'ascii'],
    inputs: [
      { id: 'text', type: 'textarea', label: '输入', mono: true, sample: 'Whitebox' },
      {
        id: 'dir',
        type: 'select',
        label: '方向',
        default: 'encode',
        options: [
          { value: 'encode', label: '文本 → Hex' },
          { value: 'decode', label: 'Hex → 文本' },
        ],
      },
      {
        id: 'sep',
        type: 'select',
        label: '分隔',
        default: 'space',
        options: [
          { value: 'space', label: '空格' },
          { value: 'none', label: '无' },
          { value: 'colon', label: '冒号' },
        ],
      },
      { id: 'upper', type: 'checkbox', label: '大写', default: false },
    ],
  },
  {
    run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      if (S(v, 'dir') === 'encode') {
        const bytes = enc.encode(t);
        let parts = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
        if (B(v, 'upper')) parts = parts.map((p) => p.toUpperCase());
        const sep = { space: ' ', none: '', colon: ':' }[S(v, 'sep')] ?? ' ';
        return { text: parts.join(sep), meta: `${bytes.length} 字节` };
      }
      const clean = t.replace(/(0x)|[\s:,-]/gi, '');
      if (!/^[0-9a-f]*$/i.test(clean)) {
        throw new ToolError('含有非十六进制字符（只允许 0-9 a-f，以及空格/冒号/逗号作分隔）', 'text');
      }
      if (clean.length % 2) throw new ToolError(`十六进制位数为奇数（${clean.length} 位），缺少半个字节`, 'text');
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
      return { text: dec.decode(bytes), meta: `${bytes.length} 字节` };
    },
  },
];

// ── unicode escapes ───────────────────────────────────────
export const unicode: [ToolMeta, ToolImpl] = [
  {
    slug: 'unicode',
    name: 'Unicode 转义',
    blurb: '\\uXXXX 与字符互转，含码位明细',
    category: 'encode',
    aliases: ['unicode', 'utf8', 'utf-16', 'codepoint', '码位', 'emoji', '\\u'],
    inputs: [
      { id: 'text', type: 'textarea', label: '输入', mono: true, sample: '白盒 Whitebox 🧰' },
      {
        id: 'dir',
        type: 'select',
        label: '方向',
        default: 'encode',
        options: [
          { value: 'encode', label: '字符 → \\u' },
          { value: 'decode', label: '\\u → 字符' },
        ],
      },
      {
        id: 'style',
        type: 'select',
        label: '格式',
        default: 'js',
        options: [
          { value: 'js', label: 'JS \\uXXXX' },
          { value: 'cp', label: 'U+XXXX' },
          { value: 'css', label: 'CSS \\XXXXXX' },
        ],
      },
      { id: 'ascii', type: 'checkbox', label: '仅转义非 ASCII', default: true },
    ],
  },
  {
    run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      if (S(v, 'dir') === 'decode') {
        const out = t
          .replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/U\+([0-9a-f]{4,6})/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
        return { text: out };
      }
      const style = S(v, 'style');
      const onlyNonAscii = B(v, 'ascii');
      const out = Array.from(t)
        .map((ch) => {
          const cp = ch.codePointAt(0)!;
          if (onlyNonAscii && cp < 128) return ch;
          if (style === 'cp') return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
          if (style === 'css') return `\\${cp.toString(16).toUpperCase().padStart(6, '0')}`;
          if (cp > 0xffff) {
            return Array.from(ch)
              .flatMap(() => [ch.charCodeAt(0), ch.charCodeAt(1)])
              .slice(0, 2)
              .map((u) => `\\u${u.toString(16).padStart(4, '0')}`)
              .join('');
          }
          return `\\u${cp.toString(16).padStart(4, '0')}`;
        })
        .join(style === 'cp' ? ' ' : '');

      const rows = Array.from(t)
        .slice(0, 200)
        .map((ch) => {
          const cp = ch.codePointAt(0)!;
          return `<tr><td>${ch === '<' ? '&lt;' : ch === '&' ? '&amp;' : ch}</td><td>U+${cp
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')}</td><td>${cp}</td><td>${enc.encode(ch).length}</td></tr>`;
        })
        .join('');
      return {
        blocks: [
          { text: out, meta: `${Array.from(t).length} 个码位` },
          {
            label: '码位明细',
            text: '',
            nocopy: true,
            html: `<table class="data"><thead><tr><th>字符</th><th>码位</th><th>十进制</th><th>UTF-8 字节</th></tr></thead><tbody>${rows}</tbody></table>`,
          },
        ],
      };
    },
  },
];

// ── jwt decode ────────────────────────────────────────────
export const jwt: [ToolMeta, ToolImpl] = [
  {
    slug: 'jwt',
    name: 'JWT 解码',
    blurb: '拆解 header / payload，展开时间声明',
    category: 'encode',
    aliases: ['jwt', 'token', 'jws', 'bearer', 'claims', '令牌'],
    sensitive: true,
    inputs: [
      {
        id: 'token',
        type: 'textarea',
        label: 'JWT',
        mono: true,
        placeholder: 'eyJhbGciOi...',
        sample:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IldoaXRlIEthbmciLCJpYXQiOjE3ODg1MzY1NDMsImV4cCI6MTc4ODU0MDE0M30.7Xk3TjWq7Uq6Yj0kZ4E1F5Z9v8k2mYc0nQq1sWpQ3xA',
      },
    ],
  },
  {
    run(v) {
      const t = S(v, 'token').trim().replace(/^Bearer\s+/i, '');
      if (!t) return { text: '' };
      const parts = t.split('.');
      if (parts.length !== 3) {
        // A JWS compact token is always exactly three dot-separated segments.
        // Unsecured JWTs ("alg":"none") still have three — the last is empty.
        throw new ToolError(
          `JWT 应由 . 分成 3 段，这里只有 ${parts.length} 段`,
          'token',
        );
      }
      const seg = (s: string) => {
        let x = s.replace(/-/g, '+').replace(/_/g, '/');
        while (x.length % 4) x += '=';
        return dec.decode(b64ToBytes(x));
      };
      let header: unknown, payload: Record<string, unknown>;
      try {
        header = JSON.parse(seg(parts[0]!));
      } catch {
        throw new ToolError('第 1 段（header）不是合法的 Base64URL-JSON', 'token');
      }
      try {
        payload = JSON.parse(seg(parts[1]!));
      } catch {
        throw new ToolError('第 2 段（payload）不是合法的 Base64URL-JSON', 'token');
      }

      const now = Math.floor(Date.now() / 1000);
      const claims: string[] = [];
      const fmt = (n: number) => new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const rel = (n: number) => {
        const d = Math.abs(n - now);
        const u = d < 60 ? `${d} 秒` : d < 3600 ? `${Math.round(d / 60)} 分钟` : d < 86400 ? `${Math.round(d / 3600)} 小时` : `${Math.round(d / 86400)} 天`;
        return n < now ? `${u}前` : `${u}后`;
      };
      for (const [k, label] of [['iat', '签发'], ['exp', '过期'], ['nbf', '生效']] as const) {
        const n = payload[k];
        if (typeof n === 'number') claims.push(`${k} (${label})  ${fmt(n)} UTC  ·  ${rel(n)}`);
      }
      let warning: string | undefined;
      if (typeof payload.exp === 'number' && payload.exp < now) {
        warning = `这个 token 已经过期（exp 在 ${rel(payload.exp)}）。`;
      }

      return {
        warning,
        blocks: [
          { label: 'Header', text: JSON.stringify(header, null, 2), meta: '算法与类型' },
          { label: 'Payload', text: JSON.stringify(payload, null, 2), meta: `${Object.keys(payload).length} 个声明` },
          ...(claims.length ? [{ label: '时间声明', text: claims.join('\n'), meta: '本地解读，UTC' }] : []),
          {
            label: 'Signature',
            text: parts[2] ?? '(缺失)',
            meta: '未验证 — 需要密钥，本工具不做验签',
          },
        ],
      };
    },
  },
];
