/* Yıldırım Gözlemevi — dielektrik kırılma modeli (DBM) ile yıldırım geometrisi üreteci.
 *
 * Kanal, 3B ızgarada Laplace büyümesiyle üretilir. Laplace çözümü, "Fast Simulation of Laplacian
 * Growth" (Kim ve ark. 2007) yaklaşımıyla nokta yüklerin üst üste binmesi olarak hesaplanır; aday
 * hücrelerin tarama toplamı her adımda artımlı güncellenir. Yükler öz tutarlıdır (bkz. grow). Büyüme
 * olasılığı p ∝ Φ^η'dir; η küçüldükçe dallanma artar.
 *
 * Modülün tamamı dbmModule() içindedir: Web Worker kaynağı bu fonksiyonun metninden kurulur ve Node
 * testleri aynı kodu yükler. DOM kullanılmaz. */
(function (root) {
  'use strict';

  function dbmModule() {
    'use strict';

    // Parça düzeni: p0.xyz, p1.xyz, tL0, tL1, s0, s1, w0, w1, width, flags, strokeMask, pad
    const SEG_STRIDE = 16;
    // Işık düzeni: x, y, z, s, tL, w, flags, strokeMask
    const LIGHT_STRIDE = 8;
    // Akustik parça düzeni: x, y, z, dx, dy, dz, len, weight, main
    const ACOUSTIC_STRIDE = 9;
    const MAX_LIGHTS = 14;
    const FLAG = { MAIN: 1, BRANCH: 2, STREAMER: 4, CLOUD: 8, UPWARD: 16 };
    const NEVER = 1e7; // dönüş darbesinin hiç ulaşmadığı mesafe

    const KINDS = {
      cg: { cell: 20, half: 80, bg: 'vertical', etaAdd: 0, above: [500, 1000], maxSteps: 7000 },
      cgp: { cell: 24, half: 80, bg: 'vertical', etaAdd: 1.2, above: [1900, 2600], maxSteps: 8000 },
      spider: { cell: 40, half: 128, ny: 7, bg: 'radial', etaAdd: 0, maxSteps: 1300 },
    };

    // Ayarlanabilir model sabitleri (tools/dbm_preview.mjs ile görsel olarak belirlendi).
    const TUNE = {
      bgPow: 0.7,      // dikey arka plan B = u^bgPow; buluta yakın alan daha güçlü, üst kısımda daha çok dal
      radialPow: 0.45, // örümcek için radyal arka plan B = (r/R)^radialPow
      rough: 0.15,     // orta nokta sapması / parça uzunluğu
      jitter: 0.7,     // kafes kırıcı titreşim (hücre cinsinden)
      prune: 0.4,      // 1-2 hücrelik dalları budama olasılığı
      upDelta: 0.012,  // yukarı bağlantı öncüsünün süresi (öncü süresinin kesri)
    };

    // ---------- Rastgelelik ----------
    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function gauss(rng) {
      let u = rng();
      while (u <= 1e-12) u = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * rng());
    }
    function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }

    // 26 komşu
    const N26 = (function () {
      const dx = [], dy = [], dz = [], dist = [];
      for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
        if (!x && !y && !z) continue;
        dx.push(x); dy.push(y); dz.push(z); dist.push(Math.sqrt(x * x + y * y + z * z));
      }
      return { dx: Int8Array.from(dx), dy: Int8Array.from(dy), dz: Int8Array.from(dz), dist: Float32Array.from(dist) };
    })();

    // ---------- Laplace büyümesi ----------
    // Potansiyel: Φ_i = B(konum_i) - Σ_j q_j R / r_ij  (R = yarım hücre).
    // Yeni kanal hücresinin yükü, seçildiği andaki potansiyelidir (öz tutarlı yük): kanal kendi yerinde
    // potansiyeli sıfıra çeker. Taranmış hücrelerin yükü küçük, uçlarınki büyük olur; uçta alan güçlenir.
    function grow(g, rng) {
      const NX = g.NX, NY = g.NY, NZ = g.NZ, ox = g.ox, oy = g.oy, oz = g.oz, T = g.tune;
      const NXY = NX * NY;
      const vertical = g.bg === 'vertical';
      const grid = new Uint8Array(NX * NY * NZ);
      const cap = g.maxSteps + 1024;
      const px = new Int16Array(cap), py = new Int16Array(cap), pz = new Int16Array(cap);
      const pq = new Float64Array(cap);
      const parent = new Int32Array(cap);
      const pIndex = new Map();
      let pN = 0;

      // Aday dizileri baştan yeterli kapasiteyle ayrılır (her hücre en fazla 26 aday ekler).
      const cCap = cap * 26;
      const cX = new Float32Array(cCap), cY = new Float32Array(cCap), cZ = new Float32Array(cCap);
      const cS = new Float64Array(cCap), cB = new Float64Array(cCap), cW = new Float64Array(cCap);
      let cN = 0;

      function background(x, y, z) {
        if (vertical) {
          const u = (oy - y) / oy;
          return u > 0 ? Math.pow(u, T.bgPow) : u;
        }
        const dx = x - ox, dz = z - oz;
        return Math.pow(Math.sqrt(dx * dx + dz * dz) / g.radialMax, T.radialPow);
      }

      // Yalnızca desen dizilerine yazar (büyüme bittikten sonraki zorunlu bağlantı için).
      function pushNode(x, y, z, par) {
        const k = pN++;
        px[k] = x; py[k] = y; pz[k] = z; parent[k] = par; pq[k] = 0;
        grid[x + y * NX + z * NXY] = 1;
        pIndex.set(x + y * NX + z * NXY, k);
        return k;
      }

      function addNode(x, y, z, par, q) {
        const idx = x + y * NX + z * NXY;
        grid[idx] = 1;
        const k = pN++;
        px[k] = x; py[k] = y; pz[k] = z; parent[k] = par; pq[k] = q;
        pIndex.set(idx, k);
        if (q > 0) {
          const qR = 0.5 * q;
          for (let i = 0; i < cN; i++) {
            const dx = cX[i] - x, dy = cY[i] - y, dz = cZ[i] - z;
            cS[i] += qR / Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
        }
        for (let n = 0; n < 26; n++) {
          const nx = x + N26.dx[n], ny = y + N26.dy[n], nz = z + N26.dz[n];
          if (nx < 1 || nz < 1 || nx > NX - 2 || nz > NZ - 2 || ny < 0 || ny > NY - 1) continue;
          const nidx = nx + ny * NX + nz * NXY;
          if (grid[nidx] !== 0) continue;
          grid[nidx] = 2;
          let s = 0;
          for (let j = 0; j < pN; j++) {
            const qj = pq[j];
            if (qj <= 0) continue;
            const dx = nx - px[j], dy = ny - py[j], dz = nz - pz[j];
            s += qj / Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          cX[cN] = nx; cY[cN] = ny; cZ[cN] = nz; cS[cN] = 0.5 * s; cB[cN] = background(nx, ny, nz);
          cN++;
        }
        return k;
      }

      function bestParent(x, y, z) {
        let best = -1, bestD = 9;
        for (let n = 0; n < 26; n++) {
          const nx = x + N26.dx[n], ny = y + N26.dy[n], nz = z + N26.dz[n];
          if (nx < 0 || nz < 0 || ny < 0 || nx >= NX || ny >= NY || nz >= NZ) continue;
          const k = pIndex.get(nx + ny * NX + nz * NXY);
          if (k === undefined) continue;
          const d = N26.dist[n];
          if (d < bestD - 1e-6 || (Math.abs(d - bestD) < 1e-6 && k > best)) { bestD = d; best = k; }
        }
        return best;
      }

      // Φ^η için arama tablosu (Math.pow çağrısını iç döngüden çıkarır).
      const LUT_N = 4096;
      const lut = new Float64Array(LUT_N + 1);
      for (let i = 0; i <= LUT_N; i++) lut[i] = Math.pow(i / LUT_N, g.eta);

      addNode(ox, oy, oz, -1, 0);
      let strikeNode = -1, steps = 0;
      while (steps < g.maxSteps && cN > 0) {
        steps++;
        let pMax = -Infinity, iMax = 0;
        for (let i = 0; i < cN; i++) {
          const phi = cB[i] - cS[i];
          cW[i] = phi;
          if (phi > pMax) { pMax = phi; iMax = i; }
        }
        let chosen = iMax;
        if (pMax > 0) {
          const inv = 1 / pMax;
          let total = 0;
          for (let i = 0; i < cN; i++) {
            const p = cW[i] * inv;
            if (p <= 0.012) { cW[i] = 0; continue; }
            const w = lut[(p >= 1 ? LUT_N : (p * LUT_N) | 0)];
            cW[i] = w; total += w;
          }
          let r = rng() * total;
          for (let i = 0; i < cN; i++) { r -= cW[i]; if (r <= 0) { chosen = i; break; } }
        }
        const x = cX[chosen], y = cY[chosen], z = cZ[chosen];
        const q = Math.max(0, cB[chosen] - cS[chosen]);
        cN--;
        if (chosen !== cN) {
          cX[chosen] = cX[cN]; cY[chosen] = cY[cN]; cZ[chosen] = cZ[cN];
          cS[chosen] = cS[cN]; cB[chosen] = cB[cN];
        }
        const par = bestParent(x, y, z);
        const k = addNode(x, y, z, par, q);
        if (g.onProgress && (steps & 255) === 0) g.onProgress(steps, pN, cN);
        if (vertical && y <= g.groundStop) { strikeNode = k; break; }
        if (!vertical) {
          const dx = x - ox, dz = z - oz;
          if (dx * dx + dz * dz >= (g.radialMax - 3) * (g.radialMax - 3)) break;
        }
      }

      if (vertical) {
        if (strikeNode < 0) {
          // Adım bütçesi bitti: en alçak uçtan zemine zorunlu bağlantı.
          let low = 0;
          for (let k = 1; k < pN; k++) if (py[k] < py[low]) low = k;
          let x = px[low], y = py[low], z = pz[low], par = low;
          while (y > 0) {
            y--;
            if (rng() < 0.35) x = clampNum(x + (rng() < 0.5 ? -1 : 1), 1, NX - 2);
            if (rng() < 0.35) z = clampNum(z + (rng() < 0.5 ? -1 : 1), 1, NZ - 2);
            const existing = pIndex.get(x + y * NX + z * NXY);
            par = existing !== undefined ? existing : pushNode(x, y, z, par);
          }
          strikeNode = par;
        }
        if (py[strikeNode] > 0) {
          const x = px[strikeNode], z = pz[strikeNode];
          const existing = pIndex.get(x + z * NXY);
          strikeNode = existing !== undefined && existing > strikeNode ? existing : pushNode(x, 0, z, strikeNode);
        }
      }

      return { N: pN, px, py, pz, parent, strikeNode, steps };
    }

    // ---------- Geometri yardımcıları ----------
    function perpUnit(dx, dy, dz, rng, out) {
      let rx = rng() - 0.5, ry = rng() - 0.5, rz = rng() - 0.5;
      const dl2 = dx * dx + dy * dy + dz * dz || 1;
      const k = (rx * dx + ry * dy + rz * dz) / dl2;
      rx -= k * dx; ry -= k * dy; rz -= k * dz;
      const l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      out[0] = rx / l; out[1] = ry / l; out[2] = rz / l;
    }

    // a'dan b'ye kenarı orta nokta sapmasıyla böler; a hariç, b dahil noktaları ve u parametrelerini ekler.
    function subdivide(rng, ax, ay, az, bx, by, bz, depth, rough, minY, outP, outU) {
      let P = [ax, ay, az, bx, by, bz], U = [0, 1];
      const tmp = [0, 0, 0];
      for (let lvl = 0; lvl < depth; lvl++) {
        const nP = [P[0], P[1], P[2]], nU = [U[0]];
        for (let i = 0; i < U.length - 1; i++) {
          const x0 = P[3 * i], y0 = P[3 * i + 1], z0 = P[3 * i + 2];
          const x1 = P[3 * i + 3], y1 = P[3 * i + 4], z1 = P[3 * i + 5];
          const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          perpUnit(dx, dy, dz, rng, tmp);
          const gg = gauss(rng) * rough * len;
          const mx = (x0 + x1) * 0.5 + tmp[0] * gg;
          let my = (y0 + y1) * 0.5 + tmp[1] * gg;
          const mz = (z0 + z1) * 0.5 + tmp[2] * gg;
          if (my < minY) my = minY;
          nP.push(mx, my, mz, x1, y1, z1);
          nU.push((U[i] + U[i + 1]) * 0.5, U[i + 1]);
        }
        P = nP; U = nU;
      }
      for (let i = 1; i < U.length; i++) { outP.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); outU.push(U[i]); }
    }

    function cumulative(pts) {
      const n = pts.length / 3, d = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        const dx = pts[3 * i] - pts[3 * i - 3], dy = pts[3 * i + 1] - pts[3 * i - 2], dz = pts[3 * i + 2] - pts[3 * i - 1];
        d[i] = d[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      return d;
    }

    // ---------- Ağaç işleme ve geometri ----------
    function buildGeometry(c) {
      const K = c.K, G = c.G, T = c.T, rng = c.rng, cell = K.cell, cloudBase = c.cloudBase;
      const vertical = K.bg === 'vertical';
      const N = G.N, parent = G.parent;

      // Çocuk listeleri (CSR), alt ağaç boyutları, derinlik
      const childStart = new Int32Array(N + 1);
      for (let k = 1; k < N; k++) childStart[parent[k] + 1]++;
      for (let k = 0; k < N; k++) childStart[k + 1] += childStart[k];
      const childList = new Int32Array(Math.max(1, N - 1));
      const fill = childStart.slice(0, N);
      for (let k = 1; k < N; k++) childList[fill[parent[k]]++] = k;
      const size = new Int32Array(N).fill(1);
      for (let k = N - 1; k > 0; k--) size[parent[k]] += size[k];
      const depth = new Int32Array(N);
      for (let k = 1; k < N; k++) depth[k] = depth[parent[k]] + 1;

      let mainEnd = G.strikeNode;
      if (!vertical) { mainEnd = 0; for (let k = 1; k < N; k++) if (depth[k] > depth[mainEnd]) mainEnd = k; }
      const isMain = new Uint8Array(N);
      for (let k = mainEnd; k >= 0; k = parent[k]) isMain[k] = 1;

      const cont = new Int32Array(N).fill(-1);
      for (let k = 0; k < N; k++) {
        let best = -1;
        for (let ci = childStart[k]; ci < childStart[k + 1]; ci++) {
          const ch = childList[ci];
          if (isMain[k]) { if (isMain[ch]) { best = ch; break; } continue; }
          if (best < 0 || size[ch] > size[best]) best = ch;
        }
        cont[k] = best;
      }

      const removed = new Uint8Array(N);
      for (let k = 1; k < N; k++) {
        const p = parent[k];
        if (removed[p]) { removed[k] = 1; continue; }
        if (!isMain[k] && cont[p] !== k && size[k] <= 2 && rng() < T.prune) removed[k] = 1;
      }

      // Dünya konumları, titreşim, yumuşatma
      const X = new Float64Array(N), Y = new Float64Array(N), Z = new Float64Array(N);
      const layerBase = cloudBase - 120;
      for (let k = 0; k < N; k++) {
        X[k] = (G.px[k] - K.half) * cell;
        Z[k] = (G.pz[k] - K.half) * cell;
        Y[k] = vertical ? G.py[k] * cell : layerBase + (G.py[k] - c.oy) * cell;
      }
      const J = T.jitter * cell;
      for (let k = 1; k < N; k++) {
        const jx = (rng() - 0.5) * J, jy = (rng() - 0.5) * J, jz = (rng() - 0.5) * J;
        if (vertical && k === mainEnd) { X[k] += jx; Z[k] += jz; continue; }
        X[k] += jx; Y[k] += jy; Z[k] += jz;
        if (vertical && Y[k] < 0.35 * cell) Y[k] = 0.35 * cell;
      }
      const SX = X.slice(), SY = Y.slice(), SZ = Z.slice();
      for (let k = 1; k < N; k++) {
        const ch = cont[k];
        if (ch < 0 || (vertical && k === mainEnd)) continue;
        const p = parent[k];
        SX[k] = 0.5 * X[k] + 0.25 * (X[p] + X[ch]);
        SY[k] = 0.5 * Y[k] + 0.25 * (Y[p] + Y[ch]);
        SZ[k] = 0.5 * Z[k] + 0.25 * (Z[p] + Z[ch]);
        if (vertical && SY[k] < 0.35 * cell) SY[k] = 0.35 * cell;
      }

      const tNode = new Float64Array(N);
      const lastIndex = Math.max(1, vertical ? mainEnd : N - 1);
      for (let k = 0; k < N; k++) tNode[k] = k / lastIndex;

      const out = [];          // parça sayıları
      const chains = [];       // ışık ve akustik için
      const nodeS = new Float64Array(N), nodeW = new Float64Array(N);
      const minY = vertical ? 0.3 : -1e9;
      let hj = 0, tScale = 1, mainLength = 0, cloudEntryS = 0, branchCount = 0, maxLevel = 0;
      let mainPts = null, mainS = null;

      function emit(pts, tls, s, w, width, flags, mask, upFrom) {
        const n = pts.length / 3;
        for (let i = 0; i < n - 1; i++) {
          const f = (upFrom >= 0 && i >= upFrom) ? (flags | FLAG.UPWARD) : flags;
          out.push(
            pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], pts[3 * i + 3], pts[3 * i + 4], pts[3 * i + 5],
            tls[i], tls[i + 1], s[i], s[i + 1], w[i], w[i + 1], width, f, mask, 0
          );
        }
      }

      const queue = [{ head: 0, junction: -1, level: 0 }];
      for (let qi = 0; qi < queue.length; qi++) {
        const item = queue[qi];
        const nodes = [];
        if (item.junction >= 0) nodes.push(item.junction);
        for (let k = item.head; k >= 0; k = cont[k]) {
          if (removed[k]) break;
          nodes.push(k);
          for (let ci = childStart[k]; ci < childStart[k + 1]; ci++) {
            const ch = childList[ci];
            if (ch === cont[k] || removed[ch]) continue;
            queue.push({ head: ch, junction: k, level: item.level + 1 });
          }
        }
        if (nodes.length < 2) continue;
        const level = item.level;
        const isMainChain = level === 0;
        const subDepth = isMainChain ? 3 : nodes.length > 8 ? 3 : nodes.length > 3 ? 2 : 1;
        const pts = [SX[nodes[0]], SY[nodes[0]], SZ[nodes[0]]], tls = [tNode[nodes[0]]];
        const nodeVert = [0];
        for (let i = 1; i < nodes.length; i++) {
          const a = nodes[i - 1], b = nodes[i];
          const us = [];
          subdivide(rng, SX[a], SY[a], SZ[a], SX[b], SY[b], SZ[b], subDepth, T.rough,
            (vertical && b === mainEnd) ? 0 : minY, pts, us);
          for (const u of us) tls.push(tNode[a] + (tNode[b] - tNode[a]) * u);
          nodeVert.push(tls.length - 1);
        }
        if (vertical && isMainChain) {
          // Çarpma noktası tam zeminde kalır.
          pts[pts.length - 2] = 0;
        }

        let upFrom = -1;
        if (vertical && isMainChain) {
          // Yukarı bağlantı öncüsü: zeminden hj yüksekliğine kadar olan kısım yeniden zamanlanır.
          hj = 28 + rng() * 42;
          const n = pts.length / 3;
          let j = -1;
          for (let i = n - 1; i >= 0; i--) if (pts[3 * i + 1] >= hj) { j = i; break; }
          if (j < 0) j = 0;
          if (j < n - 1) {
            const ya = pts[3 * j + 1], yb = pts[3 * j + 4];
            if (ya - hj > 1e-6) {
              const u = (ya - hj) / (ya - yb);
              const x = pts[3 * j] + (pts[3 * j + 3] - pts[3 * j]) * u;
              const z = pts[3 * j + 2] + (pts[3 * j + 5] - pts[3 * j + 2]) * u;
              const t = tls[j] + (tls[j + 1] - tls[j]) * u;
              pts.splice(3 * (j + 1), 0, x, hj, z);
              tls.splice(j + 1, 0, t);
              for (let v = 0; v < nodeVert.length; v++) if (nodeVert[v] > j) nodeVert[v]++;
              j = j + 1;
            }
          }
          const d0 = cumulative(pts);
          const tj = tls[j];
          const last = pts.length / 3 - 1;
          const E = Math.max(1e-6, d0[last] - d0[j]);
          for (let i = j + 1; i <= last; i++) tls[i] = tj - T.upDelta * (d0[i] - d0[j]) / E;
          tScale = tj > 1e-6 ? 1 / tj : 1;
          upFrom = j;
        }

        const d = cumulative(pts);
        const n = pts.length / 3, Lc = d[n - 1];
        const s = new Float64Array(n), w = new Float64Array(n);
        let width, flags, mask;
        if (isMainChain) {
          flags = FLAG.MAIN; mask = 0xff; width = vertical ? 1.4 : 1.1;
          for (let i = 0; i < n; i++) {
            if (vertical) { s[i] = Lc - d[i]; w[i] = 1; }
            else { s[i] = d[i]; w[i] = (0.3 + 0.7 * Math.exp(-d[i] / 5200)); }
          }
          mainLength = Lc;
          if (vertical) {
            mainPts = pts; mainS = s;
            for (let i = n - 1; i >= 0; i--) if (pts[3 * i + 1] >= cloudBase) { cloudEntryS = s[i]; break; }
          }
        } else {
          flags = FLAG.BRANCH; mask = vertical ? 0x01 : 0xff;
          branchCount++;
          const sJ = nodeS[item.junction], wJ = nodeW[item.junction];
          if (vertical) {
            const sizeF = clampNum(Math.log(1 + size[item.head]) / Math.log(81), 0.18, 1);
            const w0 = wJ * 0.42 * sizeF * (level === 1 ? 1 : 0.8);
            const decay = 0.45 * Lc + 60;
            for (let i = 0; i < n; i++) { s[i] = sJ + d[i] * 3.0; w[i] = w0 * Math.exp(-d[i] / decay); }
            width = 0.45 + 0.9 * w0;
          } else {
            for (let i = 0; i < n; i++) {
              s[i] = sJ + d[i];
              w[i] = (0.3 + 0.7 * Math.exp(-s[i] / 5200)) * Math.pow(0.82, level);
            }
            width = 0.8;
          }
        }
        if (level > maxLevel) maxLevel = level;
        for (let v = 0; v < nodes.length; v++) { nodeS[nodes[v]] = s[nodeVert[v]]; nodeW[nodes[v]] = w[nodeVert[v]]; }
        chains.push({ pts, tls, s, w, flags, mask, level, length: Lc, size: size[item.head], upFrom, width });
      }

      // Zaman ölçeği: bağlantı anı tL = 1 olur.
      for (const ch of chains) {
        for (let i = 0; i < ch.tls.length; i++) ch.tls[i] *= tScale;
        emit(ch.pts, ch.tls, ch.s, ch.w, ch.width, ch.flags, ch.mask, ch.upFrom);
      }

      let strike = null, origin = [SX[0], SY[0], SZ[0]];
      if (vertical) {
        strike = [SX[mainEnd], 0, SZ[mainEnd]];
        addInCloud();
        addStreamers();
      }

      function addInCloud() {
        const nPts = mainPts.length / 3;
        const cand = [];
        for (let i = 0; i < nPts; i++) if (mainPts[3 * i + 1] > cloudBase + 150) cand.push(i);
        if (!cand.length) cand.push(0);
        const top = cand.slice(0, Math.max(1, Math.ceil(cand.length * 0.45)));
        const count = 3 + Math.floor(rng() * 3);
        const rootY = SY[0];
        for (let cI = 0; cI < count; cI++) {
          const vi = top[Math.floor(rng() * top.length)];
          const mask = 1 | (Math.floor(rng() * 256) & 0xfe);
          growCloudChain(mainPts[3 * vi], mainPts[3 * vi + 1], mainPts[3 * vi + 2], mainS[vi],
            rng() * 6.283185307179586, 900 + rng() * 2300, 0.55, mask, rootY, true);
        }
      }

      function growCloudChain(x, y, z, sStart, az, len, wScale, mask, rootY, allowSub) {
        const step = 70;
        const nodesP = [x, y, z];
        let ty = clampNum(y + gauss(rng) * 150, cloudBase + 160, rootY + 450);
        const steps = Math.max(2, Math.round(len / step));
        let cx = x, cy = y, cz = z;
        for (let i = 0; i < steps; i++) {
          az += gauss(rng) * 0.32;
          cx += Math.cos(az) * step; cz += Math.sin(az) * step;
          cy += gauss(rng) * 16 + (ty - cy) * 0.1;
          cy = clampNum(cy, cloudBase + 120, rootY + 520);
          nodesP.push(cx, cy, cz);
        }
        const pts = [nodesP[0], nodesP[1], nodesP[2]];
        for (let i = 1; i < nodesP.length / 3; i++) {
          subdivide(rng, nodesP[3 * i - 3], nodesP[3 * i - 2], nodesP[3 * i - 1], nodesP[3 * i], nodesP[3 * i + 1], nodesP[3 * i + 2],
            2, 0.12, -1e9, pts, []);
        }
        const d = cumulative(pts);
        const n = pts.length / 3, Lc = d[n - 1];
        const t0 = -0.25 + rng() * 0.15, t1 = 0.35 + rng() * 0.5;
        const tls = new Float64Array(n), s = new Float64Array(n), w = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          tls[i] = t0 + (t1 - t0) * d[i] / Lc;
          s[i] = sStart + d[i] * 2.0;
          w[i] = wScale * (0.2 + 0.8 * Math.exp(-d[i] / 3000));
        }
        const flags = FLAG.CLOUD | FLAG.BRANCH;
        emit(pts, tls, s, w, 1.0, flags, mask, -1);
        chains.push({ pts, tls, s, w, flags, mask, level: 1, length: Lc, size: 0, upFrom: -1, width: 1.0 });
        if (allowSub) {
          const subs = 1 + Math.floor(rng() * 2);
          for (let k = 0; k < subs; k++) {
            const vi = 1 + Math.floor(rng() * (n - 2));
            growCloudChain(pts[3 * vi], pts[3 * vi + 1], pts[3 * vi + 2], s[vi],
              az + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.7), 300 + rng() * 600, w[vi] * 0.6, mask, rootY, false);
          }
        }
      }

      function addStreamers() {
        const count = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < count; k++) {
          const ang = rng() * 6.283185307179586, r = 25 + rng() * 110;
          let x = strike[0] + Math.cos(ang) * r, y = 0, z = strike[2] + Math.sin(ang) * r;
          const len = 12 + rng() * 55, segs = 3 + Math.floor(rng() * 3);
          const nodesP = [x, y, z];
          for (let i = 0; i < segs; i++) {
            const step = len / segs;
            let dx = gauss(rng) * 0.35, dy = 1, dz = gauss(rng) * 0.35;
            const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
            x += dx / l * step; y += dy / l * step; z += dz / l * step;
            nodesP.push(x, y, z);
          }
          const pts = [nodesP[0], nodesP[1], nodesP[2]];
          for (let i = 1; i < nodesP.length / 3; i++) {
            subdivide(rng, nodesP[3 * i - 3], nodesP[3 * i - 2], nodesP[3 * i - 1], nodesP[3 * i], nodesP[3 * i + 1], nodesP[3 * i + 2],
              2, 0.18, 0, pts, []);
          }
          const d = cumulative(pts);
          const n = pts.length / 3, Lc = d[n - 1];
          const dl = 0.003 + rng() * 0.008;
          const tls = new Float64Array(n), s = new Float64Array(n), w = new Float64Array(n);
          const wv = 0.07 + rng() * 0.05;
          for (let i = 0; i < n; i++) { tls[i] = 1 - dl + dl * d[i] / Lc; s[i] = NEVER; w[i] = wv; }
          emit(pts, tls, s, w, 0.5, FLAG.STREAMER, 0, -1);
        }
      }

      // Işık örnekleri
      const lights = [];
      function pushLight(x, y, z, s, tl, w, flags, mask) {
        if (lights.length / LIGHT_STRIDE >= MAX_LIGHTS) return;
        lights.push(x, y, z, s, tl, w, flags, mask);
      }
      function sampleChain(ch, frac, wOverride, flags) {
        const n = ch.pts.length / 3;
        const d = cumulative(ch.pts);
        const target = d[n - 1] * frac;
        let i = 0;
        while (i < n - 1 && d[i + 1] < target) i++;
        const i2 = Math.min(n - 1, i + 1);
        const u = d[i2] > d[i] ? (target - d[i]) / (d[i2] - d[i]) : 0;
        const L = (a, b) => a + (b - a) * u;
        pushLight(L(ch.pts[3 * i], ch.pts[3 * i2]), L(ch.pts[3 * i + 1], ch.pts[3 * i2 + 1]), L(ch.pts[3 * i + 2], ch.pts[3 * i2 + 2]),
          L(ch.s[i], ch.s[i2]), L(ch.tls[i], ch.tls[i2]), wOverride != null ? wOverride : L(ch.w[i], ch.w[i2]), flags, ch.mask);
      }
      const mainChain = chains[0];
      if (vertical) {
        const L = mainChain.length;
        const vis = Math.max(0.05, Math.min(0.98, cloudEntryS / L));
        // Zeminden ölçülen s kesirleri; zincir kökten zemine gittiği için kesir 1 - s/L.
        for (const f of [0.03, 0.2, 0.4, 0.6, 0.8, 0.97]) sampleChain(mainChain, 1 - vis * f, 1, FLAG.MAIN);
        for (const f of [0.35, 0.85]) sampleChain(mainChain, 1 - (vis + (1 - vis) * f), 1, FLAG.MAIN | FLAG.CLOUD);
        const cloudChains = chains.filter((ch) => ch.flags & FLAG.CLOUD).sort((a, b) => b.length - a.length).slice(0, 3);
        for (const ch of cloudChains) sampleChain(ch, 0.55, null, ch.flags);
        const branches = chains.filter((ch) => ch.flags === FLAG.BRANCH && ch.level === 1).sort((a, b) => b.length - a.length).slice(0, 3);
        for (const ch of branches) sampleChain(ch, 0.5, null, ch.flags);
      } else {
        const sorted = chains.slice().sort((a, b) => b.length - a.length);
        sampleChain(mainChain, 0.02, null, FLAG.MAIN);
        for (const f of [0.3, 0.65, 1]) sampleChain(mainChain, f, null, FLAG.MAIN);
        for (const ch of sorted) {
          if (ch === mainChain) continue;
          sampleChain(ch, 0.7, null, ch.flags);
          if (lights.length / LIGHT_STRIDE >= 12) break;
        }
      }

      // Akustik parçalar (~15 m)
      const acoustic = [];
      let totalLength = 0;
      for (const ch of chains) totalLength += ch.length;
      const target = Math.max(15, totalLength / 1600);
      for (const ch of chains) {
        const n = ch.pts.length / 3;
        const isMainF = (ch.flags & FLAG.MAIN) ? 1 : 0;
        const wScale = (ch.flags & FLAG.CLOUD) ? 0.6 : 1;
        let ax = ch.pts[0], ay = ch.pts[1], az = ch.pts[2], acc = 0, wAcc = 0, cntW = 0;
        for (let i = 1; i < n; i++) {
          const bx = ch.pts[3 * i], by = ch.pts[3 * i + 1], bz = ch.pts[3 * i + 2];
          const px0 = ch.pts[3 * i - 3], py0 = ch.pts[3 * i - 2], pz0 = ch.pts[3 * i - 1];
          acc += Math.sqrt((bx - px0) * (bx - px0) + (by - py0) * (by - py0) + (bz - pz0) * (bz - pz0));
          wAcc += ch.w[i]; cntW++;
          if (acc >= target || i === n - 1) {
            const dx = bx - ax, dy = by - ay, dz = bz - az;
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3;
            acoustic.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, dx / len, dy / len, dz / len, len,
              wScale * wAcc / cntW, isMainF);
            ax = bx; ay = by; az = bz; acc = 0; wAcc = 0; cntW = 0;
          }
        }
      }

      // Ana yol (zeminden köke)
      let mainPath;
      {
        const p = mainChain.pts, n = p.length / 3;
        mainPath = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const src = vertical ? n - 1 - i : i;
          mainPath[3 * i] = p[3 * src]; mainPath[3 * i + 1] = p[3 * src + 1]; mainPath[3 * i + 2] = p[3 * src + 2];
        }
      }

      const seg = Float32Array.from(out);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < seg.length; i += SEG_STRIDE) {
        for (const o of [0, 3]) for (let a = 0; a < 3; a++) {
          const v = seg[i + o + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }

      return {
        seg, segCount: seg.length / SEG_STRIDE, SEG_STRIDE,
        strike, origin, mainLength, cloudEntryS, junctionHeight: vertical ? hj : 0,
        mainPath,
        lights: Float32Array.from(lights), lightCount: lights.length / LIGHT_STRIDE,
        acoustic: Float32Array.from(acoustic),
        bounds: { min, max },
        stats: { steps: G.steps, nodes: N, branchCount, maxLevel, totalLength, mainLength, visibleLength: cloudEntryS },
      };
    }

    function generate(opts) {
      const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const t0 = now();
      const kind = KINDS[opts.kind] ? opts.kind : 'cg';
      const K = KINDS[kind];
      const T = Object.assign({}, TUNE, opts.tune || {});
      const rng = mulberry32((opts.seed >>> 0) || 1);
      const cloudBase = opts.cloudBase || 1400;
      const eta = clampNum((opts.eta || 3) + K.etaAdd, 1.0, 9);
      const NX = 2 * K.half + 1, NZ = NX;
      let NY, oy;
      if (K.bg === 'vertical') {
        const originAlt = cloudBase + K.above[0] + rng() * (K.above[1] - K.above[0]);
        oy = Math.round(originAlt / K.cell);
        NY = oy + 2;
      } else {
        NY = K.ny; oy = (K.ny - 1) >> 1;
      }
      const G = grow({ NX, NY, NZ, ox: K.half, oy, oz: K.half, bg: K.bg, radialMax: K.half - 2, eta,
        maxSteps: opts.maxSteps || K.maxSteps, tune: T, groundStop: 1, onProgress: opts.onProgress }, rng);
      const out = buildGeometry({ K, G, T, rng, cloudBase, oy });
      out.kind = kind;
      out.seed = opts.seed >>> 0;
      out.eta = eta;
      out.genMs = now() - t0;
      out.stats.genMs = out.genMs;
      return out;
    }

    return { generate, SEG_STRIDE, LIGHT_STRIDE, ACOUSTIC_STRIDE, MAX_LIGHTS, FLAG, KINDS, TUNE, NEVER };
  }

  const F = root.FIRTINA = root.FIRTINA || {};
  F.DBM = dbmModule();
  F.DBM_MODULE_SOURCE = dbmModule.toString();
})(typeof self !== 'undefined' ? self : globalThis);
