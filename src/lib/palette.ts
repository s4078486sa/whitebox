/**
 * Global command palette.
 *
 * Every page already ships the tool index in `window.__WB_TOOLS`, but only the
 * homepage listened for a keystroke, which turned all 25 tool pages into
 * islands: getting from /t/hash to /t/jwt meant going back to the homepage.
 * This binds Cmd/Ctrl+K and `/` everywhere and reuses the same sniffing.
 */
import { sniff } from './sniff.ts';

interface ToolIndex {
  slug: string;
  name: string;
  blurb: string;
  aliases: string[];
}

const FIELD_MAP: Record<string, string> = {
  jwt: 'token', cidr: 'cidr', cron: 'expr', color: 'c',
  timestamp: 'input', 'base-convert': 'num', hmac: 'msg',
};

const RECENT_KEY = 'wb-recent';

export function pushRecent(slug: string) {
  try {
    const prev: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    const next = [slug, ...prev.filter((s) => s !== slug)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode: recents are a nicety, never a hard dependency */ }
}

export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function searchTools(tools: ToolIndex[], needle: string) {
  const n = needle.trim().toLowerCase();
  if (!n) return [];
  return tools
    .map((t) => {
      const hay = [t.name, t.blurb, ...t.aliases].join(' ').toLowerCase();
      if (t.aliases.some((a) => a === n)) return { t, score: 3 };
      if (t.name.toLowerCase().includes(n)) return { t, score: 2 };
      if (hay.includes(n)) return { t, score: 1 };
      return null;
    })
    .filter((x): x is { t: ToolIndex; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function hrefFor(slug: string, value: string, params?: Record<string, string>) {
  const p = new URLSearchParams(params ?? {});
  if (value) p.set(FIELD_MAP[slug] ?? 'text', value);
  const q = p.toString();
  return `/t/${slug}/${q ? `#${q}` : ''}`;
}

export function mountPalette() {
  const tools = (window as unknown as { __WB_TOOLS?: ToolIndex[] }).__WB_TOOLS;
  if (!tools) return;

  const overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="搜索工具">
      <input class="palette-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="搜索工具，或粘贴一段内容" aria-label="搜索工具，或粘贴内容自动识别" />
      <div class="results" id="palette-results" role="listbox"></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.palette-input') as HTMLInputElement;
  const box = overlay.querySelector('#palette-results') as HTMLDivElement;
  let cursor = -1;
  let lastFocus: HTMLElement | null = null;

  function render(raw: string) {
    box.textContent = '';
    cursor = -1;
    const s = raw.trim();

    if (!s) {
      const recent = getRecent()
        .map((slug) => tools!.find((t) => t.slug === slug))
        .filter(Boolean) as ToolIndex[];
      if (recent.length) {
        const head = document.createElement('div');
        head.className = 'sniff-head';
        head.textContent = '最近使用';
        box.appendChild(head);
        for (const t of recent) box.appendChild(rowFor(t.name, t.blurb, `/t/${t.slug}/`));
      }
      return;
    }

    const cands = s.length > 8 ? sniff(s) : [];
    if (cands.length) {
      const head = document.createElement('div');
      head.className = 'sniff-head';
      head.textContent = '检测到可能的格式';
      box.appendChild(head);
      for (const c of cands) {
        const tool = tools!.find((t) => t.slug === c.slug);
        box.appendChild(rowFor(tool?.name ?? c.slug, c.label, hrefFor(c.slug, c.value, c.params), true));
      }
    }

    const hits = searchTools(tools!, s);
    if (hits.length && cands.length) {
      const head = document.createElement('div');
      head.className = 'sniff-head';
      head.textContent = '工具';
      box.appendChild(head);
    }
    for (const h of hits) box.appendChild(rowFor(h.t.name, h.t.blurb, `/t/${h.t.slug}/`));

    if (!hits.length && !cands.length) {
      const empty = document.createElement('div');
      empty.className = 'sniff-head';
      empty.textContent = '没有匹配的工具';
      box.appendChild(empty);
    }
  }

  function rowFor(name: string, blurb: string, href: string, tag = false) {
    const a = document.createElement('a');
    a.className = 'result';
    a.setAttribute('role', 'option');
    a.href = href;
    const left = document.createElement('span');
    left.className = tag ? 'result-tag' : 'result-name';
    left.textContent = name;
    const right = document.createElement('span');
    right.className = 'result-blurb';
    right.textContent = blurb;
    a.append(left, right);
    return a;
  }

  function open() {
    if (!overlay.hidden) return;
    lastFocus = document.activeElement as HTMLElement;
    overlay.hidden = false;
    input.value = '';
    render('');
    input.focus();
  }

  function close() {
    overlay.hidden = true;
    box.textContent = '';
    lastFocus?.focus();
  }

  input.addEventListener('input', () => render(input.value));

  input.addEventListener('keydown', (e) => {
    const items = [...box.querySelectorAll<HTMLAnchorElement>('a.result')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      cursor = e.key === 'ArrowDown'
        ? (cursor + 1) % items.length
        : (cursor - 1 + items.length) % items.length;
      items.forEach((el, i) => el.setAttribute('aria-selected', String(i === cursor)));
      items[cursor]!.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const target = items[cursor] ?? items[0];
      if (target) { e.preventDefault(); location.href = target.href; }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // focus trap: the dialog holds one input, so keep focus on it
      e.preventDefault();
    }
  });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.hidden ? open() : close();
      return;
    }
    if (e.key === '/' && overlay.hidden) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      open();
    }
  });

  document.getElementById('palette-trigger')?.addEventListener('click', open);
}
