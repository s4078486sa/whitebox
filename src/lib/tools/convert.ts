import type { ToolMeta, ToolImpl, Values } from '../types.ts';
import { ToolError } from '../types.ts';
import { findJsonErrorPos } from '../json-pos.ts';

const S = (v: Values, k: string) => String(v[k] ?? '');
const B = (v: Values, k: string) => v[k] === true || v[k] === 'true';
const N = (v: Values, k: string) => Number(v[k]);

/**
 * JSON.parse's message is useless without a position — and V8 only supplies
 * "position N" for *long* inputs. For a short document it inlines a truncated
 * copy of the source instead, which is exactly backwards from what a user
 * needs. So: use V8's offset when it gives one, and fall back to our own
 * scanner when it doesn't.
 */
function jsonParse(src: string, field = 'text'): unknown {
  try {
    return JSON.parse(src);
  } catch (e) {
    const msg = (e as Error).message;
    const m = /position (\d+)/.exec(msg);
    const pos = m ? Number(m[1]) : findJsonErrorPos(src);
    if (pos >= 0) {
      const before = src.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      const snippet = src.split('\n')[line - 1]?.trim().slice(0, 60) ?? '';
      const head = msg
        .split(' in JSON')[0]!
        .replace(/,? "[^]*" is not valid JSON$/, '');
      throw new ToolError(`第 ${line} 行第 ${col} 列解析失败：${head}\n  ${snippet}`, field);
    }
    throw new ToolError(msg, field);
  }
}

// ── json format ───────────────────────────────────────────
export const json: [ToolMeta, ToolImpl] = [
  {
    slug: 'json',
    name: 'JSON 格式化',
    blurb: '美化 / 压缩 / 排序键 / 转义字符串',
    category: 'convert',
    aliases: ['json', 'format', 'pretty', 'minify', '格式化', '压缩', 'beautify'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: 'JSON',
        mono: true,
        sample: '{"name":"Whitebox","tools":25,"local":true,"tags":["dev","offline"],"nested":{"a":1,"b":[2,3]}}',
      },
      {
        id: 'mode',
        type: 'select',
        label: '模式',
        default: 'pretty',
        options: [
          { value: 'pretty', label: '美化' },
          { value: 'min', label: '压缩' },
          { value: 'escape', label: '转义为字符串' },
          { value: 'unescape', label: '从字符串还原' },
        ],
      },
      {
        id: 'indent',
        type: 'select',
        label: '缩进',
        default: '2',
        options: [
          { value: '2', label: '2 空格' },
          { value: '4', label: '4 空格' },
          { value: 'tab', label: 'Tab' },
        ],
      },
      { id: 'sort', type: 'checkbox', label: '按键名排序', default: false },
    ],
  },
  {
    run(v) {
      const src = S(v, 'text').trim();
      if (!src) return { text: '' };
      const mode = S(v, 'mode');

      if (mode === 'escape') return { text: JSON.stringify(src) };
      if (mode === 'unescape') {
        const parsed = jsonParse(src);
        if (typeof parsed !== 'string') throw new ToolError('输入不是一个 JSON 字符串字面量（应以引号包裹）', 'text');
        return { text: parsed };
      }

      let data = jsonParse(src);
      if (B(v, 'sort')) {
        const sortDeep = (x: unknown): unknown => {
          if (Array.isArray(x)) return x.map(sortDeep);
          if (x && typeof x === 'object') {
            return Object.fromEntries(
              Object.entries(x as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, val]) => [k, sortDeep(val)]),
            );
          }
          return x;
        };
        data = sortDeep(data);
      }
      const ind = S(v, 'indent') === 'tab' ? '\t' : Number(S(v, 'indent')) || 2;
      const out = mode === 'min' ? JSON.stringify(data) : JSON.stringify(data, null, ind);

      let count = 0;
      const walk = (x: unknown) => {
        count++;
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') Object.values(x as object).forEach(walk);
      };
      walk(data);
      const saved = src.length - out.length;
      return {
        text: out,
        meta: `${count} 个节点 · ${out.length} 字符${saved > 0 ? ` · 省下 ${saved}` : ''}`,
        filename: 'data.json',
      };
    },
  },
];

