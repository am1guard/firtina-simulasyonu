// Arazi önizleme: üstte kuşbakışı yükseklik haritası (göl, köy, kule), altta kameradan ufuk silüeti.
// Kullanım: node tools/terrain_preview.mjs --out arazi.png
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[process.argv.indexOf('--out') + 1] || 'arazi.png';
const ctx = vm.createContext({ console, performance });
for (const f of ['js/core/math.js', 'js/world/terrain.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
const T = ctx.FIRTINA.Terrain;

const W = 1000, H1 = 620, H2 = 360, H = H1 + H2;
const img = new Uint8Array(W * H * 3);
const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; };

// Kuşbakışı: x ∈ [-5000, 5000], z ∈ [-12000, 600]
const X0 = -5000, X1 = 5000, Z0 = 600, Z1 = -12000;
for (let py = 0; py < H1; py++) for (let px = 0; px < W; px++) {
  const x = X0 + (X1 - X0) * px / W, z = Z0 + (Z1 - Z0) * py / H1;
  const h = T.height(x, z);
  if (T.isWater(x, z)) { put(px, py, 20, 40, 90); continue; }
  const f = T.forestMask(x, z), v = T.villageMask(x, z);
  const c = Math.min(255, 30 + h * 0.2);
  put(px, py, c * (1 - 0.5 * f) + 60 * v, c * (1 - 0.2 * f) + 30 * v, c * 0.7 * (1 - 0.5 * f));
}
const toPx = (x, z) => [Math.round((x - X0) / (X1 - X0) * W), Math.round((z - Z0) / (Z1 - Z0) * H1)];
const village = T.buildVillage();
for (const hs of village.houses) { const [px, py] = toPx(hs.x, hs.z); for (let d = -1; d <= 1; d++) { put(px + d, py, 255, 200, 90); put(px, py + d, 255, 200, 90); } }
{ const [px, py] = toPx(T.tower.base[0], T.tower.base[2]); for (let d = -4; d <= 4; d++) { put(px + d, py, 255, 40, 40); put(px, py + d, 255, 40, 40); } }
{ const [px, py] = toPx(T.CAMERA_POS[0], T.CAMERA_POS[2]); for (let d = -5; d <= 5; d++) { put(px + d, py, 255, 255, 255); put(px, py + d, 255, 255, 255); } }

// Ufuk silüeti: yatay görüş ±50°, dikey -10°..+12°
const cam = T.CAMERA_POS;
for (let px = 0; px < W; px++) {
  const yaw = (-50 + 100 * px / W) * Math.PI / 180;
  let maxA = -Math.PI / 2, waterA = -Math.PI / 2;
  for (let t = 20; t < 25000; t *= 1.004) {
    const x = cam[0] + Math.sin(yaw) * t, z = cam[2] - Math.cos(yaw) * t;
    const h = Math.max(0, T.height(x, z));
    const a = Math.atan2(h - cam[1], t);
    if (a > maxA) maxA = a;
  }
  const toY = (a) => H1 + Math.round(H2 * (1 - (a * 180 / Math.PI + 10) / 22));
  const ySky = toY(maxA);
  for (let py = H1; py < H; py++) {
    if (py < ySky) put(px, py, 18, 22, 40); else put(px, py, 6, 8, 10);
  }
  const yHorizon = toY(0);
  put(px, yHorizon, 60, 60, 90);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const x of buf) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('yazıldı:', out, 'ev:', village.houses.length, 'lamba:', village.lamps.length / T.LAMP_STRIDE, 'kule tabanı:', T.tower.base.map(Math.round));
