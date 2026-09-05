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

/** Copy button, shared by card and row renderers. */
function copyButton(getText: () => string): HTMLButtonElement {
  const copy = document.createElement('button');
  copy.className = 'btn';
  copy.type = 'button';
  copy.textContent = '复制';
  copy.addEventListener('click', async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
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
  return copy;
}

/**
 * A block is a "row" when its value is a single short line. Seven hashes as
 * full cards measured 718px on the live site; as rows they fit in ~250px.
 */
function isRow(b: OutputBlock): boolean {
  return !b.html && !b.nocopy && !!b.text && !b.text.includes('\n') && b.text.length <= 140;
}

function renderBlocks(host: HTMLElement, res: RunResult, meta: ToolMeta) {
  const blocks: OutputBlock[] = res.blocks ?? (res.text !== undefined ? [{ text: res.text, meta: res.meta }] : []);
  host.textContent = '';

  if (!blocks.length || blocks.every((b) => !b.text && !b.html)) {
    const empty = document.createElement('div');
    empty.className = 'out-empty';
    empty.textContent = meta.action
      ? `点击「${meta.action}」生成结果 — 全部在本机计算，断网可用`
      : '在左侧输入内容即可实时计算 — 全部在本机完成，断网可用';
    host.appendChild(empty);
    return;
  }

  // Rows only pay off when several of them stack up; a lone value keeps the
  // roomier card so it still reads as the page's primary answer.
  const rowMode = blocks.filter(isRow).length >= 3;

  for (const b of blocks) {
    if (rowMode && isRow(b)) {
      const row = document.createElement('div');
      row.className = 'kv';

      const key = document.createElement('span');
      key.className = 'kv-key';
      key.textContent = b.label ?? '输出';

      const val = document.createElement('span');
      val.className = 'kv-val flash';
      val.textContent = b.text;
      val.title = b.text;

      row.append(key, val);
      if (b.meta) {
        const m = document.createElement('span');
        m.className = 'kv-meta';
        m.textContent = b.meta;
        row.appendChild(m);
      }
      row.appendChild(copyButton(() => b.text));
      host.appendChild(row);
      continue;
    }

    const wrap = document.createElement('div');
    wrap.className = 'out-block';

    // Classify the block so the stylesheet can bound it. Without this, output
    // grows without limit: /t/qr measured 2477px (its SVG source alone 2121px)
    // and /t/case 1012px against a 910px viewport. Kinds are derived from the
    // block's own shape rather than hardcoded per tool:
    //
    //   graphic   — an actual image (QR svg, colour swatch): centre + cap.
    //               ⚠️ `b.html` alone is NOT the test. regex highlights and
    //               diff hunks are also HTML, and centring *text* in a flex
    //               row is wrong — they were briefly rendered that way.
    //   accessory — long text that is reference material, not the answer.
    //               Only ever a *secondary* block, so a single long output
    //               (JSON formatter, diff) is never capped.
    //   compact   — several blocks on screen: drop the 60px per-block floor.
    const isGraphic = !!b.html && /<(svg|img|canvas)\b/i.test(b.html);
    // Reference material is long text OR a secondary data table (Unicode's
    // codepoint list measured 488px). Graphics are excluded: they are already
    // capped at 240px and scrolling an image is worse than seeing it.
    const isLongText = !b.html && !!b.text && (b.text.length > 400 || b.text.split('\n').length > 8);
    const isTable = !!b.html && !isGraphic && /<table\b/i.test(b.html);
    const isLong = isLongText || isTable;
    if (isGraphic) wrap.classList.add('graphic');
    if (blocks.length > 1 && isLong) wrap.classList.add('accessory');
    if (blocks.length > 2) wrap.classList.add('compact');

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
      head.appendChild(copyButton(() => b.text));

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

    // Character counts. With two text areas (diff) a single figure taken from
    // the first one is worse than none: it silently describes half the input.
    // Label each instead.
    const areas = meta.inputs.filter((f) => f.type === 'textarea');
    if (counts && areas.length) {
      const stat = (id: string) => {
        const t = String(v[id] ?? '');
        return t
          ? `${Array.from(t).length} 字符 · ${new TextEncoder().encode(t).length} 字节 · ${t.split('\n').length} 行`
          : '';
      };
      counts.textContent =
        areas.length === 1
          ? stat(areas[0]!.id)
          : areas
              .map((f) => {
                const s = stat(f.id);
                return s ? `${f.label}: ${s}` : '';
              })
              .filter(Boolean)
              .join('　');
    }

    // Dim controls that do nothing in the current mode. A lit control that
    // has no effect is a small lie the interface tells every time.
    for (const f of meta.inputs) {
      if (!f.activeWhen) continue;
      const el = document.getElementById(`f-${f.id}`) as HTMLInputElement | null;
      if (!el) continue;
      const on = f.activeWhen(v);
      el.disabled = !on;
      el.closest('.field')?.classList.toggle('field-off', !on);
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

    // text-color: the swatch and the text field are one control in two parts,
    // so each has to follow the other. The picker only speaks #rrggbb, so it
    // silently ignores rgb()/named input rather than clobbering it.
    if (f.type === 'text-color') {
      const picker = document.getElementById(`f-${f.id}-picker`) as HTMLInputElement | null;
      const text = el as HTMLInputElement;
      if (picker) {
        picker.addEventListener('input', () => {
          text.value = picker.value;
          schedule();
        });
        text.addEventListener('input', () => {
          const hex = text.value.trim();
          if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
            picker.value = hex.length === 4
              ? '#' + hex.slice(1).split('').map((ch) => ch + ch).join('')
              : hex;
          }
        });
      }
    }
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

  // Input affordances: clear always, paste where the Clipboard API allows it.
  //
  // These attach per *textarea*, not once per page. Binding them to a single
  // "primary" field left /t/diff's second pane unreachable: 清空 emptied A and
  // left B's 102 characters stranded with no way to clear or paste them, and
  // the header's character count silently described A alone. Any tool with
  // two text areas has the same shape, so fix the rule, not the page.
  const areaFields = meta.inputs.filter((f) => f.type === 'textarea');
  const affordanceFields = areaFields.length
    ? areaFields
    : meta.inputs.filter((f) => f.type === 'text').slice(0, 1);
  const multi = affordanceFields.length > 1;

  for (const field of affordanceFields) {
    const el = document.getElementById(`f-${field.id}`) as HTMLTextAreaElement | HTMLInputElement | null;
    if (!el) continue;
    // With several areas the buttons belong on each field's own label row;
    // with one they sit in the panel header where there is more room.
    const host = multi
      ? el.closest('.field')?.querySelector('label')
      : el.closest('.panel')?.querySelector('.panel-head');
    const head = host as HTMLElement | null | undefined;
    if (head) {
      if (multi) head.classList.add('label-with-actions');
      const clear = document.createElement('button');
      clear.className = 'btn';
      clear.type = 'button';
      clear.textContent = '清空';
      clear.title = multi ? `清空「${field.label}」` : '清空输入';
      clear.hidden = !el.value;
      clear.addEventListener('click', () => {
        el.value = '';
        delete el.dataset.sample;
        el.focus();
        run();
        clear.hidden = true;
      });
      el.addEventListener('input', () => { clear.hidden = !el.value; });

      const paste = document.createElement('button');
      paste.className = 'btn';
      paste.type = 'button';
      paste.textContent = '粘贴';
      paste.title = multi ? `粘贴到「${field.label}」` : '从剪贴板粘贴';
      paste.addEventListener('click', async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (!t) return;
          el.value = t;
          delete el.dataset.sample;
          clear.hidden = false;
          run();
        } catch {
          paste.textContent = '需要剪贴板权限';
          setTimeout(() => { paste.textContent = '粘贴'; }, 1600);
        }
      });

      // Secret-bearing tools get an explicit, harmless sample instead of a
      // blank pane that reads as a crash. RFC vectors carry no privacy risk.
      const sampleField = meta.inputs.find((f) => f.sample);
      if (!multi && meta.sensitive && sampleField) {
        const demo = document.createElement('button');
        demo.className = 'btn';
        demo.type = 'button';
        demo.textContent = '填入示例';
        demo.title = '填入公开的 RFC 测试向量，不含真实机密';
        demo.addEventListener('click', () => {
          const target = document.getElementById(`f-${sampleField.id}`) as HTMLTextAreaElement | null;
          if (!target) return;
          target.value = sampleField.sample!;
          clear.hidden = false;
          run();
        });
        head.appendChild(demo);
      }

      if (typeof navigator.clipboard?.readText === 'function') head.appendChild(paste);
      head.appendChild(clear);
    }
  }

  run();
  if (impl.tick) setInterval(() => run(), impl.tick);

  // Mobile peek bar: shows the first line of output while the keyboard covers
  // the real output pane. Only mounts when a soft keyboard is plausible.
  if (matchMedia('(max-width: 640px)').matches) {
    const peek = document.createElement('div');
    peek.className = 'peek';
    peek.hidden = true;
    const val = document.createElement('span');
    val.className = 'peek-val';
    const jump = document.createElement('button');
    jump.className = 'btn';
    jump.type = 'button';
    jump.textContent = '查看';
    jump.addEventListener('click', () => {
      outHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (document.activeElement as HTMLElement)?.blur();
    });
    peek.append(val, jump);
    document.body.appendChild(peek);

    const update = () => {
      const first = outHost.querySelector('.kv-val, .out-text')?.textContent?.trim() ?? '';
      const err = errHost.textContent?.trim();
      val.textContent = err ? `⚠ ${err.split('\n')[0]}` : first;
      val.style.color = err ? 'var(--danger)' : '';
    };
    new MutationObserver(update).observe(outHost, { childList: true, subtree: true, characterData: true });

    for (const f of meta.inputs) {
      const el = document.getElementById(`f-${f.id}`);
      el?.addEventListener('focus', () => {
        if (f.type === 'textarea' || f.type === 'text') {
          update();
          peek.hidden = false;
        }
      });
      el?.addEventListener('blur', () => {
        setTimeout(() => {
          if (!(document.activeElement instanceof HTMLTextAreaElement) &&
              !(document.activeElement instanceof HTMLInputElement)) peek.hidden = true;
        }, 120);
      });
    }
  }

  // Desktop only: land in the input so the user can just start typing.
  // On touch this would pop the keyboard and hide the whole page.
  // Note: check dataset.fromUrl, not location.hash — the first run() already
  // wrote sample state into the hash, so location.hash is never empty here.
  const focusField = affordanceFields[0];
  if (matchMedia('(pointer: fine)').matches && focusField && !document.body.dataset.fromUrl) {
    const el = document.getElementById(`f-${focusField.id}`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus({ preventScroll: true });
      if (el.dataset.sample === '1') el.select();
    }
  }
}