// ── json/yaml/toml ────────────────────────────────────────
export const configconv: [ToolMeta, ToolImpl] = [
  {
    slug: 'json-yaml-toml',
    name: 'JSON ↔ YAML ↔ TOML',
    blurb: '三种配置格式互转',
    category: 'convert',
    aliases: ['yaml', 'yml', 'toml', 'json', 'config', '配置', 'convert'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入',
        mono: true,
        sample: 'name = "whitebox"\nversion = "0.1.0"\n\n[build]\ntarget = "static"\nminify = true',
      },
      {
        id: 'from',
        type: 'select',
        label: '来源',
        default: 'auto',
        options: [
          { value: 'auto', label: '自动识别' },
          { value: 'json', label: 'JSON' },
          { value: 'yaml', label: 'YAML' },
          { value: 'toml', label: 'TOML' },
        ],
      },
      {
        id: 'to',
        type: 'select',
        label: '目标',
        default: 'json',
        options: [
          { value: 'json', label: 'JSON' },
          { value: 'yaml', label: 'YAML' },
          { value: 'toml', label: 'TOML' },
        ],
      },
    ],
  },
  {
    async run(v) {
      const src = S(v, 'text').trim();
      if (!src) return { text: '' };
      const [YAML, TOML] = await Promise.all([import('js-yaml'), import('smol-toml')]);

      let from = S(v, 'from');
      if (from === 'auto') {
        from = src.startsWith('{') || src.startsWith('[') ? 'json' : /^\s*\[?[\w."-]+\]?\s*=/m.test(src) ? 'toml' : 'yaml';
      }

      let data: unknown;
      try {
        data =
          from === 'json' ? jsonParse(src) : from === 'toml' ? TOML.parse(src) : YAML.load(src);
      } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError(`按 ${from.toUpperCase()} 解析失败：${(e as Error).message.split('\n')[0]}`, 'text');
      }
      if (data === undefined || data === null) throw new ToolError('解析结果为空', 'text');

      const to = S(v, 'to');
      try {
        const out =
          to === 'json'
            ? JSON.stringify(data, null, 2)
            : to === 'toml'
              ? TOML.stringify(data as Record<string, unknown>)
              : YAML.dump(data, { indent: 2, lineWidth: 100, noRefs: true });
        return { text: out, meta: `${from.toUpperCase()} → ${to.toUpperCase()}`, filename: `data.${to}` };
      } catch (e) {
        throw new ToolError(
          `无法输出为 ${to.toUpperCase()}：${(e as Error).message.split('\n')[0]}${to === 'toml' ? '（TOML 不支持顶层数组或 null 值）' : ''}`,
          'text',
        );
      }
    },
  },
];

// ── timestamp ─────────────────────────────────────────────
export const timestamp: [ToolMeta, ToolImpl] = [
  {
    slug: 'timestamp',
    name: '时间戳转换',
    blurb: 'Unix 时间与人类可读时间互转',
    category: 'convert',
    aliases: ['timestamp', 'time', 'epoch', 'unix', 'date', '时间戳', '时间', 'iso8601'],
    inputs: [
      {
        id: 'input',
        type: 'text',
        label: '时间戳或日期',
        mono: true,
        placeholder: '1788536543 · 2026-09-04T15:42:23Z · now',
        hint: '留空表示当前时间；秒/毫秒自动识别',
      },
      {
        id: 'tz',
        type: 'select',
        label: '本地时区显示',
        default: 'utc',
        options: [
          { value: 'utc', label: 'UTC' },
          { value: 'local', label: '浏览器本地时区' },
        ],
      },
    ],
  },
  {
    tick: 1000,
    run(v) {
      const raw = S(v, 'input').trim();
      let d: Date;
      if (!raw || raw.toLowerCase() === 'now') {
        d = new Date();
      } else if (/^-?\d{1,19}$/.test(raw)) {
        const n = Number(raw);
        // 10 digits = seconds, 13 = ms, 16 = µs, 19 = ns
        d = new Date(raw.replace('-', '').length >= 16 ? n / 1e6 : raw.replace('-', '').length >= 13 ? n : n * 1000);
      } else {
        d = new Date(raw);
      }
      if (Number.isNaN(d.getTime())) {
        throw new ToolError(`无法解析 "${raw}"。可用格式：Unix 秒/毫秒、ISO 8601、或 now`, 'input');
      }

      const utc = S(v, 'tz') === 'utc';
      const ms = d.getTime();
      const s = Math.floor(ms / 1000);
      const pad = (n: number, w = 2) => String(n).padStart(w, '0');
      const parts = utc
        ? { Y: d.getUTCFullYear(), M: d.getUTCMonth() + 1, D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() }
        : { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(), wd: d.getDay() };
      const human = `${parts.Y}-${pad(parts.M)}-${pad(parts.D)} ${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}`;
      const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parts.wd];
      const tzName = utc ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;

      const diff = Math.round((ms - Date.now()) / 1000);
      const ad = Math.abs(diff);
      const unit =
        ad < 60 ? `${ad} 秒` : ad < 3600 ? `${Math.round(ad / 60)} 分钟` : ad < 86400 ? `${Math.round(ad / 3600)} 小时` : ad < 31536000 ? `${Math.round(ad / 86400)} 天` : `${(ad / 31536000).toFixed(1)} 年`;
      const rel = ad < 2 ? '就是现在' : diff < 0 ? `${unit}前` : `${unit}后`;

      const rows: [string, string][] = [
        ['Unix 秒', String(s)],
        ['Unix 毫秒', String(ms)],
        ['ISO 8601', d.toISOString()],
        [`本地 (${tzName})`, `${human} ${wd}`],
        ['RFC 2822', d.toUTCString()],
        ['相对现在', rel],
      ];
      return {
        blocks: rows.map(([label, text]) => ({ label, text })),
      };
    },
  },
];

