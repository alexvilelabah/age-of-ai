// Fatia uma FOLHA com vários prédios (fundo xadrez chapado) em PNGs separados.
// Remove o xadrez (flood-fill das bordas), acha os objetos conexos, agrupa os
// que estão perto (prédio + acessórios), e exporta cada grupo cortado.
// Uso: node scripts/split_sheet.mjs <folha.png> <pastaSaida>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const [, , inPath, outDir] = process.argv;
if (!inPath || !outDir) { console.error('uso: node scripts/split_sheet.mjs <folha.png> <pastaSaida>'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

// ---- decode/encode PNG RGBA 8-bit (igual cutout.mjs) ----
function decode(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (colorType !== 6 || bitDepth !== 8) throw new Error(`RGBA 8-bit esperado, veio ct=${colorType} bd=${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)); const bpp = 4, stride = width * bpp; const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) { const f = raw[y * (stride + 1)], ri = y * (stride + 1) + 1, ro = y * stride; for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[ro + x - bpp] : 0; const b = y > 0 ? out[ro - stride + x] : 0; const c = (y > 0 && x >= bpp) ? out[ro - stride + x - bpp] : 0; let pr = 0; switch (f) { case 1: pr = a; break; case 2: pr = b; break; case 3: pr = (a + b) >> 1; break; case 4: pr = paeth(a, b, c); break; } out[ro + x] = (raw[ri + x] + pr) & 255; } }
  return { width, height, data: out };
}
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c; }
function encode(width, height, data) {
  const stride = width * 4; const rf = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { rf[y * (stride + 1)] = 0; data.copy(rf, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(rf, { level: 9 });
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0, 0); return Buffer.concat([len, t, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const { width: W, height: H, data } = decode(readFileSync(inPath));
const at = (x, y) => (y * W + x) * 4;

// detecta o fundo pelos cantos: COR SÓLIDA (verde/rosa) ou XADREZ neutro
let sr = 0, sg = 0, sb = 0;
for (const [x, y] of [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]]) { const i = at(x, y); sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
const bgc = { r: sr / 4, g: sg / 4, b: sb / 4 };
const sat = Math.max(bgc.r, bgc.g, bgc.b) - Math.min(bgc.r, bgc.g, bgc.b);
console.log(`fundo: rgb(${bgc.r | 0},${bgc.g | 0},${bgc.b | 0}) sat=${sat | 0} -> modo ${sat > 40 ? 'COR SOLIDA' : 'XADREZ'}`);

if (sat > 40) {
  // cor sólida: key-out GLOBAL (pega buracos/pátios internos) + hue-aware
  // (só remove pixel do MESMO canal dominante do fundo -> protege telhado tan
  // de um fundo verde).
  const dom = bgc.g >= bgc.r && bgc.g >= bgc.b ? 'g' : bgc.r >= bgc.b ? 'r' : 'b';
  const sameHue = (r, g, b) => dom === 'g' ? (g >= r - 4 && g >= b) : dom === 'r' ? (r >= g && r >= b - 4) : (b >= g && b >= r - 4);
  const TOL2 = 120 * 120;
  for (let p = 0; p < W * H; p++) { const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2]; const dr = r - bgc.r, dg = g - bgc.g, db = b - bgc.b; if (dr * dr + dg * dg + db * db < TOL2 && sameHue(r, g, b)) data[i + 3] = 0; }
  // supressão de spill (franja com a cor do fundo na borda do objeto)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = at(x, y); if (data[i + 3] === 0) continue;
    let t = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (data[at(x + dx, y + dy) + 3] === 0) { t = true; break; }
    if (!t) continue; const r = data[i], g = data[i + 1], b = data[i + 2];
    if (dom === 'g' && g > r + 18 && g > b + 18) { data[i + 1] = Math.max(r, b); data[i + 3] = Math.min(data[i + 3], 150); }
    else if (dom === 'r' && r > g + 18 && r > b + 18) { data[i] = Math.max(g, b); data[i + 3] = Math.min(data[i + 3], 150); }
  }
} else {
  // xadrez neutro (2 tons ~128/~224): flood-fill das bordas + limpeza de restos
  // enclausurados (pedra do prédio tem textura, então sobrevive ao filtro puro).
  const isBg = (x, y) => { const i = at(x, y); const r = data[i], g = data[i + 1], b = data[i + 2]; return Math.abs(r - g) <= 8 && Math.abs(g - b) <= 8 && Math.abs(r - b) <= 8 && r >= 110 && r <= 238; };
  const vis = new Uint8Array(W * H); const stk = [];
  for (let x = 0; x < W; x++) { stk.push(x, 0); stk.push(x, H - 1); }
  for (let y = 0; y < H; y++) { stk.push(0, y); stk.push(W - 1, y); }
  while (stk.length) { const y = stk.pop(), x = stk.pop(); if (x < 0 || y < 0 || x >= W || y >= H) continue; const p = y * W + x; if (vis[p] || !isBg(x, y)) continue; vis[p] = 1; data[at(x, y) + 3] = 0; stk.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1); }
  for (let p = 0; p < W * H; p++) { const i = p * 4; if (data[i + 3] === 0) continue; const r = data[i], g = data[i + 1], b = data[i + 2]; if (Math.abs(r - g) <= 5 && Math.abs(g - b) <= 5 && Math.abs(r - b) <= 5 && (Math.abs(r - 128) <= 14 || Math.abs(r - 224) <= 16)) data[i + 3] = 0; }
}
for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] === 0) { data[p * 4] = 0; data[p * 4 + 1] = 0; data[p * 4 + 2] = 0; }

// componentes conexos opacos
const label = new Int32Array(W * H).fill(-1); const comps = []; const st = []; let cur = 0;
for (let s = 0; s < W * H; s++) {
  if (label[s] !== -1 || data[s * 4 + 3] <= 20) continue;
  let size = 0, minX = W, minY = H, maxX = 0, maxY = 0; st.length = 0; st.push(s); label[s] = cur;
  while (st.length) { const p = st.pop(); size++; const x = p % W, y = (p / W) | 0; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; const nb = []; if (x > 0) nb.push(p - 1); if (x < W - 1) nb.push(p + 1); if (y > 0) nb.push(p - W); if (y < H - 1) nb.push(p + W); for (const q of nb) if (label[q] === -1 && data[q * 4 + 3] > 20) { label[q] = cur; st.push(q); } }
  comps.push({ size, minX, minY, maxX, maxY, id: cur }); cur++;
}

// agrupa por CELULA da grade 3x3 (separa predios empilhados que quase se
// tocam); cada componente vai pra celula do seu CENTRO — acessorios caem junto.
const big = comps.filter((c) => c.size >= 1500);
const cw3 = W / 3, ch3 = H / 3;
const cell = new Map();
for (const c of big) {
  const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
  const col = Math.min(2, Math.max(0, Math.floor(cx / cw3)));
  const row = Math.min(2, Math.max(0, Math.floor(cy / ch3)));
  const key = row * 3 + col;
  if (!cell.has(key)) cell.set(key, { minX: W, minY: H, maxX: 0, maxY: 0, size: 0, row, col, ids: new Set() });
  const g = cell.get(key);
  g.minX = Math.min(g.minX, c.minX); g.minY = Math.min(g.minY, c.minY); g.maxX = Math.max(g.maxX, c.maxX); g.maxY = Math.max(g.maxY, c.maxY); g.size += c.size; g.ids.add(c.id);
}
const list = [...cell.values()].sort((a, b) => (a.row - b.row) || (a.col - b.col));
list.forEach((c) => {
  const m = 10; const x0 = Math.max(0, c.minX - m), y0 = Math.max(0, c.minY - m), x1 = Math.min(W - 1, c.maxX + m), y1 = Math.min(H - 1, c.maxY + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1; const crop = Buffer.alloc(cw * ch * 4);
  // copia SÓ os pixels dos componentes desta celula (mascara por label) — assim
  // o corte de um predio nao inclui pedaco do vizinho que caia no retangulo.
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sp = (y0 + y) * W + (x0 + x), s = sp * 4, d = (y * cw + x) * 4;
    if (data[s + 3] > 20 && c.ids.has(label[sp])) { crop[d] = data[s]; crop[d + 1] = data[s + 1]; crop[d + 2] = data[s + 2]; crop[d + 3] = data[s + 3]; }
  }
  writeFileSync(`${outDir}/piece_r${c.row}c${c.col}.png`, encode(cw, ch, crop));
  console.log(`piece_r${c.row}c${c.col}: ${cw}x${ch} @ (${x0},${y0})  size=${c.size}`);
});
console.log(`total de pecas: ${list.length}`);
