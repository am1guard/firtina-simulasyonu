/* Yıldırım Gözlemevi — kanal geometrisinden gök gürültüsü sentezi.
 *
 * Yıldırım kanalı ~15 m'lik akustik parçalara bölünür; her parça bir N-dalgası (şok sonrası basınç
 * imzası) yayar. Parçanın sesi dinleyiciye uzaklık / 343 m/s sonra ulaşır. Görüş hattına dik parçalar
 * dalga cephesini aynı anda gönderir: kısa ve güçlü "çatırtı". Görüş hattına paralel parçaların sesi
 * uzayarak zayıflar: gürleme. Atmosfer yüksek frekansları uzaklıkla soğurur; parçalar uzaklık
 * bantlarına ayrılır ve her bant kendi alçak geçiren süzgecinden geçer. Her dönüş darbesi ana kanaldan
 * yeniden ses üretir.
 *
 * Modül tek fonksiyonun içindedir; Web Worker kaynağı bu metinden kurulur. */
(function (root) {
  'use strict';

  function thunderModule() {
    'use strict';
    const C_SOUND = 343;
    const STRIDE = 9; // x, y, z, dx, dy, dz, len, weight, main
    const BANDS = [
      { maxR: 350, fc: 7000, passes: 1 },
      { maxR: 900, fc: 3200, passes: 1 },
      { maxR: 2000, fc: 1500, passes: 1 },
      { maxR: 4500, fc: 700, passes: 2 },
      { maxR: 9000, fc: 330, passes: 2 },
      { maxR: Infinity, fc: 170, passes: 2 },
    ];

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

    // N-dalgası: başta ani +a sıçraması, doğrusal olarak -a'ya iner.
    function addNWave(buf, s0, T, a) {
      const i0 = Math.floor(s0), frac = s0 - i0;
      const len = Math.max(2, Math.round(T));
      const end = Math.min(buf.length - 1, i0 + len);
      for (let idx = Math.max(0, i0); idx <= end; idx++) {
        const x = (idx - i0 - frac) / len;
        if (x < 0 || x > 1) continue;
        buf[idx] += a * (1 - 2 * x);
      }
    }

    // RBJ biquad alçak geçiren (Q = 0,707), yerinde.
    function lowpass(buf, fc, sr) {
      const w0 = 2 * Math.PI * Math.min(fc, 0.42 * sr) / sr;
      const cs = Math.cos(w0), alpha = Math.sin(w0) / (2 * 0.7071);
      const a0 = 1 + alpha;
      const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, b2 = (1 - cs) / 2 / a0;
      const a1 = -2 * cs / a0, a2 = (1 - alpha) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        buf[i] = y;
      }
    }

    // Tek kutuplu DC engelleyici (~25 Hz).
    function dcBlock(buf, sr) {
      const R = Math.exp(-2 * Math.PI * 25 / sr);
      let x1 = 0, y1 = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        const y = x - x1 + R * y1;
        x1 = x; y1 = y;
        buf[i] = y;
      }
    }

    // o = { acoustic, strokes:[{t, amp}], listener:[x,y,z], sampleRate, seed }
    // Dönüş: { data, sampleRate, delay (ilk darbeden ilk varışa sn), duration, gain, energy }
    function synth(o) {
      const A = o.acoustic || new Float32Array(0);
      const n = (A.length / STRIDE) | 0;
      const sr = o.sampleRate || 24000;
      const Lx = o.listener[0], Ly = o.listener[1], Lz = o.listener[2];
      const strokes = (o.strokes && o.strokes.length) ? o.strokes : [{ t: 0, amp: 1 }];
      if (n === 0) return { data: new Float32Array(0), sampleRate: sr, delay: 0, duration: 0, gain: 0, energy: 0 };
      const rng = mulberry32((o.seed >>> 0) || 1);

      const R = new Float64Array(n);
      let rMin = Infinity, rMax = 0;
      for (let j = 0; j < n; j++) {
        const b = j * STRIDE;
        const r = Math.hypot(A[b] - Lx, A[b + 1] - Ly, A[b + 2] - Lz);
        R[j] = r;
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
      }
      const t0 = strokes[0].t;
      let lastStroke = 0;
      for (const s of strokes) lastStroke = Math.max(lastStroke, s.t - t0);
      const duration = (rMax - rMin) / C_SOUND + lastStroke + 0.6;
      const N = Math.ceil(duration * sr);
      const out = new Float32Array(N);
      const band = new Float32Array(N);

      for (let bi = 0; bi < BANDS.length; bi++) {
        const lo = bi === 0 ? 0 : BANDS[bi - 1].maxR, hi = BANDS[bi].maxR;
        let any = false;
        band.fill(0);
        for (let j = 0; j < n; j++) {
          const r = R[j];
          if (r < lo || r >= hi) continue;
          any = true;
          const b = j * STRIDE;
          const inv = 1 / Math.max(r, 1e-3);
          const vx = (A[b] - Lx) * inv, vy = (A[b + 1] - Ly) * inv, vz = (A[b + 2] - Lz) * inv;
          const cos = Math.abs(A[b + 3] * vx + A[b + 4] * vy + A[b + 5] * vz);
          const len = A[b + 6], w = A[b + 7], main = A[b + 8] > 0.5;
          const TN = 0.0025 + 0.0012 * Math.log10(1 + r / 50);
          const dGeo = len * cos / C_SOUND;
          const tau = Math.sqrt(TN * TN + dGeo * dGeo);
          const amp = w * Math.sqrt(len / 15) * (TN / tau) / Math.max(r, 30);
          const sub = dGeo > 0.004 ? 2 : 1;
          for (let k = 0; k < strokes.length; k++) {
            if (k > 0 && !main) continue;
            const sa = Math.pow(Math.max(0, strokes[k].amp), 0.7);
            const baseT = (r - rMin) / C_SOUND + (strokes[k].t - t0);
            for (let q = 0; q < sub; q++) {
              const tq = baseT + (sub > 1 ? rng() * dGeo : 0) + (rng() - 0.5) * 0.001;
              const aq = amp * sa * (0.6 + 0.8 * rng()) / sub;
              addNWave(band, Math.max(0, tq) * sr, (sub > 1 ? TN : tau) * sr, aq);
            }
          }
        }
        if (!any) continue;
        for (let p = 0; p < BANDS[bi].passes; p++) lowpass(band, BANDS[bi].fc, sr);
        for (let i = 0; i < N; i++) out[i] += band[i];
      }
      dcBlock(out, sr);

      let peak = 0, energy = 0;
      for (let i = 0; i < N; i++) { const v = out[i]; energy += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
      energy /= sr;
      if (peak > 0) { const k = 1 / peak; for (let i = 0; i < N; i++) out[i] *= k; }
      const gain = Math.min(1, Math.max(0.02, Math.pow(700 / rMin, 0.85)));
      return { data: out, sampleRate: sr, delay: rMin / C_SOUND, duration: N / sr, gain, energy };
    }

    return { synth, C_SOUND, STRIDE };
  }

  const F = root.FIRTINA = root.FIRTINA || {};
  F.Thunder = thunderModule();
  F.THUNDER_MODULE_SOURCE = thunderModule.toString();
})(typeof self !== 'undefined' ? self : globalThis);
