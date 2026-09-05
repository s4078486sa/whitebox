import type { ToolMeta, ToolImpl, Values } from '../types.ts';
import { ToolError } from '../types.ts';
import { bytesToB64, toHex } from './encode.ts';

const S = (v: Values, k: string) => String(v[k] ?? '');
const B = (v: Values, k: string) => v[k] === true || v[k] === 'true';
const N = (v: Values, k: string) => Number(v[k]);
const enc = new TextEncoder();

/** Rejection sampling — modulo would bias toward the low end of the alphabet. */
function pick(alphabet: string, n: number): string {
  const out: string[] = [];
  const max = 256 - (256 % alphabet.length);
  const buf = new Uint8Array(n * 2);
  while (out.length < n) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < max) {
        out.push(alphabet[b % alphabet.length]!);
        if (out.length === n) break;
      }
    }
  }
  return out.join('');
}

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const LOWER_ALL = 'abcdefghijklmnopqrstuvwxyz';
const UPPER_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT_ALL = '0123456789';
const SYM = '!@#$%^&*()-_=+[]{};:,.?';

// ── password ──────────────────────────────────────────────
export const password: [ToolMeta, ToolImpl] = [
  {
    slug: 'password',
    name: '随机密码',
    blurb: 'CSPRNG 生成，含熵值估算',
    category: 'generate',
    aliases: ['password', 'pass', 'pwd', '密码', 'random', '随机'],
    sensitive: true,
    action: '重新生成',
    inputs: [
      // Order follows the decision order: shape the password first, then say
      // how many you want. "生成数量" sat second and interrupted that.
      { id: 'len', type: 'range', label: '长度', default: 20, min: 8, max: 128, step: 1 },
      { id: 'lower', type: 'checkbox', label: '小写字母', default: true },
      { id: 'upper', type: 'checkbox', label: '大写字母', default: true },
      { id: 'digit', type: 'checkbox', label: '数字', default: true },
      { id: 'sym', type: 'checkbox', label: '符号', default: true },
      {
        id: 'clear',
        type: 'checkbox',
        label: '排除易混字符 (0O1lI)',
        default: true,
      },
      { id: 'count', type: 'number', label: '生成数量', default: 5, min: 1, max: 50 },
    ],
  },
  {
    run(v) {
      const clear = B(v, 'clear');
      let a = '';
      if (B(v, 'lower')) a += clear ? LOWER : LOWER_ALL;
      if (B(v, 'upper')) a += clear ? UPPER : UPPER_ALL;
      if (B(v, 'digit')) a += clear ? DIGIT : DIGIT_ALL;
      if (B(v, 'sym')) a += SYM;
      if (!a) throw new ToolError('至少要选一类字符', 'lower');

      const len = Math.max(4, Math.min(128, N(v, 'len') || 20));
      const count = Math.max(1, Math.min(50, N(v, 'count') || 1));
      const bits = Math.floor(len * Math.log2(a.length));
      const list = Array.from({ length: count }, () => pick(a, len));

      const strength =
        bits < 60 ? '弱 — 只适合低价值场景' : bits < 90 ? '够用 — 适合普通账号' : bits < 128 ? '强' : '很强 — 主密码级别';

      return {
        blocks: [
          {
            text: list.join('\n'),
            // Entropy is a measurement, so it belongs beside the result like
            // any other metric — not in the warning line, which is reserved
            // for things that can bite (irreversible loss, broken algorithms).
            // The privacy claim is already the pill's job on every page.
            meta: `${a.length} 字符集 · ${bits} bit 熵 · ${strength}`,
          },
        ],
      };
    },
  },
];

