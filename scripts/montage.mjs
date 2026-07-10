// Monta um mosaico de todos os sprites (/public/sprites/*.png) sobre cinza, pra
// inspecionar recorte/transparência/bandeiras de uma vez. Saída: scratchpad/montage.png
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import zlib from 'node:zlib';

const DIR = 'D:/age/client/public/sprites';
const OUT = 'C:/Users/alex/AppData/Local/Temp/claude/D--age/70acafac-12dc-454f-b4cb-849fee0a7bce/scratchpad/montage.png';

function decode(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (pos < buf.length) { const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len); if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; } else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break; pos += 12 + len; }
  const raw0 = zlib.inflateSync(Buffer.concat(idat)); const chan = colorType === 6 ? 4 : 3; const stride = width * chan; const un = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) { const f = raw0[y * (stride + 1)], ri = y * (stride + 1) + 1, ro = y * stride; for (let x = 0; x < stride; x++) { const a = x >= chan ? un[ro + x - chan] : 0; const b = y > 0 ? un[ro - stride + x] : 0; const c = (y > 0 && x >= chan) ? un[ro - stride + x - chan] : 0; let pr = 0; switch (f) { case 1: pr = a; break; case 2: pr = b; break; case 3: pr = (a + b) >> 1; break; case 4: pr = paeth(a, b, c); break; } un[ro + x] = (raw0[ri + x] + pr) & 255; } }
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) { const s = p * chan, d = p * 4; out[d] = un[s]; out[d + 1] = un[s + 1]; out[d + 2] = un[s + 2]; out[d + 3] = chan === 4 ? un[s + 3] : 255; }
  return { width, height, data: out };
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c; }
function encode(width, height, data) { const stride = width * 4; const rf = Buffer.alloc(height * (stride + 1)); for (let y = 0; y < height; y++) { rf[y * (stride + 1)] = 0; data.copy(rf, y * (stride + 1) + 1, y * stride, y * stride + stride); } const idat = zlib.deflateSync(rf, { level: 6 }); const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0, 0); return Buffer.concat([len, t, body, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]); }

const files = readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
const COLS = 6, CELL = 240, PAD = 8, LABEL = 16;
const rows = Math.ceil(files.length / COLS);
const MW = COLS * CELL, MH = rows * (CELL + LABEL);
const m = Buffer.alloc(MW * MH * 4);
for (let p = 0; p < MW * MH; p++) { const i = p * 4; const y = (p / MW) | 0; const chk = (((y / 16) | 0) + (((p % MW) / 16) | 0)) & 1; const g = chk ? 120 : 150; m[i] = g; m[i + 1] = g; m[i + 2] = g; m[i + 3] = 255; }
files.forEach((f, k) => {
  const img = decode(readFileSync(`${DIR}/${f}`));
  const col = k % COLS, row = (k / COLS) | 0;
  const ox = col * CELL, oy = row * (CELL + LABEL) + LABEL;
  const avail = CELL - 2 * PAD;
  const sc = Math.min(avail / img.width, avail / img.height);
  const dw = Math.round(img.width * sc), dh = Math.round(img.height * sc);
  const dx = ox + ((CELL - dw) >> 1), dy = oy + (CELL - PAD - dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = Math.min(img.width - 1, (x / sc) | 0), sy = Math.min(img.height - 1, (y / sc) | 0);
    const s = (sy * img.width + sx) * 4, a = img.data[s + 3]; if (a < 8) continue;
    const px = dx + x, py = dy + y; if (px < 0 || py < 0 || px >= MW || py >= MH) continue;
    const d = (py * MW + px) * 4, af = a / 255;
    m[d] = img.data[s] * af + m[d] * (1 - af); m[d + 1] = img.data[s + 1] * af + m[d + 1] * (1 - af); m[d + 2] = img.data[s + 2] * af + m[d + 2] * (1 - af);
  }
  console.log(`${k}: ${f} ${img.width}x${img.height}`);
});
writeFileSync(OUT, encode(MW, MH, m));
console.log(`mosaico ${MW}x${MH} -> ${OUT}`);
