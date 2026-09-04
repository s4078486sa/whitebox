/** A self-contained QR Code encoder (ISO/IEC 18004).
 *
 * Written rather than pulled from npm on purpose: this site's pitch is "runs
 * in your browser, nothing leaves it", and every third-party script is one
 * more thing a visitor has to take on faith. ~300 lines is a fair price.
 *
 * Supports byte mode (UTF-8) and numeric/alphanumeric auto-selection,
 * versions 1–40, all four EC levels, and mask selection by the standard
 * penalty rules.
 */

export type Ecl = "L" | "M" | "Q" | "H";

const ECL_ORDER: Ecl[] = ["M", "L", "H", "Q"]; // format-info bit order
const ECL_INDEX: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 };

// ECC codewords per block, then block counts, indexed [ecl][version-1]
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  // L
  [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // M
  [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Q
  [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // H
  [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

class BitBuf {
  bits: number[] = [];
  put(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver: number, ecl: Ecl): number {
  const e = ECL_INDEX[ecl];
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[e][ver - 1] * NUM_ERROR_CORRECTION_BLOCKS[e][ver - 1]
  );
}

/* ---- Reed-Solomon over GF(256) ---- */

function rsDivisor(degree: number): number[] {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((d, i) => (result[i] ^= gfMul(d, factor)));
  }
  return result;
}

/* ---- encoding ---- */

type Mode = "numeric" | "alnum" | "byte";

function pickMode(text: string): Mode {
  if (/^\d*$/.test(text)) return "numeric";
  if ([...text].every((c) => ALNUM.includes(c))) return "alnum";
  return "byte";
}

function charCountBits(mode: Mode, ver: number): number {
  const i = ver <= 9 ? 0 : ver <= 26 ? 1 : 2;
  return { numeric: [10, 12, 14], alnum: [9, 11, 13], byte: [8, 16, 16] }[mode][i];
}

function encodeSegment(text: string, mode: Mode, ver: number, bb: BitBuf, bytes: Uint8Array) {
  const modeBits = { numeric: 1, alnum: 2, byte: 4 }[mode];
  bb.put(modeBits, 4);
  const count = mode === "byte" ? bytes.length : text.length;
  bb.put(count, charCountBits(mode, ver));
  if (mode === "numeric") {
    for (let i = 0; i < text.length; ) {
      const n = Math.min(3, text.length - i);
      bb.put(parseInt(text.substr(i, n), 10), n * 3 + 1);
      i += n;
    }
  } else if (mode === "alnum") {
    for (let i = 0; i < text.length; ) {
      if (i + 1 < text.length) {
        bb.put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
        i += 2;
      } else {
        bb.put(ALNUM.indexOf(text[i]), 6);
        i++;
      }
    }
  } else {
    for (const b of bytes) bb.put(b, 8);
  }
}

export interface QrResult {
  size: number;
  modules: boolean[][];
  version: number;
  ecl: Ecl;
  mode: Mode;
  capacityBytes: number;
  usedBytes: number;
}

export function encodeQr(text: string, ecl: Ecl = "M", minVersion = 1): QrResult {
  if (!text) throw new Error("内容为空");
  const bytes = new TextEncoder().encode(text);
  const mode = pickMode(text);

  let version = 0;
  let dataCapacityBits = 0;
  for (let v = Math.max(1, minVersion); v <= 40; v++) {
    const cap = numDataCodewords(v, ecl) * 8;
    const bb = new BitBuf();
    encodeSegment(text, mode, v, bb, bytes);
    if (bb.length <= cap) {
      version = v;
      dataCapacityBits = cap;
      break;
    }
  }
  if (!version) {
    throw new Error(
      `内容太长：${bytes.length} 字节超出 QR 码在纠错级别 ${ecl} 下的最大容量。改用更低的纠错级别，或缩短内容。`,
    );
  }

  const bb = new BitBuf();
  encodeSegment(text, mode, version, bb, bytes);
  bb.put(0, Math.min(4, dataCapacityBits - bb.length));
  bb.put(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) bb.put(pad, 8);

  const dataCodewords: number[] = [];
  for (let i = 0; i < bb.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bb.bits[i + j];
    dataCodewords.push(b);
  }

  const allCodewords = addEcc(dataCodewords, version, ecl);
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  drawFunctionPatterns(modules, isFn, version, ecl, size);
  drawCodewords(modules, isFn, allCodewords, size);

  let bestMask = 0;
  let minPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(modules, isFn, m, size);
    drawFormatBits(modules, isFn, ecl, m, size);
    const p = penalty(modules, size);
    if (p < minPenalty) {
      minPenalty = p;
      bestMask = m;
    }
    applyMask(modules, isFn, m, size); // undo (XOR)
  }
  applyMask(modules, isFn, bestMask, size);
  drawFormatBits(modules, isFn, ecl, bestMask, size);

  return {
    size,
    modules,
    version,
    ecl,
    mode,
    capacityBytes: Math.floor(dataCapacityBits / 8),
    usedBytes: bytes.length,
  };
}

function addEcc(data: number[], ver: number, ecl: Ecl): number[] {
  const e = ECL_INDEX[ecl];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e][ver - 1];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e][ver - 1];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const rsDiv = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

function setFn(m: boolean[][], f: boolean[][], x: number, y: number, dark: boolean, size: number) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  m[y][x] = dark;
  f[y][x] = true;
}