// ── number base ───────────────────────────────────────────
export const numbase: [ToolMeta, ToolImpl] = [
  {
    slug: 'base-convert',
    name: '进制转换',
    blurb: '2/8/10/16 及任意进制，支持大整数',
    category: 'convert',
    aliases: ['base', 'binary', 'hex', 'octal', 'decimal', '进制', '二进制', 'radix', 'bin'],
    inputs: [
      {
        id: 'num',
        type: 'text',
        label: '数值',
        mono: true,
        placeholder: '255 · 0xff · 0b1010 · 0o777',
        default: '3735928559',
        hint: '带 0x / 0b / 0o 前缀时自动识别进制',
      },
      {
        id: 'from',
        type: 'select',
        label: '输入进制',
        default: 'auto',
        options: [
          { value: 'auto', label: '自动' },
          { value: '2', label: '2 二进制' },
          { value: '8', label: '8 八进制' },
          { value: '10', label: '10 十进制' },
          { value: '16', label: '16 十六进制' },
          { value: '36', label: '36' },
        ],
      },
    ],
  },
  {
    run(v) {
      const raw = S(v, 'num').trim().replace(/[\s_,]/g, '');
      if (!raw) return { text: '' };
      let body = raw;
      let base = S(v, 'from') === 'auto' ? 10 : Number(S(v, 'from'));
      const neg = body.startsWith('-');
      if (neg) body = body.slice(1);

      if (S(v, 'from') === 'auto') {
        if (/^0x/i.test(body)) { base = 16; body = body.slice(2); }
        else if (/^0b/i.test(body)) { base = 2; body = body.slice(2); }
        else if (/^0o/i.test(body)) { base = 8; body = body.slice(2); }
        else if (/^[0-9]+$/.test(body)) base = 10;
        else if (/^[0-9a-f]+$/i.test(body)) base = 16;
      }

      const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
      const bad = body.toLowerCase().split('').find((c) => !digits.includes(c));
      if (bad !== undefined) {
        throw new ToolError(`"${bad}" 不是 ${base} 进制的合法数字（允许 ${digits[0]}-${digits[digits.length - 1]}）`, 'num');
      }

      let n: bigint;
      try {
        n = body.split('').reduce((acc, c) => acc * BigInt(base) + BigInt(digits.indexOf(c.toLowerCase())), 0n);
      } catch {
        throw new ToolError('数值解析失败', 'num');
      }
      if (neg) n = -n;

      const grp = (s: string, size: number) =>
        s.replace(new RegExp(`\\B(?=(.{${size}})+$)`, 'g'), ' ');
      const bin = n.toString(2);
      const bits = bin.replace('-', '').length;
      const fits = bits <= 8 ? 'uint8' : bits <= 16 ? 'uint16' : bits <= 32 ? 'uint32' : bits <= 64 ? 'uint64' : `${bits} bit — 超出 64 位`;

      const rows: [string, string, string][] = [
        ['十进制', n.toString(10), `${n.toString(10).replace(/\B(?=(\d{3})+$)/g, ',')}`],
        ['十六进制', '0x' + n.toString(16).toUpperCase(), grp(n.toString(16).toUpperCase(), 4)],
        ['八进制', '0o' + n.toString(8), ''],
        ['二进制', '0b' + bin, grp(bin, 8)],
        ['36 进制', n.toString(36), ''],
      ];
      return {
        blocks: [
          ...rows.map(([label, text, meta]) => ({ label, text, meta })),
          { label: '位宽', text: `${bits} bit · 最小可容纳 ${fits}`, nocopy: true },
        ],
      };
    },
  },
];