// ── uuid ──────────────────────────────────────────────────
function uuidv7(): string {
  const ts = Date.now();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const uuid: [ToolMeta, ToolImpl] = [
  {
    slug: 'uuid',
    name: 'UUID 生成',
    blurb: 'v4 随机 / v7 时间有序 / NIL',
    category: 'generate',
    aliases: ['uuid', 'guid', 'v4', 'v7', 'ulid', 'id', '唯一'],
    action: '重新生成',
    inputs: [
      {
        id: 'ver',
        type: 'select',
        label: '版本',
        default: 'v4',
        hint: 'v7 前缀含毫秒时间戳，做主键时索引局部性更好',
        options: [
          { value: 'v4', label: 'v4 — 全随机' },
          { value: 'v7', label: 'v7 — 时间有序' },
          { value: 'nil', label: 'NIL — 全零' },
        ],
      },
      { id: 'count', type: 'number', label: '数量', default: 10, min: 1, max: 500 },
      { id: 'upper', type: 'checkbox', label: '大写', default: false },
      { id: 'braces', type: 'checkbox', label: '加花括号 {}', default: false },
      { id: 'nodash', type: 'checkbox', label: '去掉连字符', default: false },
    ],
  },
  {
    run(v) {
      const ver = S(v, 'ver');
      const count = Math.max(1, Math.min(500, N(v, 'count') || 1));
      const list = Array.from({ length: count }, () =>
        ver === 'nil' ? '00000000-0000-0000-0000-000000000000' : ver === 'v7' ? uuidv7() : crypto.randomUUID(),
      ).map((u) => {
        let s = u;
        if (B(v, 'nodash')) s = s.replace(/-/g, '');
        if (B(v, 'upper')) s = s.toUpperCase();
        if (B(v, 'braces')) s = `{${s}}`;
        return s;
      });
      return {
        text: list.join('\n'),
        meta: `${count} 个 · ${ver === 'v4' ? '122 bit 随机' : ver === 'v7' ? '48 bit 时间 + 74 bit 随机' : '常量'}`,
      };
    },
  },
];

// ── hash ──────────────────────────────────────────────────
export const hash: [ToolMeta, ToolImpl] = [
  {
    slug: 'hash',
    name: '哈希计算',
    blurb: 'MD5 / SHA 家族 / BLAKE3 / CRC32',
    category: 'generate',
    aliases: ['hash', 'md5', 'sha', 'sha256', 'sha1', 'sha512', 'blake3', 'crc32', 'checksum', '摘要', '校验'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入',
        mono: true,
        sample: 'Whitebox',
      },
      {
        id: 'case',
        type: 'select',
        label: '输出格式',
        default: 'lower',
        options: [
          { value: 'lower', label: '小写 hex' },
          { value: 'upper', label: '大写 hex' },
          { value: 'b64', label: 'Base64' },
        ],
      },
    ],
  },
  {
    async run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      const data = enc.encode(t);
      const hw = await import('hash-wasm');
      const style = S(v, 'case');

      const fmtHex = (hex: string) => {
        if (style === 'upper') return hex.toUpperCase();
        if (style === 'b64') {
          const b = new Uint8Array(hex.length / 2);
          for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
          return bytesToB64(b);
        }
        return hex;
      };

      const algos: [string, () => Promise<string>][] = [
        ['MD5', () => hw.md5(data)],
        ['SHA-1', () => hw.sha1(data)],
        ['SHA-256', () => hw.sha256(data)],
        ['SHA-512', () => hw.sha512(data)],
        ['SHA3-256', () => hw.sha3(data, 256)],
        ['BLAKE3', () => hw.blake3(data)],
        ['CRC32', () => hw.crc32(data)],
      ];
      const rows = await Promise.all(
        algos.map(async ([name, fn]) => [name, fmtHex(await fn())] as const),
      );
      const label = style === 'b64' ? 'base64' : style === 'upper' ? 'hex 大写' : 'hex 小写';
      return {
        blocks: rows.map(([name, val]) => ({
          label: name,
          text: val,
          meta: `${name} · ${label} · ${data.length} B 输入`,
        })),
        warning: 'MD5 和 SHA-1 已被攻破，只可用于校验非对抗性的完整性，绝不可用于签名或口令。',
      };
    },
  },
];

// ── hmac ──────────────────────────────────────────────────
export const hmac: [ToolMeta, ToolImpl] = [
  {
    slug: 'hmac',
    name: 'HMAC 签名',
    blurb: '带密钥的消息认证码，WebCrypto 实现',
    category: 'generate',
    aliases: ['hmac', 'mac', 'sign', 'webhook', '签名', '密钥'],
    sensitive: true,
    // No workbench: one textarea and one short result is exactly the split
    // shape. Stacking pushed the output panel below the fold, so the page
    // said "type on the left" while the result sat 400px further down.
    inputs: [
      { id: 'msg', type: 'textarea', label: '消息', mono: true, sample: 'what do ya want for nothing?' },
      { id: 'key', type: 'text', label: '密钥', mono: true, placeholder: '共享密钥', default: 'secret' },
      {
        id: 'alg',
        type: 'select',
        label: '算法',
        default: 'SHA-256',
        options: [
          { value: 'SHA-256', label: 'HMAC-SHA-256' },
          { value: 'SHA-1', label: 'HMAC-SHA-1' },
          { value: 'SHA-384', label: 'HMAC-SHA-384' },
          { value: 'SHA-512', label: 'HMAC-SHA-512' },
        ],
      },
      {
        id: 'fmt',
        type: 'select',
        label: '输出格式',
        default: 'hex',
        options: [
          { value: 'hex', label: 'hex' },
          { value: 'b64', label: 'Base64' },
        ],
      },
    ],
  },
  {
    async run(v) {
      const msg = S(v, 'msg');
      const key = S(v, 'key');
      if (!msg || !key) return { text: '' };
      const alg = S(v, 'alg');
      const ck = await crypto.subtle.importKey(
        'raw',
        enc.encode(key),
        { name: 'HMAC', hash: alg },
        false,
        ['sign'],
      );
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, enc.encode(msg)));
      return {
        text: S(v, 'fmt') === 'b64' ? bytesToB64(sig) : toHex(sig),
        meta: `HMAC-${alg} · ${sig.length * 8} bit`,
      };
    },
  },
];