function drawFunctionPatterns(m: boolean[][], f: boolean[][], ver: number, ecl: Ecl, size: number) {
  for (let i = 0; i < size; i++) {
    setFn(m, f, 6, i, i % 2 === 0, size);
    setFn(m, f, i, 6, i % 2 === 0, size);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(m, f, cx + dx, cy + dy, dist !== 2 && dist !== 4, size);
      }
    }
  }
  const alignPos = alignmentPositions(ver);
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === alignPos.length - 1) ||
          (i === alignPos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(m, f, alignPos[j] + dx, alignPos[i] + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1, size);
        }
      }
    }
  }
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(m, f, a, b, bit, size);
      setFn(m, f, b, a, bit, size);
    }
  }
  drawFormatBits(m, f, ecl, 0, size);
  setFn(m, f, 8, size - 8, true, size);
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFormatBits(m: boolean[][], f: boolean[][], ecl: Ecl, mask: number, size: number) {
  const data = (ECL_ORDER.indexOf(ecl) << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;

  for (let i = 0; i <= 5; i++) setFn(m, f, 8, i, bit(i), size);
  setFn(m, f, 8, 7, bit(6), size);
  setFn(m, f, 8, 8, bit(7), size);
  setFn(m, f, 7, 8, bit(8), size);
  for (let i = 9; i < 15; i++) setFn(m, f, 14 - i, 8, bit(i), size);
  for (let i = 0; i < 8; i++) setFn(m, f, size - 1 - i, 8, bit(i), size);
  for (let i = 8; i < 15; i++) setFn(m, f, 8, size - 15 + i, bit(i), size);
}

function drawCodewords(m: boolean[][], f: boolean[][], data: number[], size: number) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!f[y][x] && i < data.length * 8) {
          m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function applyMask(m: boolean[][], f: boolean[][], mask: number, size: number) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (f[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) m[y][x] = !m[y][x];
    }
  }
}

function penalty(m: boolean[][], size: number): number {
  let result = 0;
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (m[y][x] === m[y][x - 1]) {
        run++;
        if (run === 5) result += 3;
        else if (run > 5) result++;
      } else run = 1;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (m[y][x] === m[y - 1][x]) {
        run++;
        if (run === 5) result += 3;
        else if (run > 5) result++;
      } else run = 1;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) {
        result += 3;
      }
    }
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  result += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return result;
}

/* ---- rendering ---- */

export function qrToSvg(q: QrResult, opts: { margin?: number; scale?: number; dark?: string; light?: string } = {}): string {
  const margin = opts.margin ?? 4;
  const scale = opts.scale ?? 8;
  const dim = (q.size + margin * 2) * scale;
  let path = "";
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) {
      if (q.modules[y][x]) path += `M${(x + margin) * scale} ${(y + margin) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${dim}" height="${dim}" fill="${opts.light ?? "#ffffff"}"/><path d="${path}" fill="${opts.dark ?? "#000000"}"/></svg>`;
}
