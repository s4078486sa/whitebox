import type { ToolMeta, ToolImpl, Values } from '../types.ts';
import { ToolError } from '../types.ts';

const S = (v: Values, k: string) => String(v[k] ?? '');
const B = (v: Values, k: string) => v[k] === true || v[k] === 'true';
const N = (v: Values, k: string) => Number(v[k]);

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── regex ─────────────────────────────────────────────────
export const regex: [ToolMeta, ToolImpl] = [
  {
    slug: 'regex',
    name: '正则测试',
    blurb: '实时高亮匹配，展开捕获组',
    category: 'inspect',
    aliases: ['regex', 'regexp', 're', '正则', 'match', 'pattern', 'grep'],
    workbench: true,
    inputs: [
      {
        id: 'pattern',
        type: 'text',
        label: '表达式',
        mono: true,
        default: '(\\w+)@(\\w+\\.\\w+)',
        placeholder: '(\\d{4})-(\\d{2})-(\\d{2})',
      },
      {
        id: 'flags',
        type: 'text',
        label: '修饰符',
        mono: true,
        default: 'g',
        hint: 'g 全局 · i 忽略大小写 · m 多行 · s 点匹配换行 · u Unicode',
      },
      {
        id: 'text',
        type: 'textarea',
        label: '测试文本',
        mono: true,
        sample:
          'white@mailpasta.de 是内部地址，\njudy2006969@gmail.com 是对外地址。\n联系 eyebrowkang@mailpasta.de 获取权限。',
      },
      {
        id: 'replace',
        type: 'text',
        label: '替换为（可选）',
        mono: true,
        placeholder: '$1 [at] $2',
        hint: '用 $1 $2 引用捕获组，留空则不替换',
      },
    ],
  },
  {
    run(v) {
      const pattern = S(v, 'pattern');
      const text = S(v, 'text');
      if (!pattern) return { text: '' };

      let flags = S(v, 'flags').replace(/[^gimsuyd]/g, '');
      if (!flags.includes('g')) flags += 'g';
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch (e) {
        throw new ToolError(`正则语法错误：${(e as Error).message.replace(/^Invalid regular expression: [^:]+: /, '')}`, 'pattern');
      }
      if (!text) return { text: '' };

      const matches: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) !== null && guard++ < 5000) {
        matches.push(m);
        if (m[0] === '') re.lastIndex++;
      }

      let html = '';
      let last = 0;
      for (const mm of matches) {
        html += esc(text.slice(last, mm.index));
        html += `<mark>${esc(mm[0]) || '∅'}</mark>`;
        last = mm.index + mm[0].length;
      }
      html += esc(text.slice(last));

      const rows = matches
        .slice(0, 200)
        .map((mm, i) => {
          const groups = mm
            .slice(1)
            .map((g, gi) => `<td>${g === undefined ? '<span style="color:var(--text-disabled)">—</span>' : esc(g)}</td>`)
            .join('');
          return `<tr><td>${i + 1}</td><td>${mm.index}</td><td>${esc(mm[0])}</td>${groups}</tr>`;
        })
        .join('');
      const groupCount = matches[0] ? matches[0].length - 1 : 0;
      const groupHead = Array.from({ length: groupCount }, (_, i) => `<th>$${i + 1}</th>`).join('');

      const blocks = [
        {
          label: `高亮（${matches.length} 处匹配）`,
          text: '',
          nocopy: true,
          html: `<div class="out-text" style="padding:0">${html || '<span style="color:var(--text-disabled)">无匹配</span>'}</div>`,
        },
      ];

      if (matches.length) {
        blocks.push({
          label: '匹配明细',
          text: '',
          nocopy: true,
          html: `<table class="data"><thead><tr><th>#</th><th>位置</th><th>完整匹配</th>${groupHead}</tr></thead><tbody>${rows}</tbody></table>`,
        });
      }

      const repl = S(v, 'replace');
      if (repl) {
        blocks.push({
          label: '替换结果',
          text: text.replace(new RegExp(pattern, flags), repl),
          nocopy: false,
        } as never);
      }

      return {
        blocks: blocks as never,
        warning: guard >= 5000 ? '匹配数超过 5000，已截断显示。' : undefined,
      };
    },
  },
];

// ── diff ──────────────────────────────────────────────────
/** Myers-ish LCS over lines. Fine for the sizes a browser tool sees. */
function lcsDiff(a: string[], b: string[]): [string, string][] {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) {
    return [['~', `两侧行数过多（${n} × ${m}），已跳过精确比对`]];
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: [string, string][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([' ', a[i]!]); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push(['-', a[i]!]); i++; }
    else { out.push(['+', b[j]!]); j++; }
  }
  while (i < n) out.push(['-', a[i++]!]);
  while (j < m) out.push(['+', b[j++]!]);
  return out;
}

