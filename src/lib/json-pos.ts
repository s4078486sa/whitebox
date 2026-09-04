/**
 * Locate the first structural error in a JSON document.
 *
 * Why this exists: V8's `JSON.parse` error message carries an explicit
 * "position N" only for inputs above a size threshold. Below it, the message
 * inlines a truncated copy of the source and omits the offset entirely — so
 * the small hand-edited config where a human most wants "line 3, column 7" is
 * exactly the case where the engine refuses to say. This scanner only ever
 * runs after `JSON.parse` has already thrown, so the happy path pays nothing.
 *
 * It is deliberately a *locator*, not a parser: it reports where the document
 * stops being valid JSON and leaves the wording of the error to V8.
 */
export function findJsonErrorPos(text: string): number {
  let i = 0;
  const n = text.length;

  const ws = () => {
    while (
      i < n &&
      (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')
    ) {
      i++;
    }
  };

  /** true = consumed a valid string; i is left just after the closing quote. */
  const str = (): boolean => {
    i++; // opening quote
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return true;
      }
      if (c === '\n') return false; // unterminated: JSON strings can't span lines
      i++;
    }
    return false;
  };

  /** -1 = this value parsed cleanly; otherwise the offset of the problem. */
  const value = (): number => {
    ws();
    if (i >= n) return i;
    const c = text[i];

    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return -1;
      }
      for (;;) {
        ws();
        const keyAt = i;
        if (text[i] !== '"' || !str()) return keyAt;
        ws();
        if (text[i] !== ':') return i;
        i++;
        const e = value();
        if (e >= 0) return e;
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return -1;
        }
        return i;
      }
    }

    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return -1;
      }
      for (;;) {
        const e = value();
        if (e >= 0) return e;
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return -1;
        }
        return i;
      }
    }

    if (c === '"') {
      const at = i;
      return str() ? -1 : at;
    }

    const lit = ['true', 'false', 'null'].find((l) => text.startsWith(l, i));
    if (lit) {
      i += lit.length;
      return -1;
    }

    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (m && m[0]) {
      i += m[0].length;
      return -1;
    }

    return i;
  };

  const err = value();
  if (err >= 0) return err;
  ws();
  return i < n ? i : n; // trailing garbage after a complete value
}