// ── color ─────────────────────────────────────────────────
function srgbToLin(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function relLum([r, g, b]: [number, number, number]) {
  return 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}
function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [srgbToLin(r / 255), srgbToLin(g / 255), srgbToLin(b / 255)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bc = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + Bc * Bc);
  let H = (Math.atan2(Bc, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L * 100, C, H];
}

export const color: [ToolMeta, ToolImpl] = [
  {
    slug: 'color',
    name: '颜色转换',
    blurb: 'HEX / RGB / HSL / OKLCH，含 WCAG 对比度',
    category: 'convert',
    aliases: ['color', 'colour', 'hex', 'rgb', 'hsl', 'oklch', '颜色', '对比度', 'contrast', 'wcag'],
    inputs: [
      { id: 'c', type: 'text', label: '颜色', mono: true, default: '#58a6ff', placeholder: '#58a6ff · rgb(88,166,255)' },
      { id: 'picker', type: 'color', label: '取色器', default: '#58a6ff' },
      { id: 'bg', type: 'text', label: '对比背景色', mono: true, default: '#0e1217', hint: '用于计算 WCAG 对比度' },
    ],
  },
  {
    run(v) {
      const parse = (s: string): [number, number, number] | null => {
        s = s.trim().toLowerCase();
        let m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
        if (m) {
          let h = m[1]!;
          if (h.length === 3) h = h.split('').map((c) => c + c).join('');
          return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        }
        m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
        if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
        return null;
      };

      const rgb = parse(S(v, 'c'));
      if (!rgb) throw new ToolError(`无法识别 "${S(v, 'c')}"。支持 #RGB、#RRGGBB、rgb(r,g,b)`, 'c');
      const [r, g, b] = rgb;
      const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
      const [h, s, l] = rgbToHsl(r, g, b);
      const [L, C, H] = rgbToOklch(r, g, b);

      const bgRgb = parse(S(v, 'bg')) ?? [14, 18, 23];
      const l1 = relLum(rgb), l2 = relLum(bgRgb as [number, number, number]);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const rr = ratio.toFixed(2);
      const verdict = [
        `正文 (4.5:1)  ${ratio >= 4.5 ? '通过' : '不通过'}`,
        `大字 (3:1)    ${ratio >= 3 ? '通过' : '不通过'}`,
        `AAA  (7:1)    ${ratio >= 7 ? '通过' : '不通过'}`,
      ].join('\n');

      return {
        blocks: [
          {
            label: '预览',
            text: '',
            nocopy: true,
            html: `<div class="swatch" style="background:${hex}"></div>`,
          },
          { label: 'HEX', text: hex.toUpperCase() },
          { label: 'RGB', text: `rgb(${r}, ${g}, ${b})` },
          { label: 'HSL', text: `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)` },
          { label: 'OKLCH', text: `oklch(${L.toFixed(2)}% ${C.toFixed(4)} ${H.toFixed(2)})`, meta: '感知均匀色彩空间' },
          { label: `对比度 vs ${S(v, 'bg')}`, text: `${rr}:1\n\n${verdict}`, meta: 'WCAG 2.x 相对亮度' },
        ],
      };
    },
  },
];

// ── csv ↔ json ────────────────────────────────────────────
function parseCSV(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  let quoteStart = -1; // byte offset of the opening quote, for the error
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += c;
    } else if (c === '"') { inQ = true; quoteStart = i; }
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  // An unterminated quote is a parse error, not a shrug. Swallowing it
  // produces output that looks entirely plausible — the truncated field just
  // silently absorbs the rest of the file — which is the worst possible
  // failure for a data-conversion tool: wrong answers that inspect as right.
  if (inQ) {
    const line = text.slice(0, quoteStart).split('\n').length;
    const col = quoteStart - text.lastIndexOf('\n', quoteStart - 1);
    throw new ToolError(
      `第 ${line} 行第 ${col} 列的引号没有闭合 —— 后面的内容都被并进了这一个字段。` +
        `字段内的引号要写成两个（""）。`,
      'text',
    );
  }
  // Flush the trailing row: a file whose last line has no newline still has
  // that line. (Dropping this silently loses the final record.)
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

export const csvjson: [ToolMeta, ToolImpl] = [
  {
    slug: 'csv-json',
    name: 'CSV ↔ JSON',
    blurb: '带引号转义的双向转换',
    category: 'convert',
    aliases: ['csv', 'json', 'tsv', 'excel', 'table', '表格', 'spreadsheet'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入',
        mono: true,
        sample: 'name,role,active\nWhite Kang,agent,true\nEyebrow Kang,"human, operator",true',
      },
      {
        id: 'dir',
        type: 'select',
        label: '方向',
        default: 'to-json',
        options: [
          { value: 'to-json', label: 'CSV → JSON' },
          { value: 'to-csv', label: 'JSON → CSV' },
        ],
      },
      {
        id: 'delim',
        type: 'select',
        label: '分隔符',
        default: ',',
        options: [
          { value: ',', label: '逗号' },
          { value: '\t', label: 'Tab' },
          { value: ';', label: '分号' },
          { value: '|', label: '竖线' },
        ],
      },
      { id: 'types', type: 'checkbox', label: '推断数字与布尔值', default: true },
    ],
  },
  {
    run(v) {
      const src = S(v, 'text').trim();
      if (!src) return { text: '' };
      const delim = S(v, 'delim') === '\\t' ? '\t' : S(v, 'delim');

      if (S(v, 'dir') === 'to-json') {
        const rows = parseCSV(src, delim);
        if (rows.length < 2) throw new ToolError('至少需要一行表头和一行数据', 'text');
        const head = rows[0]!.map((h) => h.trim());
        const cast = (s: string): string | number | boolean | null => {
          if (!B(v, 'types')) return s;
          const t = s.trim();
          if (t === '') return null;
          if (t === 'true') return true;
          if (t === 'false') return false;
          if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
          return s;
        };
        const objs = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, cast(r[i] ?? '')])));
        return { text: JSON.stringify(objs, null, 2), meta: `${objs.length} 行 · ${head.length} 列`, filename: 'data.json' };
      }

      const data = jsonParse(src);
      if (!Array.isArray(data)) throw new ToolError('JSON → CSV 需要顶层是一个对象数组', 'text');
      if (data.length === 0) return { text: '' };
      const keys = [...new Set(data.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))];
      if (!keys.length) throw new ToolError('数组里没有对象，无法推导表头', 'text');
      const esc = (x: unknown) => {
        const s = x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x);
        return /["\n\r]|^\s|\s$/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const out = [keys.join(delim), ...data.map((o) => keys.map((k) => esc((o as Record<string, unknown>)?.[k])).join(delim))].join('\n');
      return { text: out, meta: `${data.length} 行 · ${keys.length} 列`, filename: 'data.csv' };
    },
  },
];