export const diff: [ToolMeta, ToolImpl] = [
  {
    slug: 'diff',
    name: '文本对比',
    blurb: '逐行差异，统一 diff 格式输出',
    category: 'inspect',
    aliases: ['diff', 'compare', '对比', '差异', 'patch', 'merge'],
    workbench: true,
    inputs: [
      {
        id: 'a',
        type: 'textarea',
        label: '原始文本',
        mono: true,
        sample: 'server {\n  listen 80;\n  root /var/www;\n  index index.html;\n}',
      },
      {
        id: 'b',
        type: 'textarea',
        label: '修改后',
        mono: true,
        sample: 'server {\n  listen 443 ssl;\n  root /var/www;\n  index index.html;\n  ssl_certificate /etc/ssl/cert.pem;\n}',
      },
      { id: 'trim', type: 'checkbox', label: '忽略行首尾空白', default: false },
      { id: 'case', type: 'checkbox', label: '忽略大小写', default: false },
    ],
  },
  {
    run(v) {
      const prep = (s: string) => {
        let lines = s.split('\n');
        if (B(v, 'trim')) lines = lines.map((l) => l.trim());
        if (B(v, 'case')) lines = lines.map((l) => l.toLowerCase());
        return lines;
      };
      const rawA = S(v, 'a'), rawB = S(v, 'b');
      if (!rawA && !rawB) return { text: '' };
      const d = lcsDiff(prep(rawA), prep(rawB));

      let add = 0, del = 0;
      const html = d
        .map(([op, line]) => {
          if (op === '+') { add++; return `<div style="background:var(--success-surface);color:var(--success)">+ ${esc(line)}</div>`; }
          if (op === '-') { del++; return `<div style="background:var(--danger-surface);color:var(--danger)">- ${esc(line)}</div>`; }
          if (op === '~') return `<div style="color:var(--warning)">! ${esc(line)}</div>`;
          return `<div style="color:var(--text-muted)">  ${esc(line) || '&nbsp;'}</div>`;
        })
        .join('');
      const unified = d.map(([op, line]) => `${op}${line}`).join('\n');

      return {
        blocks: [
          {
            label: `差异（+${add} / −${del}）`,
            text: '',
            nocopy: true,
            html: `<div class="out-text" style="padding:var(--space-2)">${html}</div>`,
          },
          { label: '统一格式', text: unified, meta: `${d.length} 行`, filename: 'changes.diff' },
        ],
        warning: add === 0 && del === 0 ? '两侧内容完全相同。' : undefined,
      };
    },
  },
];

// ── text stats ────────────────────────────────────────────
export const textstats: [ToolMeta, ToolImpl] = [
  {
    slug: 'text-stats',
    name: '文本统计',
    blurb: '字符 / 词 / 行 / 字节，含中文与 token 估算',
    category: 'inspect',
    aliases: ['count', 'stats', 'wc', '字数', '统计', 'token', 'length'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '文本',
        mono: false,
        sample: 'Whitebox 是一个纯前端的开发者工具箱。\n所有计算都在你的浏览器里完成，没有任何数据离开这台机器。',
      },
    ],
  },
  {
    run(v) {
      const t = S(v, 'text');
      if (!t) return { text: '' };
      const bytes = new TextEncoder().encode(t).length;
      const cps = Array.from(t);
      const cjk = cps.filter((c) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c)).length;
      const latinWords = (t.match(/[A-Za-z0-9_'-]+/g) ?? []).length;
      const lines = t.split('\n');
      const nonEmpty = lines.filter((l) => l.trim()).length;
      const paras = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
      const sentences = (t.match(/[.!?。！？]+/g) ?? []).length;
      const longest = lines.reduce((a, l) => Math.max(a, l.length), 0);
      // rough: ~4 chars/token for latin, ~1.5 chars/token for CJK
      const tokens = Math.round((cps.length - cjk) / 4 + cjk / 1.5);
      const readMin = ((latinWords + cjk / 2) / 220).toFixed(1);

      const rows: [string, string][] = [
        ['字符（含空白）', String(cps.length)],
        ['字符（不含空白）', String(cps.filter((c) => !/\s/.test(c)).length)],
        ['UTF-8 字节', String(bytes)],
        ['单词（拉丁）', String(latinWords)],
        ['汉字/假名/谚文', String(cjk)],
        ['行数', `${lines.length}（非空 ${nonEmpty}）`],
        ['段落', String(paras)],
        ['句子', String(sentences)],
        ['最长行', `${longest} 字符`],
        ['token 估算', `≈ ${tokens}`],
        ['朗读时长', `≈ ${readMin} 分钟`],
      ];
      return {
        blocks: [
          {
            text: rows.map(([k, val]) => `${k.padEnd(18, ' ')}${val}`).join('\n'),
            nocopy: false,
            meta: 'token 与时长为粗略估算',
          },
        ],
      };
    },
  },
];

// ── case convert ──────────────────────────────────────────
function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);
}