// ── keypair ───────────────────────────────────────────────
function pem(label: string, buf: ArrayBuffer): string {
  const b64 = bytesToB64(new Uint8Array(buf));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export const keypair: [ToolMeta, ToolImpl] = [
  {
    slug: 'keypair',
    name: '密钥对生成',
    blurb: 'Ed25519 / ECDSA / RSA，导出为 PEM',
    category: 'generate',
    aliases: ['keypair', 'key', 'rsa', 'ecdsa', 'ed25519', 'pem', 'ssh', '密钥对', '公钥', '私钥'],
    sensitive: true,
    action: '生成密钥对',
    inputs: [
      {
        id: 'alg',
        type: 'select',
        label: '算法',
        default: 'Ed25519',
        hint: 'Ed25519 最短最快；RSA-4096 生成需要几秒',
        options: [
          { value: 'Ed25519', label: 'Ed25519 — 签名' },
          { value: 'X25519', label: 'X25519 — 密钥协商' },
          { value: 'P-256', label: 'ECDSA P-256' },
          { value: 'P-384', label: 'ECDSA P-384' },
          { value: 'RSA-2048', label: 'RSA 2048' },
          { value: 'RSA-4096', label: 'RSA 4096' },
        ],
      },
    ],
  },
  {
    async run(v) {
      const a = S(v, 'alg');
      let params: EcKeyGenParams | RsaHashedKeyGenParams | Algorithm;
      let usages: KeyUsage[];
      if (a === 'Ed25519') {
        params = { name: 'Ed25519' };
        usages = ['sign', 'verify'];
      } else if (a === 'X25519') {
        params = { name: 'X25519' };
        usages = ['deriveBits'];
      } else if (a.startsWith('P-')) {
        params = { name: 'ECDSA', namedCurve: a };
        usages = ['sign', 'verify'];
      } else {
        params = {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: a === 'RSA-4096' ? 4096 : 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        };
        usages = ['sign', 'verify'];
      }
      const t0 = performance.now();
      const kp = (await crypto.subtle.generateKey(params as AlgorithmIdentifier, true, usages)) as CryptoKeyPair;
      const ms = Math.round(performance.now() - t0);
      const [pub, priv] = await Promise.all([
        crypto.subtle.exportKey('spki', kp.publicKey),
        crypto.subtle.exportKey('pkcs8', kp.privateKey),
      ]);
      const fpFull = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', pub)));
      return {
        blocks: [
          { label: '公钥 (SPKI / PEM)', text: pem('PUBLIC KEY', pub), meta: `${a} · 生成耗时 ${ms} ms`, filename: 'public.pem' },
          { label: '私钥 (PKCS#8 / PEM)', text: pem('PRIVATE KEY', priv), meta: '仅存在于本页内存', filename: 'private.pem', secret: true },
          // The trailing "…" used to be part of the copied string, so pasting
          // the fingerprint anywhere produced a value with an ellipsis in it.
          // Show the full digest: there is no width problem to solve here, and
          // a fingerprint you cannot paste is not a fingerprint.
          { label: '公钥指纹', text: `SHA-256:${fpFull}`, meta: 'SHA-256(公钥 SPKI)，用于快速比对' },
        ],
        warning: '私钥只在这个页面的内存里，刷新即永久丢失。请立刻复制或下载保存，本站不做任何存储或上传。',
      };
    },
  },
];

// ── totp ──────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  if (!clean) return new Uint8Array(0);
  const bad = clean.split('').find((c) => !B32.includes(c));
  if (bad) throw new ToolError(`不是合法的 Base32 密钥：出现了字符 "${bad}"（只允许 A-Z 和 2-7）`, 'secret');
  let bits = '';
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.substr(i * 8, 8), 2);
  return out;
}

