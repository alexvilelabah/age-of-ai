// Extrai prédios (variantes por era) das FOLHAS que o usuário gerou (fundo verde
// sólido). Cada peça: recorta um retângulo (célula de grade OU região fracionária),
// tira o verde (key-out ciente de matiz), mantém só o MAIOR componente conexo
// (descarta texto/rótulo, estrelinha do Gemini e tralha solta), corta na bbox e
// salva direto em client/public/sprites/ com o nome <tipo>_<era>.png.
//
// Uso: node scripts/extract_era.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const IMG = 'D:/age/image';
const OUT = 'D:/age/client/public/sprites';
mkdirSync(OUT, { recursive: true });

// ---- decode/encode PNG RGBA 8-bit (igual split_sheet.mjs) ----
function decode(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw0 = zlib.inflateSync(Buffer.concat(idat));
  const chan = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`esperado RGB/RGBA 8-bit, veio ct=${colorType} bd=${bitDepth}`);
  const stride = width * chan; const un = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) { const f = raw0[y * (stride + 1)], ri = y * (stride + 1) + 1, ro = y * stride; for (let x = 0; x < stride; x++) { const a = x >= chan ? un[ro + x - chan] : 0; const b = y > 0 ? un[ro - stride + x] : 0; const c = (y > 0 && x >= chan) ? un[ro - stride + x - chan] : 0; let pr = 0; switch (f) { case 1: pr = a; break; case 2: pr = b; break; case 3: pr = (a + b) >> 1; break; case 4: pr = paeth(a, b, c); break; } un[ro + x] = (raw0[ri + x] + pr) & 255; } }
  // normaliza para RGBA
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) { const s = p * chan, d = p * 4; out[d] = un[s]; out[d + 1] = un[s + 1]; out[d + 2] = un[s + 2]; out[d + 3] = chan === 4 ? un[s + 3] : 255; }
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