export const casing: [ToolMeta, ToolImpl] = [
  {
    slug: 'case',
    name: '命名风格转换',
    blurb: 'camel / snake / kebab / PascalCase 等',
    category: 'inspect',
    aliases: ['case', 'camel', 'snake', 'kebab', 'pascal', '命名', '驼峰', 'naming', 'slug'],
    inputs: [
      {
        id: 'text',
        type: 'textarea',
        label: '输入（每行一个）',
        mono: true,
        sample: 'user_account_id\ngetHTTPResponseCode\nbackground-color',
      },
    ],
  },
  {
    run(v) {
      const src = S(v, 'text').trim();
      if (!src) return { text: '' };
      const lines = src.split('\n').filter((l) => l.trim());

      const styles: [string, (w: string[]) => string][] = [
        ['camelCase', (w) => w.map((x, i) => (i ? x[0]!.toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase())).join('')],
        ['PascalCase', (w) => w.map((x) => x[0]!.toUpperCase() + x.slice(1).toLowerCase()).join('')],
        ['snake_case', (w) => w.map((x) => x.toLowerCase()).join('_')],
        ['SCREAMING_SNAKE', (w) => w.map((x) => x.toUpperCase()).join('_')],
        ['kebab-case', (w) => w.map((x) => x.toLowerCase()).join('-')],
        ['dot.case', (w) => w.map((x) => x.toLowerCase()).join('.')],
        ['path/case', (w) => w.map((x) => x.toLowerCase()).join('/')],
        ['Title Case', (w) => w.map((x) => x[0]!.toUpperCase() + x.slice(1).toLowerCase()).join(' ')],
      ];

      return {
        blocks: styles.map(([name, fn]) => ({
          label: name,
          text: lines.map((l) => fn(splitWords(l.trim()))).join('\n'),
        })),
      };
    },
  },
];

// ── ip / cidr ─────────────────────────────────────────────
function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new ToolError(`"${ip}" 不是合法的 IPv4（需要 4 段）`, 'cidr');
  let n = 0;
  for (const p of parts) {
    const x = Number(p);
    if (!/^\d+$/.test(p) || x < 0 || x > 255) throw new ToolError(`"${p}" 不是合法的 IPv4 段（0-255）`, 'cidr');
    n = n * 256 + x;
  }
  return n;
}
const intToIp = (n: number) =>
  [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

export const cidr: [ToolMeta, ToolImpl] = [
  {
    slug: 'cidr',
    name: 'IP / CIDR 计算',
    blurb: '网段范围、掩码、可用主机数',
    category: 'inspect',
    aliases: ['ip', 'cidr', 'subnet', 'netmask', '子网', '网段', 'ipv4', 'network'],
    inputs: [
      {
        id: 'cidr',
        type: 'text',
        label: 'CIDR 或 IP/掩码',
        mono: true,
        default: '192.168.10.0/24',
        placeholder: '10.0.0.0/8 · 192.168.1.55/26',
      },
    ],
  },
  {
    run(v) {
      const raw = S(v, 'cidr').trim();
      if (!raw) return { text: '' };
      const [ipPart, prefixPart] = raw.split('/');
      const ip = ipToInt(ipPart!.trim());
      const prefix = prefixPart === undefined ? 32 : Number(prefixPart);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        throw new ToolError(`前缀长度 "${prefixPart}" 无效，应为 0-32`, 'cidr');
      }

      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const network = (ip & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      const total = 2 ** (32 - prefix);
      const usable = prefix >= 31 ? (prefix === 32 ? 1 : 2) : total - 2;

      const isPrivate =
        (ip >>> 24) === 10 ||
        ((ip >>> 20) & 0xfff) === 0xac1 ||
        (ip >>> 16) === 0xc0a8 ||
        (ip >>> 24) === 127;

      const rows: [string, string][] = [
        ['网络地址', `${intToIp(network)}/${prefix}`],
        ['子网掩码', intToIp(mask)],
        ['通配符掩码', intToIp(~mask >>> 0)],
        ['广播地址', intToIp(broadcast)],
        ['可用范围', prefix >= 31 ? intToIp(network) + ' – ' + intToIp(broadcast) : `${intToIp(network + 1)} – ${intToIp(broadcast - 1)}`],
        ['地址总数', total.toLocaleString('en-US')],
        ['可用主机数', usable.toLocaleString('en-US')],
        ['二进制掩码', intToIp(mask).split('.').map((o) => Number(o).toString(2).padStart(8, '0')).join('.')],
        ['地址类型', isPrivate ? '私有 / 环回（RFC 1918）' : '公网'],
      ];

      const subnets: string[] = [];
      if (prefix < 30) {
        const childPrefix = prefix + 1;
        const size = 2 ** (32 - childPrefix);
        subnets.push(
          `${intToIp(network)}/${childPrefix}`,
          `${intToIp((network + size) >>> 0)}/${childPrefix}`,
        );
      }

      return {
        blocks: [
          {
            text: rows.map(([k, val]) => `${k.padEnd(14, ' ')}${val}`).join('\n'),
            meta: `/${prefix} · ${total.toLocaleString('en-US')} 个地址`,
          },
          ...(subnets.length
            ? [{ label: '拆分为两个子网', text: subnets.join('\n'), meta: `/${prefix + 1}` }]
            : []),
        ],
      };
    },
  },
];