export const totp: [ToolMeta, ToolImpl] = [
  {
    slug: 'totp',
    name: 'TOTP 验证码',
    blurb: '从 Base32 密钥算出当前 2FA 码',
    category: 'generate',
    aliases: ['totp', '2fa', 'otp', 'mfa', 'authenticator', '验证码', '双因素'],
    sensitive: true,
    inputs: [
      {
        id: 'secret',
        type: 'text',
        label: 'Base32 密钥',
        mono: true,
        placeholder: 'JBSWY3DPEHPK3PXP',
        hint: '来自 otpauth:// 链接里的 secret 参数',
        sample: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      },
      { id: 'digits', type: 'select', label: '位数', default: '6', options: [{ value: '6', label: '6 位' }, { value: '8', label: '8 位' }] },
      { id: 'period', type: 'select', label: '周期', default: '30', options: [{ value: '30', label: '30 秒' }, { value: '60', label: '60 秒' }] },
      {
        id: 'alg',
        type: 'select',
        label: '算法',
        default: 'SHA-1',
        options: [
          { value: 'SHA-1', label: 'SHA-1（标准）' },
          { value: 'SHA-256', label: 'SHA-256' },
          { value: 'SHA-512', label: 'SHA-512' },
        ],
      },
    ],
  },
  {
    tick: 1000,
    async run(v) {
      const secret = S(v, 'secret');
      if (!secret.trim()) return { text: '' };
      const key = b32decode(secret);
      if (key.length === 0) throw new ToolError('密钥解码后为空', 'secret');
      const digits = N(v, 'digits') || 6;
      const period = N(v, 'period') || 30;
      const alg = S(v, 'alg') || 'SHA-1';

      const ck = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: alg }, false, ['sign']);
      const code = async (counter: number) => {
        const buf = new ArrayBuffer(8);
        // Big-endian 64-bit counter (RFC 4226 §5.1). setUint32's third
        // argument defaults to false = big-endian, but writing it out
        // explicitly is the difference between passing and failing the RFC
        // 6238 vectors — an earlier version omitted it on the low word and
        // silently produced plausible-looking wrong codes.
        const dv = new DataView(buf);
        dv.setUint32(0, Math.floor(counter / 2 ** 32), false);
        dv.setUint32(4, counter >>> 0, false);
        const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, buf));
        const off = sig[sig.length - 1]! & 0x0f;
        const bin =
          ((sig[off]! & 0x7f) << 24) | (sig[off + 1]! << 16) | (sig[off + 2]! << 8) | sig[off + 3]!;
        return (bin % 10 ** digits).toString().padStart(digits, '0');
      };

      const nowSec = Math.floor(Date.now() / 1000);
      const counter = Math.floor(nowSec / period);
      const remain = period - (nowSec % period);
      const [cur, next] = await Promise.all([code(counter), code(counter + 1)]);
      const bar = '█'.repeat(Math.round((remain / period) * 20)).padEnd(20, '░');

      return {
        blocks: [
          { text: cur.replace(/(\d{3})(?=\d)/g, '$1 '), meta: `${alg} · ${digits} 位 · ${period} 秒` },
          { label: '剩余有效期', text: `${bar}  ${remain} 秒`, nocopy: true },
          { label: '下一个码', text: next.replace(/(\d{3})(?=\d)/g, '$1 '), meta: '用于时钟漂移时对照' },
        ],
      };
    },
  },
];

// ── qr ────────────────────────────────────────────────────
export const qr: [ToolMeta, ToolImpl] = [
  {
    slug: 'qr',
    name: '二维码生成',
    blurb: '文本转二维码，可下载 SVG',
    category: 'generate',
    aliases: ['qr', 'qrcode', '二维码', 'barcode', 'wifi'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '内容',
        mono: true,
        sample: 'https://whitebox.judy2006969.me',
      },
      {
        id: 'ec',
        type: 'select',
        label: '纠错级别',
        default: 'M',
        hint: '级别越高越抗污损，但容量越小',
        options: [
          { value: 'L', label: 'L — 7%' },
          { value: 'M', label: 'M — 15%' },
          { value: 'Q', label: 'Q — 25%' },
          { value: 'H', label: 'H — 30%' },
        ],
      },
    ],
  },
  {
    async run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      // Our own encoder, not an npm package. A site whose whole claim is
      // "nothing leaves your browser" should not ask visitors to trust a
      // third-party bundle on the page that generates their WiFi password
      // QR code. ~300 lines is a fair price for that.
      const { encodeQr, qrToSvg } = await import('../qr.ts');
      const ec = S(v, 'ec') as 'L' | 'M' | 'Q' | 'H';
      let q;
      try {
        q = encodeQr(t, ec);
      } catch (e) {
        throw new ToolError((e as Error).message, 'text');
      }
      const svg = qrToSvg(q, { margin: 2, scale: 8, dark: '#0e1217', light: '#ffffff' });
      const pct = Math.round((q.usedBytes / q.capacityBytes) * 100);
      return {
        blocks: [
          {
            label: '二维码',
            text: '',
            nocopy: true,
            html: `<div style="background:#fff;padding:12px;border-radius:6px;display:inline-block;max-width:100%">${svg}</div>`,
          },
          {
            label: 'SVG 源码',
            text: svg,
            meta: `版本 ${q.version} · ${q.size}×${q.size} · 纠错 ${ec} · 容量已用 ${pct}%`,
            filename: 'qrcode.svg',
          },
        ],
      };
    },
  },
];