// Recorta um retângulo [x0,y0,w,h] da imagem-fonte, tira o verde e mantém o
// maior componente conexo. bgc = cor de fundo amostrada dos cantos da folha.
function extractPiece(src, bgc, x0, y0, w, h, name, opts = {}) {
  const mode = opts.mode || 'global';   // 'global' = remove toda cor de fundo; 'flood' = só a conectada às bordas (protege verde INTERNO tipo toldo)
  const TOL2 = (opts.bgTol || 128) ** 2;
  const { width: SW, data: sd } = src;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * SW + (x0 + x)) * 4, d = (y * w + x) * 4;
    buf[d] = sd[s]; buf[d + 1] = sd[s + 1]; buf[d + 2] = sd[s + 2]; buf[d + 3] = sd[s + 3];
  }
  const at = (x, y) => (y * w + x) * 4;
  // matiz do fundo: protege a arte exigindo a MESMA assinatura de canal do fundo.
  // VERDE (g é o maior) e MAGENTA (g é o menor, r+b altos) são tratados à parte —
  // magenta é 2 canais dominantes, então "canal dominante único" não bastava.
  let isBg;
  if (bgc.g < bgc.r - 40 && bgc.g < bgc.b - 40) {
    // MAGENTA: g é a minoria e NENHUM material (verde/terra/madeira/pedra) é roxo,
    // então basta a assinatura de matiz (r e b bem acima do g) — ignora brilho, pega
    // o roxo escuro na sombra entre as estacas que a distância deixaria passar.
    isBg = (r, g, b) => r > g + 22 && b > g + 22;
  } else {
    // VERDE (ou cor sólida genérica): distância + mesmo canal dominante do fundo
    let matchHue;
    if (bgc.g > bgc.r + 40 && bgc.g > bgc.b + 40) matchHue = (r, g, b) => g >= r - 4 && g >= b - 4;
    else { const dom = bgc.r >= bgc.b ? 'r' : 'b'; matchHue = (r, g, b) => dom === 'r' ? (r >= g && r >= b - 4) : (b >= g && b >= r - 4); }
    isBg = (r, g, b) => { const dr = r - bgc.r, dg = g - bgc.g, db = b - bgc.b; return dr * dr + dg * dg + db * db < TOL2 && matchHue(r, g, b); };
  }
  if (mode === 'flood') {
    // 1) global APERTADO: mata verde QUASE-EXATO em qualquer lugar (bolsão de fundo
    //    preso numa reentrância que o flood não alcança). Tolerância baixa não toca
    //    o verde MUDO do toldo (que está bem longe do verde vivo do fundo).
    if (bgc.g > bgc.r + 40 && bgc.g > bgc.b + 40) {
      for (let p = 0; p < w * h; p++) { const i = p * 4; const dr = buf[i] - bgc.r, dg = buf[i + 1] - bgc.g, db = buf[i + 2] - bgc.b; if (dr * dr + dg * dg + db * db < 60 * 60 && buf[i + 1] >= buf[i] - 4 && buf[i + 1] >= buf[i + 2] - 4) buf[i + 3] = 0; }
    }
    // 2) flood-fill das bordas (verde INTERNO do toldo sobrevive)
    const vis = new Uint8Array(w * h); const stk = [];
    for (let x = 0; x < w; x++) { stk.push(x, 0, x, h - 1); }
    for (let y = 0; y < h; y++) { stk.push(0, y, w - 1, y); }
    while (stk.length) { const yy = stk.pop(), xx = stk.pop(); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const p = yy * w + xx; if (vis[p]) continue; const i = p * 4; if (buf[i + 3] !== 0 && !isBg(buf[i], buf[i + 1], buf[i + 2])) continue; vis[p] = 1; buf[i + 3] = 0; stk.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1); }
  } else {
    for (let p = 0; p < w * h; p++) { const i = p * 4; if (isBg(buf[i], buf[i + 1], buf[i + 2])) buf[i + 3] = 0; }
  }
  // supressão de spill verde na franja do objeto
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = at(x, y); if (buf[i + 3] === 0) continue;
    let t = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (buf[at(x + dx, y + dy) + 3] === 0) { t = true; break; }
    if (!t) continue; const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (g > r + 16 && g > b + 16) { buf[i + 1] = Math.max(r, b); buf[i + 3] = Math.min(buf[i + 3], 150); }          // franja verde
    else if (r > g + 16 && b > g + 16) { const m = (r + b) >> 1; buf[i] = Math.min(r, m); buf[i + 2] = Math.min(b, m); buf[i + 1] = Math.max(g, Math.min(r, b) - 20); buf[i + 3] = Math.min(buf[i + 3], 150); }  // franja magenta
  }
  // zera RGB dos transparentes (some com halo verde por baixo)
  for (let p = 0; p < w * h; p++) if (buf[p * 4 + 3] === 0) { buf[p * 4] = 0; buf[p * 4 + 1] = 0; buf[p * 4 + 2] = 0; }
  // maior componente conexo (descarta rótulo/estrela/tralha solta).
  // keepAll: pula esse filtro — pra formas ORGÂNICAS (árvore) cujas folhas soltas
  // (separadas por buracos de fundo) seriam descartadas por engano.
  let bestSize = 0;
  if (!opts.keepAll) {
    const label = new Int32Array(w * h).fill(-1); const st = []; let best = -1;
    for (let s = 0; s < w * h; s++) {
      if (label[s] !== -1 || buf[s * 4 + 3] <= 20) continue;
      let size = 0; st.length = 0; st.push(s); label[s] = s;
      while (st.length) { const p = st.pop(); size++; const x = p % w, y = (p / w) | 0; const nb = []; if (x > 0) nb.push(p - 1); if (x < w - 1) nb.push(p + 1); if (y > 0) nb.push(p - w); if (y < h - 1) nb.push(p + w); for (const q of nb) if (label[q] === -1 && buf[q * 4 + 3] > 20) { label[q] = s; st.push(q); } }
      if (size > bestSize) { bestSize = size; best = s; }
    }
    for (let p = 0; p < w * h; p++) if (label[p] !== best) { buf[p * 4 + 3] = 0; buf[p * 4] = 0; buf[p * 4 + 1] = 0; buf[p * 4 + 2] = 0; }
  }
  // corta na bbox do que sobrou (+ margem)
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (buf[at(x, y) + 3] > 20) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  if (maxX < minX) { console.log(`  ${name}: VAZIO (nada sobrou) — ajustar retângulo`); return; }
  const m = 6; const cx0 = Math.max(0, minX - m), cy0 = Math.max(0, minY - m), cx1 = Math.min(w - 1, maxX + m), cy1 = Math.min(h - 1, maxY + m);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1; const crop = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s = ((cy0 + y) * w + (cx0 + x)) * 4, d = (y * cw + x) * 4; crop[d] = buf[s]; crop[d + 1] = buf[s + 1]; crop[d + 2] = buf[s + 2]; crop[d + 3] = buf[s + 3]; }
  writeFileSync(`${OUT}/${name}`, encode(cw, ch, crop));
  console.log(`  ${name}: ${cw}x${ch}  (comp=${bestSize}px)`);
}

