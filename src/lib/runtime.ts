import type { ToolMeta, Values, RunResult, OutputBlock } from './types.ts';
import { ToolError } from './types.ts';
import { IMPLS } from './registry.ts';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

function readValues(meta: ToolMeta): Values {
  const v: Values = {};
  for (const f of meta.inputs) {
    const el = document.getElementById(`f-${f.id}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) continue;
    if (f.type === 'checkbox') v[f.id] = (el as HTMLInputElement).checked;
    else if (f.type === 'number' || f.type === 'range') v[f.id] = Number(el.value);
    else v[f.id] = el.value;
  }
  return v;
}

/** URL state, whitelisted. Sensitive tools never write to the URL at all. */
function syncUrl(meta: ToolMeta, v: Values) {
  if (meta.sensitive) return;
  const params = new URLSearchParams();
  for (const f of meta.inputs) {
    const cur = v[f.id];
    const def = f.default ?? (f.type === 'checkbox' ? false : '');
    if (String(cur) !== String(def) && String(cur) !== '') params.set(f.id, String(cur));
  }
  const q = params.toString();
  const url = q ? `${location.pathname}#${q}` : location.pathname;
  history.replaceState(null, '', url);
  const share = $('#share') as HTMLButtonElement | null;
  if (share) share.disabled = !q;
}

function applyUrl(meta: ToolMeta) {
  if (meta.sensitive) return;
  const hash = location.hash.slice(1);
  if (!hash) return;
  const params = new URLSearchParams(hash);
  let applied = false;
  for (const f of meta.inputs) {
    if (!params.has(f.id)) continue;
    const el = document.getElementById(`f-${f.id}`) as HTMLInputElement | null;
    if (!el) continue;
    const raw = params.get(f.id)!;
    if (f.type === 'checkbox') el.checked = raw === 'true';
    else el.value = raw;
    applied = true;
  }
  if (applied) document.body.dataset.fromUrl = '1';
}

function renderBlocks(host: HTMLElement, res: RunResult, meta: ToolMeta) {
  const blocks: OutputBlock[] = res.blocks ?? (res.text !== undefined ? [{ text: res.text, meta: res.meta }] : []);
  host.textContent = '';
  for (const b of blocks) {
    const wrap = document.createElement('div');
    wrap.className = 'out-block';

    const head = document.createElement('div');
    head.className = 'panel-head';
    const label = document.createElement('span');
    label.textContent = b.label ?? '输出';
    head.appendChild(label);
    const grow = document.createElement('span');
    grow.className = 'grow';
    head.appendChild(grow);
    if (b.meta) {
      const m = document.createElement('span');
      m.className = 'counts';
      m.textContent = b.meta;
      head.appendChild(m);
    }

    const body = document.createElement('div');
    if (b.html) {
      body.innerHTML = b.html;
      body.style.padding = 'var(--space-3)';
    } else {
      body.className = 'out-text flash';
      body.textContent = b.text;
    }

    if (!b.nocopy && b.text) {
      const copy = document.createElement('button');
      copy.className = 'btn';
      copy.type = 'button';
      copy.textContent = '复制';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b.text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = b.text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        copy.textContent = '已复制';
        copy.classList.add('ok');
        setTimeout(() => {
          copy.textContent = '复制';
          copy.classList.remove('ok');
        }, 1200);
      });
      head.appendChild(copy);

      if (b.filename) {
        const dl = document.createElement('button');
        dl.className = 'btn';
        dl.type = 'button';
        dl.textContent = '下载';
        dl.title = b.filename;
        dl.addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([b.text], { type: 'text/plain;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = b.filename!;
          a.click();
          URL.revokeObjectURL(url);
        });
        head.appendChild(dl);
      }
    }

    wrap.append(head, body);
    host.appendChild(wrap);
  }
}

export function mountTool(meta: ToolMeta) {
  const impl = IMPLS[meta.slug];
  if (!impl) return;
  const outHost = $('#out')!;
  const errHost = $('#err')!;
  const warnHost = $('#warn')!;
  const counts = $('#counts');

  let timer: number | undefined;
  let generation = 0;
  let lastGood = '';

  async function run(force = false) {
    const gen = ++generation;
    const v = readValues(meta);
    syncUrl(meta, v);

    const primary = meta.inputs.find((f) => f.type === 'textarea');
    if (counts && primary) {
      const t = String(v[primary.id] ?? '');
      counts.textContent = t ? `${Array.from(t).length} 字符 · ${new TextEncoder().encode(t).length} 字节 · ${t.split('\n').length} 行` : '';
    }

    try {
      const res = await impl.run(v);
      if (gen !== generation) return; // a newer run superseded this one
      errHost.textContent = '';
      for (const el of document.querySelectorAll('.field-err')) el.classList.remove('field-err');
      warnHost.textContent = res.warning ?? '';
      renderBlocks(outHost, res, meta);
      lastGood = JSON.stringify(res.blocks ?? res.text ?? '');
    } catch (e) {
      if (gen !== generation) return;
      const msg = e instanceof ToolError ? e.message : (e as Error).message;
      // Hold the last good output: invalid intermediate input is normal, and
      // wiping the result on every keystroke is the worst habit in this genre.
      errHost.textContent = msg;
      if (e instanceof ToolError && e.field) {
        document.getElementById(`f-${e.field}`)?.closest('.field')?.classList.add('field-err');
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = window.setTimeout(run, 140);
  }

  for (const f of meta.inputs) {
    const el = document.getElementById(`f-${f.id}`);
    if (!el) continue;
    el.addEventListener('input', () => {
      if (f.type === 'range') {
        const badge = document.getElementById(`v-${f.id}`);
        if (badge) badge.textContent = (el as HTMLInputElement).value;
      }
      schedule();
    });
    el.addEventListener('change', schedule);
  }

  $('#action')?.addEventListener('click', () => run(true));
  $('#share')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.href);
    const b = $('#share')!;
    const old = b.textContent;
    b.textContent = '链接已复制';
    b.classList.add('ok');
    setTimeout(() => { b.textContent = old; b.classList.remove('ok'); }, 1400);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      ($('#out .btn') as HTMLButtonElement | null)?.click();
    }
  });

  applyUrl(meta);

  // Prefill the live-demo sample only when the URL did not supply state and
  // the tool is not secret-bearing.
  if (!document.body.dataset.fromUrl && !meta.sensitive) {
    for (const f of meta.inputs) {
      if (!f.sample) continue;
      const el = document.getElementById(`f-${f.id}`) as HTMLTextAreaElement | null;
      if (el && !el.value) {
        el.value = f.sample;
        el.dataset.sample = '1';
        el.addEventListener('focus', function once() {
          if (el.dataset.sample === '1') {
            el.select();
            delete el.dataset.sample;
          }
          el.removeEventListener('focus', once);
        });
      }
    }
  }

  run();
  if (impl.tick) setInterval(() => run(), impl.tick);
}
