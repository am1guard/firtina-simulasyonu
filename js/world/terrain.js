/* Yıldırım Gözlemevi — dünya: arazi yükseklik işlevi, göl, orman, köy, radyo kulesi ve hedef seçimi.
 * Kamera göl kıyısında, -Z yönüne bakar. Su yüzeyi y = 0. Birimler metre. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};
  const M = F.math;

  const CAMERA_POS = [0, 16, 0];
  const CLOUD_BASE = 1400;
  const LAMP_STRIDE = 8; // x, y, z, boyut, r, g, b, tür (0 sokak, 1 kule ikazı, 2 ev/çiftlik)
  const LAKE = { cx: 80, cz: -720, rx: 1450, rz: 640 };
  const VILLAGE = { cx: -220, cz: -1420, rx: 520, rz: 160 };
  const TOWER = { x: 720, z: -2150, height: 150 };
  const PICK = { minDist: 150, maxDist: 14000, skyMin: 1500, towerRadius: 350, towerRay: 150 };
  const MESH_HALF = 1.75; // arazi ağının kameraya göre yarı açısı (radyan, ~100°)

  const sq = (v) => v * v;
  function peninsula(x, z) { return Math.exp(-sq((x + 760) / 400) - sq((z + 540) / 170)); }
  function islet(x, z) { return Math.exp(-sq((x - 380) / 85) - sq((z + 930) / 55)); }
  function towerHill(x, z) { return Math.exp(-sq((x - TOWER.x) / 420) - sq((z - TOWER.z) / 420)); }

  // Göl alanı: içeride pozitif, kıyıda 0, karada negatif.
  function lakeField(x, z) {
    const dx = (x - LAKE.cx) / LAKE.rx, dz = (z - LAKE.cz) / LAKE.rz;
    let L = 1 - Math.sqrt(dx * dx + dz * dz) + 0.12 * (M.fbm2(x / 520 + 3.1, z / 520 - 1.7, 4) - 0.5);
    L -= 1.25 * peninsula(x, z);
    L -= 0.9 * islet(x, z);
    return L;
  }

  function villageMask(x, z) {
    const dx = (x - VILLAGE.cx) / VILLAGE.rx, dz = (z - VILLAGE.cz) / VILLAGE.rz;
    return M.smoothstep(1.0, 0.55, Math.sqrt(dx * dx + dz * dz));
  }

  // Orman örtüsü olmadan zemin yüksekliği.
  function groundHeight(x, z) {
    const L = lakeField(x, z);
    const inland = -L;
    const pen = peninsula(x, z);
    const vil = villageMask(x, z);
    const baseRise = 4 + 40 * M.smoothstep(0.05, 0.9, inland);
    const hills = 20 + 115 * M.fbm2(x / 1700, z / 1700, 5) + 70 * M.ridged2(x / 2600 + 11, z / 2600 - 4, 5);
    const hillMask = M.smoothstep(0.15, 1.2, inland) * (1 - pen) * (1 - vil);
    let land = baseRise + hills * hillMask + 12 * pen + 90 * towerHill(x, z);
    const mnt = M.smoothstep(-4000, -8500, z) * (320 + 640 * M.ridged2(x / 5200 + 2, z / 5200 + 7, 6));
    land += mnt;
    let h;
    if (L > 0) h = -10 * M.smoothstep(0, 0.15, L);
    else h = land * M.smoothstep(0, 0.22, inland);
    // Kameranın durduğu alçak kaya çıkıntısı
    h += 9 * Math.exp(-(x * x + sq(z - 10)) / (160 * 160)) * M.smoothstep(0.02, 0.1, inland);
    return h;
  }

  function forestMask(x, z) {
    const L = lakeField(x, z);
    const d = Math.hypot(x - CAMERA_POS[0], z - CAMERA_POS[2]);
    let f = M.smoothstep(0.42, 0.55, M.fbm2(x / 650 + 7, z / 650 - 3, 3));
    f = Math.max(f, 0.95 * peninsula(x, z), 0.8 * islet(x, z));
    f *= M.smoothstep(0.02, 0.1, -L) * (1 - villageMask(x, z)) * M.smoothstep(180, 320, d);
    f *= 1 - M.smoothstep(0.25, 0.6, towerHill(x, z)) * 0.9;
    f *= 1 - M.smoothstep(-4500, -6500, z) * 0.6;
    return f;
  }

  // Orman örtüsüyle birlikte yükseklik (silüet ve çarpma için).
  function height(x, z) {
    const g = groundHeight(x, z);
    if (g <= 0.5) return g;
    const f = forestMask(x, z);
    if (f <= 0.001) return g;
    return g + f * (10 + 8 * M.noise2(x / 13, z / 13));
  }

  function isWater(x, z) { return lakeField(x, z) > 0 && groundHeight(x, z) < 0; }
  function surfaceHeight(x, z) { return Math.max(0, height(x, z)); }

  const towerBaseY = groundHeight(TOWER.x, TOWER.z);
  const tower = {
    base: [TOWER.x, towerBaseY, TOWER.z],
    tip: [TOWER.x, towerBaseY + TOWER.height, TOWER.z],
    height: TOWER.height,
  };

  // ---------- Arazi ağı: kameraya göre kutupsal ızgara ----------
  function buildMesh(opts) {
    const o = opts || {};
    const rings = o.rings || 400, spokes = o.spokes || 640;
    const r0 = 10, r1 = 30000, th0 = -MESH_HALF, th1 = MESH_HALF;
    const n = rings * spokes;
    const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), forest = new Float32Array(n);
    for (let i = 0; i < rings; i++) {
      const r = r0 * Math.pow(r1 / r0, i / (rings - 1));
      for (let j = 0; j < spokes; j++) {
        const th = th0 + (th1 - th0) * j / (spokes - 1);
        const x = CAMERA_POS[0] + r * Math.sin(th), z = CAMERA_POS[2] - r * Math.cos(th);
        const k = i * spokes + j;
        positions[3 * k] = x; positions[3 * k + 1] = height(x, z); positions[3 * k + 2] = z;
        forest[k] = forestMask(x, z);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < spokes; j++) {
        const k = i * spokes + j;
        const i0 = Math.max(0, i - 1), i1 = Math.min(rings - 1, i + 1);
        const j0 = Math.max(0, j - 1), j1 = Math.min(spokes - 1, j + 1);
        const a = 3 * (i0 * spokes + j), b = 3 * (i1 * spokes + j), c = 3 * (i * spokes + j0), d = 3 * (i * spokes + j1);
        const rx = positions[b] - positions[a], ry = positions[b + 1] - positions[a + 1], rz = positions[b + 2] - positions[a + 2];
        const tx = positions[d] - positions[c], ty = positions[d + 1] - positions[c + 1], tz = positions[d + 2] - positions[c + 2];
        let nx = ry * tz - rz * ty, ny = rz * tx - rx * tz, nz = rx * ty - ry * tx;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        normals[3 * k] = nx / l; normals[3 * k + 1] = ny / l; normals[3 * k + 2] = nz / l;
      }
    }
    const indices = new Uint32Array((rings - 1) * (spokes - 1) * 6);
    let p = 0;
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < spokes - 1; j++) {
        const a = i * spokes + j, b = a + 1, c = a + spokes, d = c + 1;
        indices[p++] = a; indices[p++] = c; indices[p++] = b;
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }
    return { positions, normals, forest, indices, rings, spokes };
  }

  // ---------- Köy, çiftlikler, kule ----------
  // Köşe öznitelikleri: konum(3), normal(3), bilgi(4) = (u, v, tohum, tür)
  // tür: 0 duvar (pencereli), 1 çatı, 2 kule/sivri çatı, 3 üçgen alınlık, 4 metal direk
  function buildVillage() {
    const rng = M.mulberry32(20260923);
    const houses = [];
    const tooClose = (x, z, minD) => houses.some((h) => Math.hypot(h.x - x, h.z - z) < minD);
    const flatEnough = (x, z) => {
      const c = groundHeight(x, z);
      return Math.abs(groundHeight(x + 7, z) - c) < 3 && Math.abs(groundHeight(x, z + 7) - c) < 3 &&
        Math.abs(groundHeight(x - 7, z) - c) < 3 && Math.abs(groundHeight(x, z - 7) - c) < 3;
    };
    for (let attempt = 0; attempt < 6000 && houses.length < 72; attempt++) {
      const x = M.lerp(-760, 300, rng()), z = M.lerp(-1650, -1290, rng());
      if (lakeField(x, z) > -0.02 || villageMask(x, z) < 0.35) continue;
      const y = groundHeight(x, z);
      if (y < 0.5 || y > 30 || tooClose(x, z, 17) || !flatEnough(x, z)) continue;
      houses.push({ x, y, z, kind: 'ev' });
    }
    // Kilise: köy merkezine en yakın ev
    let ci = 0, best = Infinity;
    houses.forEach((h, i) => { const d = Math.hypot(h.x + 200, h.z + 1440); if (d < best) { best = d; ci = i; } });
    if (houses.length) houses[ci].kind = 'kilise';
    // Tepelerdeki dağınık çiftlik evleri
    for (let attempt = 0; attempt < 4000 && houses.length < 100; attempt++) {
      const ang = M.lerp(-0.9, 0.9, rng()), r = M.lerp(1800, 6500, rng());
      const x = CAMERA_POS[0] + r * Math.sin(ang), z = CAMERA_POS[2] - r * Math.cos(ang);
      if (lakeField(x, z) > -0.05 || villageMask(x, z) > 0.1) continue;
      const y = groundHeight(x, z);
      if (y < 2 || y > 420 || tooClose(x, z, 120) || !flatEnough(x, z)) continue;
      if (Math.hypot(x - TOWER.x, z - TOWER.z) < 200) continue;
      houses.push({ x, y, z, kind: 'ciftlik' });
    }

    const P = [], N = [], I = [], idx = [];
    let vcount = 0;
    const lakeDir = (x, z) => Math.atan2(LAKE.cx - x, LAKE.cz - z);
    function quad(a, b, c, d, n, ua, va, ub, vb, uc, vc, ud, vd, seed, kind) {
      for (const [p, u, v] of [[a, ua, va], [b, ub, vb], [c, uc, vc], [d, ud, vd]]) {
        P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); I.push(u, v, seed, kind);
      }
      idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
      vcount += 4;
    }
    function tri(a, b, c, n, ua, va, ub, vb, uc, vc, seed, kind) {
      for (const [p, u, v] of [[a, ua, va], [b, ub, vb], [c, uc, vc]]) {
        P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); I.push(u, v, seed, kind);
      }
      idx.push(vcount, vcount + 1, vcount + 2);
      vcount += 3;
    }
    const faceNormal = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      return M.v3.norm(M.v3.cross(u, v));
    };
    // Dikdörtgen gövde + beşik çatı. Yerel eksenler: a (genişlik yönü), b (derinlik yönü).
    function building(cx, cy, cz, yaw, w, d, h, roofH, seed, wallKind) {
      const ax = [Math.cos(yaw), 0, -Math.sin(yaw)], bz = [Math.sin(yaw), 0, Math.cos(yaw)];
      const P3 = (u, y, v) => [cx + ax[0] * u + bz[0] * v, cy + y, cz + ax[2] * u + bz[2] * v];
      const hw = w / 2, hd = d / 2, base = -1.5; // temel zemine gömülür
      const c = [P3(-hw, base, -hd), P3(hw, base, -hd), P3(hw, base, hd), P3(-hw, base, hd)];
      const t = [P3(-hw, h, -hd), P3(hw, h, -hd), P3(hw, h, hd), P3(-hw, h, hd)];
      const walls = [[0, 1, w], [1, 2, d], [2, 3, w], [3, 0, d]];
      for (const [i0, i1, len] of walls) {
        const n = faceNormal(c[i0], c[i1], t[i1]);
        quad(c[i0], c[i1], t[i1], t[i0], n, 0, base, len, base, len, h, 0, h, seed, wallKind);
      }
      // Sırt çizgisi genişlik yönünde
      const r0 = P3(-hw, h + roofH, 0), r1 = P3(hw, h + roofH, 0);
      const e0 = P3(-hw - 0.4, h - 0.3, -hd - 0.5), e1 = P3(hw + 0.4, h - 0.3, -hd - 0.5);
      const e2 = P3(hw + 0.4, h - 0.3, hd + 0.5), e3 = P3(-hw - 0.4, h - 0.3, hd + 0.5);
      quad(e0, e1, r1, r0, faceNormal(e0, e1, r1), 0, 0, w, 0, w, 1, 0, 1, seed, 1);
      quad(e2, e3, r0, r1, faceNormal(e2, e3, r0), 0, 0, w, 0, w, 1, 0, 1, seed, 1);
      tri(t[1], t[2], r1, faceNormal(t[1], t[2], r1), 0, h, d, h, d / 2, h + roofH, seed, 3);
      tri(t[3], t[0], r0, faceNormal(t[3], t[0], r0), 0, h, d, h, d / 2, h + roofH, seed, 3);
    }
    function spire(cx, cy, cz, yaw, size, hBase, hTop, seed) {
      const ax = [Math.cos(yaw), 0, -Math.sin(yaw)], bz = [Math.sin(yaw), 0, Math.cos(yaw)];
      const P3 = (u, y, v) => [cx + ax[0] * u + bz[0] * v, cy + y, cz + ax[2] * u + bz[2] * v];
      const s = size / 2;
      const c = [P3(-s, 0, -s), P3(s, 0, -s), P3(s, 0, s), P3(-s, 0, s)];
      const t = [P3(-s, hBase, -s), P3(s, hBase, -s), P3(s, hBase, s), P3(-s, hBase, s)];
      for (let i = 0; i < 4; i++) {
        const i1 = (i + 1) % 4;
        quad(c[i], c[i1], t[i1], t[i], faceNormal(c[i], c[i1], t[i1]), 0, 0, size, 0, size, hBase, 0, hBase, seed, 0);
      }
      const apex = P3(0, hTop, 0);
      for (let i = 0; i < 4; i++) {
        const i1 = (i + 1) % 4;
        tri(t[i], t[i1], apex, faceNormal(t[i], t[i1], apex), 0, 0, 1, 0, 0.5, 1, seed, 2);
      }
    }

    for (const hs of houses) {
      const seed = rng();
      const yaw = lakeDir(hs.x, hs.z) + (rng() - 0.5) * 0.6;
      hs.yaw = yaw;
      if (hs.kind === 'kilise') {
        building(hs.x, hs.y, hs.z, yaw, 12, 22, 10, 6, seed, 0);
        const off = [Math.sin(yaw) * 13, Math.cos(yaw) * 13];
        spire(hs.x + off[0], hs.y, hs.z + off[1], yaw, 6, 22, 42, seed);
      } else if (hs.kind === 'ciftlik') {
        building(hs.x, hs.y, hs.z, yaw, M.lerp(9, 14, rng()), M.lerp(7, 10, rng()), M.lerp(4, 6, rng()), M.lerp(2.5, 4, rng()), seed, 0);
      } else {
        const floors = rng() < 0.3 ? 2 : 1;
        building(hs.x, hs.y, hs.z, yaw, M.lerp(8, 13, rng()), M.lerp(7, 11, rng()), floors * 3.1 + M.lerp(0.6, 1.2, rng()), M.lerp(2.5, 4, rng()), seed, 0);
      }
    }

    // Radyo kulesi: incelen dört yüzlü direk + anten
    {
      const b = tower.base, H = tower.height;
      const ring = (y, s) => [[b[0] - s, b[1] + y, b[2] - s], [b[0] + s, b[1] + y, b[2] - s], [b[0] + s, b[1] + y, b[2] + s], [b[0] - s, b[1] + y, b[2] + s]];
      const lo = ring(-2, 2.8), hi = ring(H - 8, 0.45);
      for (let i = 0; i < 4; i++) {
        const i1 = (i + 1) % 4;
        quad(lo[i], lo[i1], hi[i1], hi[i], faceNormal(lo[i], lo[i1], hi[i1]), 0, 0, 1, 0, 1, H, 0, H, 0.5, 4);
      }
      const alo = ring(H - 8, 0.2), ahi = ring(H, 0.12);
      for (let i = 0; i < 4; i++) {
        const i1 = (i + 1) % 4;
        quad(alo[i], alo[i1], ahi[i1], ahi[i], faceNormal(alo[i], alo[i1], ahi[i1]), 0, 0, 1, 0, 1, 8, 0, 8, 0.5, 4);
      }
    }

    // Lambalar
    const lamps = [];
    // Kıyı yolu lambaları: düzensiz aralık, bazıları yanmıyor; köy içinde birkaç ara sokak lambası.
    for (let x = -700; x <= 260; x += 26 + rng() * 34) {
      let a = -1250, bb = -1720; // kıyıdan içeri L = -0.035 noktasını bul
      if (lakeField(x, a) < -0.035) continue;
      for (let it = 0; it < 30; it++) { const m = (a + bb) / 2; if (lakeField(x, m) > -0.035) a = m; else bb = m; }
      const z = (a + bb) / 2 - rng() * 14;
      if (villageMask(x, z) < 0.2 || rng() < 0.25) continue;
      const warm = rng() < 0.75;
      lamps.push(x, groundHeight(x, z) + 6, z, 1.3, warm ? 1.0 : 0.85, warm ? 0.55 : 0.8, warm ? 0.2 : 0.62, 0);
    }
    for (const hs of houses) {
      if (hs.kind === 'ev' && rng() < 0.18) lamps.push(hs.x + (rng() - 0.5) * 12, hs.y + 4, hs.z + (rng() - 0.5) * 12, 0.9, 1.0, 0.62, 0.3, 0);
    }
    for (const y of [50, 100, tower.height]) lamps.push(tower.base[0], tower.base[1] + y, tower.base[2], 2.6, 1.0, 0.07, 0.04, 1);
    for (const hs of houses) {
      if (hs.kind === 'ciftlik' && rng() < 0.7) lamps.push(hs.x, hs.y + 3, hs.z, 1.0, 1.0, 0.72, 0.42, 2);
    }

    return {
      positions: Float32Array.from(P), normals: Float32Array.from(N), info: Float32Array.from(I),
      indices: Uint32Array.from(idx), lamps: Float32Array.from(lamps), houses,
    };
  }

  function classify(p) {
    const [x, y, z] = p;
    if (isWater(x, z) && y <= 0.01) return 'göl';
    if (villageMask(x, z) > 0.5) return 'köy';
    const d = Math.hypot(x - CAMERA_POS[0], z - CAMERA_POS[2]);
    if (d > 4500 && groundHeight(x, z) > 200) return 'dağ';
    if (forestMask(x, z) > 0.5) return 'orman';
    return 'tepe';
  }

  // Ekran ışınından çarpma hedefi. origin: dünya konumu, dir: birim yön.
  function pickTarget(origin, dir) {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = [dir[0] / l, dir[1] / l, dir[2] / l];
    const o = origin;
    let hit = null;
    let prevT = 0, t = 1;
    while (t < 20000) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      if (y <= surfaceHeight(x, z)) {
        let a = prevT, b = t;
        for (let i = 0; i < 28; i++) {
          const m = (a + b) / 2;
          if (o[1] + d[1] * m <= surfaceHeight(o[0] + d[0] * m, o[2] + d[2] * m)) b = m; else a = m;
        }
        hit = [o[0] + d[0] * b, 0, o[2] + d[2] * b];
        break;
      }
      if (d[1] > 0 && y > 2600) break;
      prevT = t;
      t += Math.max(1.5, t * 0.006);
    }
    const hl = Math.hypot(d[0], d[2]) || 1;
    const hx = d[0] / hl, hz = d[2] / hl;
    let px, pz;
    if (hit) { px = hit[0]; pz = hit[2]; }
    else {
      let horiz = d[1] > 1e-4 ? (CLOUD_BASE - o[1]) / d[1] * hl : PICK.maxDist;
      horiz = M.clamp(horiz, PICK.skyMin, PICK.maxDist);
      px = o[0] + hx * horiz; pz = o[2] + hz * horiz;
    }
    let hd = Math.hypot(px - o[0], pz - o[2]);
    if (hd < PICK.minDist || hd > PICK.maxDist) {
      const target = M.clamp(hd, PICK.minDist, PICK.maxDist);
      const ux = hd > 1e-3 ? (px - o[0]) / hd : hx, uz = hd > 1e-3 ? (pz - o[2]) / hd : hz;
      px = o[0] + ux * target; pz = o[2] + uz * target;
      hd = target;
    }
    let point = [px, surfaceHeight(px, pz), pz];

    // Paratoner etkisi: kuleye yakın hedefler ya da kuleye yakın geçen ışınlar kule ucuna çekilir.
    const near = Math.hypot(point[0] - tower.base[0], point[2] - tower.base[2]) < PICK.towerRadius;
    const rayDist = raySegmentDistance(o, d, tower.base, tower.tip);
    const towerDist = Math.hypot(tower.base[0] - o[0], tower.base[2] - o[2]);
    if (near || (rayDist < PICK.towerRay && hd > towerDist - 400)) {
      return { point: tower.tip.slice(), surface: 'kule', dist: towerDist };
    }
    return { point, surface: classify(point), dist: hd };
  }

  // Yerden (x, z) hedef; kuleye yakınsa kule ucuna yapışır (otomatik çakışlar için).
  function targetAt(x, z) {
    const dist = Math.hypot(x - CAMERA_POS[0], z - CAMERA_POS[2]);
    if (Math.hypot(x - tower.base[0], z - tower.base[2]) < PICK.towerRadius) {
      return { point: tower.tip.slice(), surface: 'kule', dist: Math.hypot(tower.base[0] - CAMERA_POS[0], tower.base[2] - CAMERA_POS[2]) };
    }
    const point = [x, surfaceHeight(x, z), z];
    return { point, surface: classify(point), dist };
  }

  // Işın ile doğru parçası arasındaki en kısa uzaklık (örnekleme ile, parça dikey).
  function raySegmentDistance(o, d, a, b) {
    let best = Infinity;
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      const t = Math.max(0, v[0] * d[0] + v[1] * d[1] + v[2] * d[2]);
      const dx = v[0] - d[0] * t, dy = v[1] - d[1] * t, dz = v[2] - d[2] * t;
      best = Math.min(best, Math.hypot(dx, dy, dz));
    }
    return best;
  }

  F.Terrain = {
    CAMERA_POS, CLOUD_BASE, LAMP_STRIDE, LAKE, VILLAGE, TOWER, PICK, MESH_HALF,
    lakeField, groundHeight, height, surfaceHeight, forestMask, villageMask, isWater,
    tower, buildMesh, buildVillage, pickTarget, targetAt, classify,
  };
})(typeof self !== 'undefined' ? self : globalThis);