const JOBS = [
  { in: 'centro de cidade.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'town_center_1.png' }, { cell: [0, 1], out: 'town_center_2.png' },
    { cell: [1, 0], out: 'town_center_3.png' }, { cell: [1, 1], out: 'town_center_4.png' } ] },
  { in: 'casa.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'house_1.png' }, { cell: [0, 1], out: 'house_2.png' },
    { cell: [1, 0], out: 'house_3.png' }, { cell: [1, 1], out: 'house_4.png' } ] },
  { in: 'quartel.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'barracks_1.png' }, { cell: [0, 1], out: 'barracks_2.png' },
    { cell: [1, 0], out: 'barracks_3.png' }, { cell: [1, 1], out: 'barracks_4.png' } ] },
  { in: 'moinho.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'mill_1.png' }, { cell: [0, 1], out: 'mill_2.png' },
    { cell: [1, 0], out: 'mill_3.png' }, { cell: [1, 1], out: 'mill_4.png' } ] },
  { in: 'madeireira.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'lumber_camp_1.png' }, { cell: [0, 1], out: 'lumber_camp_2.png' },
    { cell: [1, 0], out: 'lumber_camp_3.png' }, { cell: [1, 1], out: 'lumber_camp_4.png' } ] },
  { in: 'campo de mineracao.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'mining_camp_1.png' }, { cell: [0, 1], out: 'mining_camp_2.png' },
    { cell: [1, 0], out: 'mining_camp_3.png' }, { cell: [1, 1], out: 'mining_camp_4.png' } ] },
  // arquearia = grade 2×2 (4 variantes); uso feudal/castelo/imperial p/ eras 2,3,4 (pulo a 2ª feudal).
  { in: 'arquearia.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'archery_range_2.png' }, { cell: [0, 1], out: 'archery_range_3.png' },
    { cell: [1, 1], out: 'archery_range_4.png' } ] },
  // ferraria = grade 2×2 (4 variantes); progressão enxaimel→pedra→tijolo p/ eras 2,3,4 (pulo a forja aberta).
  { in: 'ferraria.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'blacksmith_2.png' }, { cell: [1, 0], out: 'blacksmith_3.png' },
    { cell: [1, 1], out: 'blacksmith_4.png' } ] },
  // estabulo = grade 2×2 (linha de baixo é DUPLICATA); linha de cima: pedra=castelo(3), tijolo=imperial(4).
  { in: 'estabulo.png', grid: [2, 2], pieces: [
    { cell: [0, 0], out: 'stable_3.png' }, { cell: [0, 1], out: 'stable_4.png' } ] },
  // mercado = grade 2×3 (3 estilos × 2 cores); uso a LINHA DE CIMA p/ eras 2,3,4.
  { in: 'mercado.png', grid: [2, 3], pieces: [
    { cell: [0, 0], out: 'market_2.png' }, { cell: [0, 1], out: 'market_3.png' },
    { cell: [0, 2], out: 'market_4.png' } ] },
  // torre = fila 1×3 (madeira, pedra, tijolo) = eras 2,3,4.
  { in: 'torredevigia.png', grid: [1, 3], pieces: [
    { cell: [0, 0], out: 'watch_tower_2.png' }, { cell: [0, 1], out: 'watch_tower_3.png' },
    { cell: [0, 2], out: 'watch_tower_4.png' } ] },
  // árvores: fila 1×5, keepAll (não descartar folhas soltas). Viram variações sorteadas no mapa.
  { in: 'arvores.png', grid: [1, 5], keepAll: true, pieces: [
    { cell: [0, 0], out: 'tree_1.png' }, { cell: [0, 1], out: 'tree_2.png' }, { cell: [0, 2], out: 'tree_3.png' },
    { cell: [0, 3], out: 'tree_4.png' }, { cell: [0, 4], out: 'tree_5.png' } ] },
];

for (const job of JOBS) {
  const src = decode(readFileSync(`${IMG}/${job.in}`));
  const { width: W, height: H, data } = src;
  const at = (x, y) => (y * W + x) * 4;
  let sr = 0, sg = 0, sb = 0;
  for (const [x, y] of [[6, 6], [W - 6, 6], [6, H - 6], [W - 6, H - 6]]) { const i = at(x, y); sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
  const bgc = { r: sr / 4, g: sg / 4, b: sb / 4 };
  console.log(`${job.in}  ${W}x${H}  fundo=rgb(${bgc.r | 0},${bgc.g | 0},${bgc.b | 0})`);
  for (const pc of job.pieces) {
    let x0, y0, w, h;
    if (job.grid) {
      const [gr, gc] = job.grid; const cw = Math.floor(W / gc), ch = Math.floor(H / gr);
      const [row, col] = pc.cell; const ins = Math.round(Math.min(cw, ch) * 0.012);
      x0 = col * cw + ins; y0 = row * ch + ins; w = cw - 2 * ins; h = ch - 2 * ins;
    } else {
      const [fx, fy, fw, fh] = pc.rect; x0 = Math.round(fx * W); y0 = Math.round(fy * H); w = Math.round(fw * W); h = Math.round(fh * H);
    }
    extractPiece(src, bgc, x0, y0, w, h, pc.out, { mode: job.mode, bgTol: job.bgTol, keepAll: job.keepAll });
  }
}
console.log('feito.');
