// Recorta o fundo FALSO (xadrez chapado, sem alfa real) de um PNG gerado por IA.
// Faz flood fill a partir das 4 bordas removendo os pixels de fundo (as cores do
// xadrez, com tolerância) -> alfa 0, parando no contorno do objeto. Suaviza a
// borda e recorta na bounding box. Node puro (zlib nativo), sem libs externas.
//
// Uso: node scripts/cutout.mjs <entrada.png> <saida.png>
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('uso: node scripts/cutout.mjs <in.png> <out.png>'); process.exit(1); }

// ---------- decode PNG RGBA 8-bit ----------
function decode(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (colorType !== 6 || bitDepth !== 8) throw new Error(`esperava RGBA 8-bit, veio colorType=${colorType} bitDepth=${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], rowIn = y * (stride + 1) + 1, rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[rowOut + x - bpp] : 0;
      const b = y > 0 ? out[rowOut - stride + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[rowOut - stride + x - bpp] : 0;
      let pr = 0;
      switch (f) { case 1: pr = a; break; case 2: pr = b; break; case 3: pr = (a + b) >> 1; break; case 4: pr = paeth(a, b, c); break; }
      out[rowOut + x] = (raw[rowIn + x] + pr) & 0xff;
    }
  }
  return { width, height, data: out };
}

// ---------- encode PNG RGBA 8-bit ----------
function encode(width, height, data) {
  const stride = width * 4;
  const rawWithFilters = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rawWithFilters[y * (stride + 1)] = 0; // filtro None
    data.copy(rawWithFilters, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(rawWithFilters, { level: 9 });
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0, 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c; }

// ---------- remoção do fundo (auto: cor sólida OU xadrez neutro) ----------
const img = decode(readFileSync(inPath));
const { width: W, height: H, data } = img;
const at = (x, y) => (y * W + x) * 4;

// amostra a cor do fundo pelos cantos (média) e mede a saturação
let sr = 0, sg = 0, sb = 0;
for (const [x, y] of [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]]) { const i = at(x, y); sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
const bg = { r: sr / 4, g: sg / 4, b: sb / 4 };
const sat = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
const SOLID = sat > 40; // fundo colorido (verde/rosa) vs xadrez cinza neutro
console.log(`fundo: rgb(${bg.r|0},${bg.g|0},${bg.b|0}) sat=${sat|0} -> modo ${SOLID ? 'COR SOLIDA (global)' : 'XADREZ (flood-fill)'}`);

if (SOLID) {
  // cor sólida (ex.: verde #00FF00): remove TODOS os pixels perto dessa cor,
  // globalmente — pega inclusive o fundo visível por buracos/pátios internos.
  // Distância de cor NÃO basta (verde-oliva do fundo é perto do telhado tan);
  // exige TAMBÉM que o pixel tenha o MESMO canal dominante do fundo (verde do
  // fundo = G dominante; telhado é R dominante -> preservado).
  const dom = bg.g >= bg.r && bg.g >= bg.b ? 'g' : bg.r >= bg.b ? 'r' : 'b';
  const sameHue = (r, g, b) =>
    dom === 'g' ? (g >= r - 4 && g >= b) : dom === 'r' ? (r >= g && r >= b - 4) : (b >= g && b >= r - 4);
  const TOL2 = 120 * 120;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    const dr = r - bg.r, dg = g - bg.g, db = b - bg.b;
    if (dr * dr + dg * dg + db * db < TOL2 && sameHue(r, g, b)) data[i + 3] = 0;
  }
  // supressão de "spill": franja com a cor do fundo vazando na borda do objeto
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = at(x, y);
    if (data[i + 3] === 0) continue;
    let touchesBg = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (data[at(x + dx, y + dy) + 3] === 0) { touchesBg = true; break; }
    if (!touchesBg) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (dom === 'g' && g > r + 18 && g > b + 18) { data[i + 1] = Math.max(r, b); data[i + 3] = Math.min(data[i + 3], 150); }
    else if (dom === 'r' && r > g + 18 && r > b + 18) { data[i] = Math.max(g, b); data[i + 3] = Math.min(data[i + 3], 150); }
  }
} else {
  // xadrez cinza neutro (2 tons): flood-fill das bordas (a pedra é parecida com
  // o cinza, então NÃO dá pra remover global — só o conectado às bordas).
  const isBg = (x, y) => {
    const i = at(x, y); const r = data[i], g = data[i + 1], b = data[i + 2];
    const neutral = Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12 && Math.abs(r - b) <= 12;
    return neutral && r >= 108 && r <= 190;
  };
  const visited = new Uint8Array(W * H); const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, 0); stack.push(x, H - 1); }
  for (let y = 0; y < H; y++) { stack.push(0, y); stack.push(W - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (visited[p] || !isBg(x, y)) continue;
    visited[p] = 1; data[at(x, y) + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = at(x, y);
    if (data[i + 3] === 0) continue;
    let touchesBg = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (data[at(x + dx, y + dy) + 3] === 0) { touchesBg = true; break; }
    if (!touchesBg) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const neutral = Math.abs(r - g) <= 18 && Math.abs(g - b) <= 18 && Math.abs(r - b) <= 18;
    if (neutral && r >= 100 && r <= 200) data[i + 3] = Math.min(data[i + 3], 90);
  }
}

// ---------- mantém só o MAIOR objeto (descarta resíduos soltos) ----------
// (a estrelinha do Gemini e borrões que não eram cinza neutro sobrevivem ao
//  flood-fill; ficam como ilhas soltas longe da torre)
{
  const label = new Int32Array(W * H).fill(-1);
  let best = -1, bestSize = 0, cur = 0;
  const st = [];
  for (let start = 0; start < W * H; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] <= 20) continue;
    let size = 0; st.length = 0; st.push(start); label[start] = cur;
    while (st.length) {
      const p = st.pop(); size++;
      const x = p % W, y = (p / W) | 0;
      const nb = [];
      if (x > 0) nb.push(p - 1);
      if (x < W - 1) nb.push(p + 1);
      if (y > 0) nb.push(p - W);
      if (y < H - 1) nb.push(p + W);
      for (const q of nb) if (label[q] === -1 && data[q * 4 + 3] > 20) { label[q] = cur; st.push(q); }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
    cur++;
  }
  for (let p = 0; p < W * H; p++) if (label[p] !== best) data[p * 4 + 3] = 0;
  console.log(`objetos encontrados: ${cur}  maior (obj): ${(bestSize / (W * H) * 100).toFixed(1)}% da imagem`);
}

// zera a COR dos pixels totalmente transparentes (evita franja de cor do fundo
// sobrando por baixo do alfa 0, ex.: halo verde na borda)
for (let p = 0; p < W * H; p++) {
  if (data[p * 4 + 3] === 0) { data[p * 4] = 0; data[p * 4 + 1] = 0; data[p * 4 + 2] = 0; }
}

// ---------- crop na bounding box do que sobrou ----------
let minX = W, minY = H, maxX = 0, maxY = 0, kept = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (data[at(x, y) + 3] > 8) { kept++; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
}
const m = 6;
minX = Math.max(0, minX - m); minY = Math.max(0, minY - m); maxX = Math.min(W - 1, maxX + m); maxY = Math.min(H - 1, maxY + m);
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const cropped = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const s = at(minX + x, minY + y), d = (y * cw + x) * 4;
  cropped[d] = data[s]; cropped[d + 1] = data[s + 1]; cropped[d + 2] = data[s + 2]; cropped[d + 3] = data[s + 3];
}

writeFileSync(outPath, encode(cw, ch, cropped));

// relatório
let transp = 0, opaque = 0, partial = 0;
for (let i = 3; i < cropped.length; i += 4) { const a = cropped[i]; if (a === 0) transp++; else if (a === 255) opaque++; else partial++; }
const tot = cw * ch;
console.log(`entrada ${W}x${H} -> saida ${cw}x${ch}`);
console.log(`pixels mantidos (obj): ${(kept / (W * H) * 100).toFixed(1)}% da imagem original`);
console.log(`no recorte: transparente ${(transp / tot * 100).toFixed(1)}%  opaco ${(opaque / tot * 100).toFixed(1)}%  parcial ${(partial / tot * 100).toFixed(1)}%`);
console.log(`salvo em ${outPath}`);
