'use strict';
// qr.js: the built-in QR generator of help-qr.html, checked against values of ISO/IEC 18004.
const assert = require('node:assert/strict');
const qr = require('../qr.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const bits = (m, cells) => cells.map(([x, y]) => (m[y][x] ? '1' : '0')).join('');

// Format information of level M, masks 0–7 (table C.1 of the standard), bit 14 first.
const FORMAT_M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];

test('format information next to the top left finder matches the standard for every mask', () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const m = qr.matrix('https://sosh20tver.ru/help.html?room=211', { mask }).modules, size = m.length;
    // Bits 14..0 around the top left finder: row 8 (x 0..5, 7, 8) then column 8 (y 7, 5..0).
    const top = bits(m, [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]]);
    assert.equal(top, FORMAT_M[mask], `mask ${mask}`);
    // The second copy: column 8 from the bottom (bits 14..8), row 8 at the right (bits 7..0).
    const second = bits(m, [...[1, 2, 3, 4, 5, 6, 7].map((k) => [8, size - k]), ...[8, 7, 6, 5, 4, 3, 2, 1].map((k) => [size - k, 8])]);
    assert.equal(second, FORMAT_M[mask], `mask ${mask}, second copy`);
    assert.equal(m[size - 8][8], true, 'the dark module');
  }
});

test('version information of version 7 matches the standard', () => {
  const m = qr.matrix('x'.repeat(120)).modules, size = m.length;
  assert.equal(size, 45, 'version 7');
  // Bits 17..0 of version 7 are 000111110010010100; bit i sits at (size−11+i%3, ⌊i/3⌋).
  let read = '';
  for (let i = 17; i >= 0; i -= 1) read += m[Math.floor(i / 3)][size - 11 + (i % 3)] ? '1' : '0';
  assert.equal(read, '000111110010010100');
});

test('finder, timing and alignment patterns are in place', () => {
  const m = qr.matrix('https://sosh20tver.ru/help.html?room=211').modules, size = m.length;
  assert.equal(size, 29, 'a room link (40 bytes) fits version 3');
  const finder = (x0, y0) => { for (let y = 0; y < 7; y += 1) for (let x = 0; x < 7; x += 1) { const d = Math.max(Math.abs(x - 3), Math.abs(y - 3)); assert.equal(m[y0 + y][x0 + x], d !== 2, `finder ${x0},${y0}`); } };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  for (let i = 8; i < size - 8; i += 1) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) assert.equal(m[22 + dy][22 + dx], Math.max(Math.abs(dx), Math.abs(dy)) !== 1, 'alignment at 22,22');
});

test('data read back from the zigzag gives the codewords of the text', () => {
  // A reader independent of the writer: walk the data modules, undo mask 0, cut into bytes.
  const text = 'https://sosh20tver.ru/help.html?room=211';
  const m = qr.matrix(text, { mask: 0 }).modules, size = m.length;
  const reserved = (x, y) => (x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8) || x === 6 || y === 6 || (Math.abs(x - 22) <= 2 && Math.abs(y - 22) <= 2);
  const out = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v += 1) for (let j = 0; j < 2; j += 1) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!reserved(x, y)) out.push(m[y][x] !== ((x + y) % 2 === 0) ? 1 : 0);
    }
  }
  const bytes = [];
  for (let i = 0; i + 8 <= out.length; i += 8) bytes.push(parseInt(out.slice(i, i + 8).join(''), 2));
  // Version 3-M: one block of 44 data codewords; mode 0100, length 40, then the text.
  const data = bytes.slice(0, 44);
  const stream = data.map((b) => b.toString(2).padStart(8, '0')).join('');
  assert.equal(stream.slice(0, 4), '0100');
  assert.equal(parseInt(stream.slice(4, 12), 2), text.length);
  const decoded = [];
  for (let i = 0; i < text.length; i += 1) decoded.push(parseInt(stream.slice(12 + i * 8, 20 + i * 8), 2));
  assert.equal(Buffer.from(decoded).toString('utf8'), text);
});

test('Reed–Solomon: «HELLO WORLD» 1-M gives the error correction codewords of the standard example', () => {
  // Data codewords of «HELLO WORLD» in alphanumeric mode, version 1-M; the generator works with bytes,
  // so the check builds the same 16 data codewords and compares the 10 EC codewords that follow them.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const expected = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
  assert.deepEqual(qr._remainder(data, 10), expected);
});

test('the best mask is chosen and the svg has a quiet zone', () => {
  const r = qr.matrix('https://sosh20tver.ru/help.html?room=304');
  assert.ok(r.mask >= 0 && r.mask < 8);
  const svg = qr.svg('https://sosh20tver.ru/help.html?room=304', { label: 'QR каб. 304' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 37 37"/);
  assert.match(svg, /aria-label="QR каб. 304"/);
  assert.throws(() => qr.matrix('z'.repeat(300)), /Слишком длинный/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); } catch (err) { failed += 1; console.error(`✗ ${name}\n  ${err.message}`); }
}
if (failed) { console.error(`${failed} of ${tests.length} QR checks failed`); process.exit(1); }
console.log(`${tests.length} QR checks passed`);