// ── cron ──────────────────────────────────────────────────
const CRON_NAMES = ['分钟', '小时', '日', '月', '星期'];
const CRON_RANGE: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function expandField(spec: string, idx: number): number[] {
  const [lo, hi] = CRON_RANGE[idx]!;
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (stepPart && (!Number.isInteger(step) || step < 1)) throw new ToolError(`第 ${idx + 1} 段（${CRON_NAMES[idx]}）的步长 "${stepPart}" 无效`);
    let a: number, b: number;
    if (rangePart === '*' || rangePart === '?') { a = lo; b = hi; }
    else if (rangePart!.includes('-')) {
      const [x, y] = rangePart!.split('-').map(Number);
      a = x!; b = y!;
    } else { a = b = Number(rangePart); if (!stepPart) b = a; else b = hi; }
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new ToolError(`第 ${idx + 1} 段（${CRON_NAMES[idx]}）无法解析："${part}"`);
    if (a < lo || b > hi) throw new ToolError(`第 ${idx + 1} 段（${CRON_NAMES[idx]}）的值 ${a < lo ? a : b} 超出范围 ${lo}-${hi}`);
    for (let i = a; i <= b; i += step) out.add(idx === 4 && i === 7 ? 0 : i);
  }
  return [...out].sort((x, y) => x - y);
}

