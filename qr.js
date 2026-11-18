// A small QR code generator for help-qr.html (no external libraries or CDN).
// Byte mode (UTF-8), error correction level M (~15%), versions 1–10 (up to 213 bytes),
// the mask with the lowest penalty as in ISO/IEC 18004. QrCode.svg(text) gives an <svg>.
(() => {
  'use strict';

  // Level M: [total codewords, EC codewords per block, blocks of group 1, data per block g1, blocks g2, data g2]
  const BLOCKS = [null,
    [26, 10, 1, 16, 0, 0], [44, 16, 1, 28, 0, 0], [70, 26, 1, 44, 0, 0], [100, 18, 2, 32, 0, 0], [134, 24, 2, 43, 0, 0],
    [172, 16, 4, 27, 0, 0], [196, 18, 4, 31, 0, 0], [242, 22, 2, 38, 2, 39], [292, 22, 3, 36, 2, 37], [346, 26, 4, 43, 1, 44]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const ECL_M = 0; // format bits of level M

  // GF(256) with the polynomial x^8 + x^4 + x^3 + x^2 + 1.
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      poly.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
      poly = next;
    }
    return poly;
  }
  function remainder(data, degree) {
    const gen = generator(degree), res = new Array(degree).fill(0);
    data.forEach((b) => {
      const factor = b ^ res.shift();
      res.push(0);
      for (let i = 0; i < degree; i += 1) res[i] ^= mul(gen[i + 1], factor);
    });
    return res;
  }

  const utf8 = (text) => Array.from(new TextEncoder().encode(String(text)));

  function codewords(bytes, version) {
    const [, ec, n1, d1, n2, d2] = BLOCKS[version];
    const capacity = (n1 * d1 + n2 * d2) * 8;
    const bits = [];
    const put = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    put(4, 4);
    put(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);
    const blocks = [];
    let at = 0;
    for (let i = 0; i < n1 + n2; i += 1) {
      const size = i < n1 ? d1 : d2, part = data.slice(at, at + size);
      at += size;
      blocks.push({ data: part, ec: remainder(part, ec) });
    }
    const out = [];
    for (let i = 0; i < Math.max(d1, d2); i += 1) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < ec; i += 1) blocks.forEach((b) => out.push(b.ec[i]));
    return out;
  }

  const MASKS = [
    (y, x) => (x + y) % 2 === 0, (y) => y % 2 === 0, (y, x) => x % 3 === 0, (y, x) => (x + y) % 3 === 0,
    (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (y, x) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (y, x) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (y, x) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function build(version, data, mask) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const align = ALIGN[version], last = align.length - 1;
    align.forEach((cy, i) => align.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // Format bits (reserved now, written after the mask is known) and the dark module.
    const format = (maskNo) => {
      const value = (ECL_M << 3) | maskNo;
      let rem = value;
      for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((value << 10) | rem) ^ 0x5412, bit = (i) => ((bits >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i += 1) {
        const dark = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, dark); set(b, a, dark);
      }
    }
    // Data in the zigzag from the bottom right corner, two columns at a time.
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && i < data.length * 8) { m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i += 1; }
        }
      }
    }
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!fn[y][x] && MASKS[mask](y, x)) m[y][x] = !m[y][x];
    format(mask);
    return m;
  }

  // Penalty rules N1–N4: long runs, 2×2 blocks, finder-like patterns, dark/light balance.
  function penalty(m) {
    const size = m.length;
    let score = 0, dark = 0;
    const lines = [];
    for (let y = 0; y < size; y += 1) { lines.push(m[y]); lines.push(m.map((row) => row[y])); }
    const pattern = [true, false, true, true, true, false, true];
    lines.forEach((line) => {
      let run = 1;
      for (let i = 1; i <= size; i += 1) {
        if (i < size && line[i] === line[i - 1]) run += 1;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      for (let i = 0; i + 7 <= size; i += 1) {
        if (!pattern.every((v, k) => line[i + k] === v)) continue;
        const before = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k]);
        const after = i + 11 <= size && [7, 8, 9, 10].every((k) => !line[i + k]);
        if (before || after) score += 40;
      }
    });
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      if (m[y][x]) dark += 1;
      if (y < size - 1 && x < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }

  function matrix(text, opts = {}) {
    const bytes = utf8(text);
    let version = opts.version || 0;
    if (!version) {
      for (let v = 1; v <= 10 && !version; v += 1) {
        const [, , n1, d1, n2, d2] = BLOCKS[v];
        if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= (n1 * d1 + n2 * d2) * 8) version = v;
      }
      if (!version) throw new Error('Слишком длинный текст для QR-кода');
    }
    const data = codewords(bytes, version);
    let best = null;
    for (let mask = 0; mask < 8; mask += 1) {
      if (opts.mask != null && mask !== opts.mask) continue;
      const m = build(version, data, mask), score = penalty(m);
      if (!best || score < best.score) best = { modules: m, mask, score };
    }
    return { version, mask: best.mask, size: best.modules.length, modules: best.modules };
  }

  // SVG with a 4-module quiet zone; one path, so it prints crisp at any size.
  function svg(text, opts = {}) {
    const { size, modules } = matrix(text, opts), q = 4, full = size + q * 2;
    let d = '';
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + q} ${y + q}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"${opts.label ? ` role="img" aria-label="${String(opts.label).replace(/"/g, '&quot;')}"` : ' aria-hidden="true"'}><rect width="${full}" height="${full}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = Object.freeze({ matrix, svg, _remainder: remainder });
  if (typeof window !== 'undefined') window.QrCode = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
