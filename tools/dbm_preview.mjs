// DBM önizleme aracı: yıldırım(lar) üretir, istatistikleri basar ve yandan izdüşüm PNG'si yazar.
// Kullanım:
//   node tools/dbm_preview.mjs --kind cg --seed 1 --eta 3 --out onizleme.png
//   node tools/dbm_preview.mjs --variants '[{"tune":{"kappa":1}},{"eta":4}]' --out karsilastirma.png
// Her varyant ayrı bir sütun olarak çizilir (x-y izdüşümü). Tek varyantta x-y ve z-y yan yana çizilir.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = next !== undefined && !next.startsWith('--') ? next : 'true';
}

const context = vm.createContext({ console, performance });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sim/dbm.js'), 'utf8'), context, { filename: 'dbm.js' });
const DBM = context.FIRTINA.DBM;
const S = DBM.SEG_STRIDE;

const base = {
  kind: args.kind || 'cg',
  seed: Number(args.seed || 1),
  eta: Number(args.eta || 3),
  cloudBase: Number(args.base || 1400),
  tune: args.tune ? JSON.parse(args.tune) : undefined,
  maxSteps: args.maxSteps ? Number(args.maxSteps) : undefined,
};
const variants = args.variants ? JSON.parse(args.variants).map((v) => ({ ...base, ...v, tune: { ...(base.tune || {}), ...(v.tune || {}) } })) : [base];

const bolts = variants.map((opts, i) => {
  if (args.trace) opts.onProgress = (s, p, c) => console.error(`  [${i}] adım ${s}  desen ${p}  aday ${c}`);
  const b = DBM.generate(opts);
  console.log(`[${i}] ${JSON.stringify({ kind: b.kind, eta: +b.eta.toFixed(2), tune: opts.tune, genMs: Math.round(b.genMs), segs: b.segCount, strike: b.strike && b.strike.map(Math.round), steps: b.stats.steps, nodes: b.stats.nodes, branches: b.stats.branchCount, main: Math.round(b.mainLength) })}`);
  return b;
});

if (args.out) {
  const W = Number(args.w || 520), H = Number(args.h || 640);
  const panels = [];
  for (const b of bolts) {
    panels.push({ b, axis: 0 });
    if (bolts.length === 1) panels.push({ b, axis: 2 });
  }
  const TW = W * panels.length;
  const img = new Float32Array(TW * H * 3);
  panels.forEach(({ b, axis }, pi) => {
    const bmin = b.bounds.min, bmax = b.bounds.max;
    const spanX = Math.max(bmax[0] - bmin[0], bmax[2] - bmin[2], 1);
    const top = args.view === 'top';
    const spanY = top ? Math.max(bmax[2] - bmin[2], 1) : Math.max(bmax[1] - Math.min(0, bmin[1]), 1);
    const scale = 0.92 * Math.min(W / spanX, H / spanY);
    const cx = (bmin[axis] + bmax[axis]) / 2, cy = (Math.min(0, bmin[1]) + bmax[1]) / 2;
    const splat = (u, v, r, g, bl) => {
      const x0 = Math.floor(u), y0 = Math.floor(v);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = (dx === 0 && dy === 0) ? 1 : 0.18;
        const i = (y * TW + pi * W + x) * 3;
        img[i] += r * k; img[i + 1] += g * k; img[i + 2] += bl * k;
      }
    };
    for (let i = 0; i < b.segCount; i++) {
      const o = i * S;
      const flags = b.seg[o + 13];
      const w = (b.seg[o + 10] + b.seg[o + 11]) / 2;
      let r = w, g = w, bl = w * 1.1;
      if (flags & DBM.FLAG.CLOUD) { r = w * 0.35; g = w * 0.5; bl = w; }
      if (flags & DBM.FLAG.STREAMER) { r = 0.9; g = 0.4; bl = 0.3; }
      const vy = top ? 2 : 1, cv = top ? (bmin[2] + bmax[2]) / 2 : cy;
      const u0 = W / 2 + (b.seg[o + axis] - cx) * scale, v0 = H / 2 - (b.seg[o + vy] - cv) * scale;
      const u1 = W / 2 + (b.seg[o + 3 + axis] - cx) * scale, v1 = H / 2 - (b.seg[o + 3 + vy] - cv) * scale;
      const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) * 2));
      for (let s = 0; s <= n; s++) splat(u0 + (u1 - u0) * s / n, v0 + (v1 - v0) * s / n, r * 0.5, g * 0.5, bl * 0.5);
    }
    const gy = Math.round(H / 2 - (0 - cy) * scale);
    if (gy >= 0 && gy < H) for (let x = 0; x < W; x++) { const i = (gy * TW + pi * W + x) * 3; img[i] += 0.12; img[i + 1] += 0.18; img[i + 2] += 0.08; }
    const cb = Math.round(H / 2 - (base.cloudBase - cy) * scale);
    if (cb >= 0 && cb < H) for (let x = 0; x < W; x += 3) { const i = (cb * TW + pi * W + x) * 3; img[i] += 0.1; img[i + 1] += 0.1; img[i + 2] += 0.2; }
    for (let y = 0; y < H; y++) { const i = (y * TW + pi * W) * 3; img[i] += 0.2; img[i + 1] += 0.2; img[i + 2] += 0.2; }
  });
  const raw = Buffer.alloc((TW * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (TW * 3 + 1)] = 0;
    for (let x = 0; x < TW; x++) for (let c = 0; c < 3; c++) {
      const v = img[(y * TW + x) * 3 + c];
      raw[y * (TW * 3 + 1) + 1 + x * 3 + c] = Math.round(255 * (1 - Math.exp(-2.2 * v)));
    }
  }
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const x of buf) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TW, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(args.out, png);
  console.log('yazıldı:', args.out);
}