export const cron: [ToolMeta, ToolImpl] = [
  {
    slug: 'cron',
    name: 'Cron 表达式',
    blurb: '解释含义并算出未来运行时刻',
    category: 'convert',
    aliases: ['cron', 'crontab', 'schedule', '定时', '计划任务', 'systemd'],
    inputs: [
      {
        id: 'expr',
        type: 'text',
        label: 'Cron 表达式',
        mono: true,
        default: '*/15 9-17 * * 1-5',
        hint: '五段：分 时 日 月 周（UTC 计算）',
      },
      { id: 'n', type: 'number', label: '预测次数', default: 8, min: 1, max: 30 },
    ],
  },
  {
    run(v) {
      const expr = S(v, 'expr').trim().replace(/\s+/g, ' ');
      if (!expr) return { text: '' };
      const preset: Record<string, string> = {
        '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
        '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
      };
      const norm = preset[expr] ?? expr;
      const f = norm.split(' ');
      if (f.length !== 5) {
        throw new ToolError(`需要 5 段，收到 ${f.length} 段。格式：分 时 日 月 周（如 "*/15 9-17 * * 1-5"）`, 'expr');
      }
      const sets = f.map((s, i) => expandField(s, i));

      const fmtSet = (arr: number[], i: number) => {
        const [lo, hi] = CRON_RANGE[i]!;
        const full = i === 4 ? arr.length >= 7 : arr.length === hi - lo + 1;
        if (full) return '每' + CRON_NAMES[i]!.replace('分钟', '分钟').replace('星期', '天');
        if (i === 4) return arr.map((d) => WEEKDAYS[d]).join('、');
        if (i === 3) return arr.map((m) => MONTHS[m - 1]).join('、');
        if (arr.length > 8) return `${arr.length} 个值（${arr[0]}…${arr[arr.length - 1]}）`;
        return arr.join('、');
      };
      const desc = CRON_NAMES.map((n, i) => `${n.padEnd(3, '　')}  ${fmtSet(sets[i]!, i)}`).join('\n');

      const [mins, hrs, doms, mons, dows] = sets as [number[], number[], number[], number[], number[]];
      const domRestricted = f[2] !== '*' && f[2] !== '?';
      const dowRestricted = f[4] !== '*' && f[4] !== '?';
      const next: string[] = [];
      const d = new Date();
      d.setUTCSeconds(0, 0);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      const limit = Math.max(1, Math.min(30, N(v, 'n') || 8));
      for (let guard = 0; guard < 500000 && next.length < limit; guard++) {
        const okMon = mons.includes(d.getUTCMonth() + 1);
        const okDom = doms.includes(d.getUTCDate());
        const okDow = dows.includes(d.getUTCDay());
        // cron OR-semantics: when both day fields are restricted, either may match
        const okDay = domRestricted && dowRestricted ? okDom || okDow : okDom && okDow;
        if (okMon && okDay && hrs.includes(d.getUTCHours()) && mins.includes(d.getUTCMinutes())) {
          next.push(
            `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC  ${WEEKDAYS[d.getUTCDay()]}`,
          );
        }
        d.setUTCMinutes(d.getUTCMinutes() + 1);
      }

      const perDay = mins.length * hrs.length;
      return {
        blocks: [
          { label: '含义', text: desc, meta: preset[expr] ? `${expr} = ${norm}` : undefined },
          {
            label: `未来 ${next.length} 次运行`,
            text: next.length ? next.join('\n') : '一年内没有匹配的时刻 — 检查日期与月份组合是否存在（如 2 月 30 日）',
            meta: `匹配日约每天 ${perDay} 次`,
          },
        ],
        warning:
          domRestricted && dowRestricted
            ? '「日」和「星期」都被限定了。标准 cron 在这种情况下取「或」而非「与」——两者任一匹配就会运行。'
            : undefined,
      };
    },
  },
];
