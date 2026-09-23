/* Yıldırım Gözlemevi — fırtına denetleyicisi.
 * Olayları (bulut-yer, pozitif, örümcek, bulut içi) zamanlar; DBM ve gök gürültüsü sentezini Web Worker'a
 * yaptırır; her kare ışık kaynaklarını (en parlak 16) ve gök parlamasını hesaplar; arayüze evre, istatistik
 * ve gök gürültüsü olaylarını bildirir. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};
  const M = F.math, Lum = F.Lum, T = F.Terrain;

  const I_REF = 2.5e6;
  const COL_HOT = [0.86, 0.84, 1.0], COL_LEADER = [0.55, 0.48, 1.0], COL_CC = [1.0, 0.6, 0.5];
  const GAIN = { cg: 150, cgp: 190, spider: 70 };
  const LIGHT_SCALE = { cg: 1.0, cgp: 1.35, spider: 0.55, ic: 3.0 };
  const QUEUE_TARGET = { cg: 2, cgp: 1, spider: 1 };
  const MAX_EVENTS = 6;
  const KIND_LABEL = { cg: 'Negatif bulut-yer', cgp: 'Pozitif bulut-yer', spider: 'Örümcek (yatay)', ic: 'Bulut içi' };

  function makeWorker() {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
    const src = `'use strict';
const DBM = (${F.DBM_MODULE_SOURCE})();
const THUNDER = (${F.THUNDER_MODULE_SOURCE})();
self.onmessage = function (e) {
  const m = e.data;
  try {
    if (m.type === 'bolt') {
      const b = DBM.generate(m.opts);
      self.postMessage({ type: 'bolt', id: m.id, bolt: b }, [b.seg.buffer, b.lights.buffer, b.acoustic.buffer, b.mainPath.buffer]);
    } else if (m.type === 'thunder') {
      const r = THUNDER.synth(m.opts);
      self.postMessage({ type: 'thunder', id: m.id, result: r }, [r.data.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};`;
    try {
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      return new Worker(url);
    } catch (e) {
      return null;
    }
  }

  class Storm {
    constructor(o) {
      this.renderer = o.renderer;
      this.audio = o.audio;
      this.onEvent = o.onEvent || function () {};
      this.params = { eta: 1.7, mode: 'karisik', rate: 7, rain: 0.65, soft: false, auto: true };
      this.rng = M.mulberry32(o.seed != null ? o.seed : ((Date.now() ^ 0x5bd1e995) >>> 0));
      this.events = [];
      this.ready = { cg: [], cgp: [], spider: [] };
      this.inflight = { cg: 0, cgp: 0, spider: 0 };
      this.waiting = [];          // hazır yıldırım bekleyen çakışlar
      this.delayed = [];          // ileri tarihli çakışlar (örümcek sonrası pozitif)
      this.thunderJobs = new Map();
      this.jobId = 1;
      this.eventId = 1;
      this.generation = 0;        // η değişince eski işler geçersiz olur
      this.autoTimer = 1.5;
      this.lastReplay = null;
      this.focus = null;          // arayüzün izlediği son olay
      this.phaseKey = '';
      this.cloudOffset = [0, 0];
      this.wind = [2.4, -1.1];
      this.lights = { pos: new Float32Array(64), col: new Float32Array(64), n: 0, nCloud: 0 };
      this.flashSky = [0, 0, 0];
      this.flashLevel = 0;
      this._cand = [];
      this._out = { hot: 0, leader: 0, cc: 0 };
      this.worker = o.noWorker ? null : makeWorker();
      if (this.worker) {
        this.worker.onmessage = (e) => this.onWorker(e.data);
        this.worker.onerror = () => { this.worker = null; this.fillQueues(); };
      }
      this.simT = 0; this.wallT = 0; this.timeScale = 1;
      this.fillQueues();
    }

    // ---------- Worker ----------
    requestBolt(kind) {
      const id = this.jobId++;
      const opts = { kind, seed: (this.rng() * 4294967295) >>> 0, eta: this.params.eta, cloudBase: T.CLOUD_BASE };
      const gen = this.generation;
      this.inflight[kind]++;
      if (this.worker) {
        this.worker.postMessage({ type: 'bolt', id, opts });
        this.thunderJobs.set(id, { kind: 'bolt', boltKind: kind, gen });
      } else {
        setTimeout(() => {
          const bolt = F.DBM.generate(opts);
          this.receiveBolt(kind, bolt, gen);
        }, 0);
      }
    }

    onWorker(m) {
      const job = this.thunderJobs.get(m.id);
      if (!job) return;
      this.thunderJobs.delete(m.id);
      if (m.type === 'bolt') this.receiveBolt(job.boltKind, m.bolt, job.gen);
      else if (m.type === 'thunder') this.receiveThunder(job, m.result);
      else if (m.type === 'error') {
        if (job.kind === 'bolt') this.inflight[job.boltKind] = Math.max(0, this.inflight[job.boltKind] - 1);
        this.onEvent('error', { message: m.message });
      }
    }

    receiveBolt(kind, bolt, gen) {
      this.inflight[kind] = Math.max(0, this.inflight[kind] - 1);
      if (gen !== this.generation) { this.fillQueues(); return; }
      const wi = this.waiting.findIndex((w) => w.kind === kind);
      if (wi >= 0) {
        const w = this.waiting.splice(wi, 1)[0];
        this.startBolt(kind, bolt, w.target, w.opts);
      } else {
        this.ready[kind].push(bolt);
      }
      this.fillQueues();
    }

    fillQueues() {
      for (const kind of Object.keys(QUEUE_TARGET)) {
        const need = QUEUE_TARGET[kind] + this.waiting.filter((w) => w.kind === kind).length;
        while (this.ready[kind].length + this.inflight[kind] < need) this.requestBolt(kind);
      }
    }

    requestThunder(ev, acoustic, listener, strokes, pan, arrivalBase) {
      if (!this.audio || !this.audio.ok) return;
      const opts = { acoustic, strokes, listener, sampleRate: 22050, seed: (this.rng() * 1e9) >>> 0 };
      const job = { kind: 'thunder', ev, pan, arrivalBase };
      if (this.worker) {
        const id = this.jobId++;
        this.thunderJobs.set(id, job);
        this.worker.postMessage({ type: 'thunder', id, opts });
      } else {
        setTimeout(() => this.receiveThunder(job, F.Thunder.synth(opts)), 0);
      }
    }

    receiveThunder(job, res) {
      if (!this.audio || !this.audio.ok || !res || !res.data.length) return;
      const delay = job.arrivalBase + res.delay - this.wallT;
      if (delay < -0.5) return;
      this.audio.playThunder(res, delay, job.pan);
    }

    // ---------- Parametreler ----------
    setParam(k, v) {
      if (this.params[k] === v) return;
      this.params[k] = v;
      if (k === 'eta') {
        this.generation++;
        for (const kind of Object.keys(this.ready)) this.ready[kind] = [];
        for (const kind of Object.keys(this.inflight)) this.inflight[kind] = 0;
        for (const [id, job] of this.thunderJobs) if (job.kind === 'bolt') this.thunderJobs.delete(id);
        this.fillQueues();
      }
      if (k === 'rain' && this.audio) this.audio.setRain(v);
    }

    // ---------- Çakış başlatma ----------
    resolveKind(requested) {
      const k = requested || this.params.mode;
      if (k === 'karisik') return 'cg';
      return k;
    }

    // target: { point, surface, dist } (Terrain.pickTarget / targetAt). kind: 'cg' | 'cgp' | 'spider' | 'ic'
    strike(target, kind, opts) {
      const k = this.resolveKind(kind);
      if (k === 'ic') { this.startIC(target, opts); return true; }
      if (this.ready[k] && this.ready[k].length) {
        this.startBolt(k, this.ready[k].shift(), target, opts);
        this.fillQueues();
        return true;
      }
      if (this.waiting.length >= 4) return false;
      this.waiting.push({ kind: k, target, opts });
      this.fillQueues();
      return true;
    }

    randomTarget(minD, maxD) {
      const az = (this.rng() - 0.5) * 1.75;
      const d = Math.exp(M.lerp(Math.log(minD), Math.log(maxD), this.rng()));
      const cam = T.CAMERA_POS;
      return T.targetAt(cam[0] + Math.sin(az) * d, cam[2] - Math.cos(az) * d);
    }

    spawnAuto() {
      let kind = this.params.mode;
      if (kind === 'karisik') {
        const r = this.rng();
        kind = r < 0.48 ? 'ic' : r < 0.82 ? 'cg' : r < 0.91 ? 'spider' : 'cgp';
      }
      const target = kind === 'cgp' ? this.randomTarget(4500, 12500) : kind === 'ic' ? this.randomTarget(2500, 16000)
        : kind === 'spider' ? this.randomTarget(1400, 3200) : this.randomTarget(1800, 11000);
      this.strike(target, kind, { auto: true });
    }

    pushEvent(ev) {
      this.events.push(ev);
      while (this.events.length > MAX_EVENTS) this.expire(this.events.shift());
    }

    startBolt(kind, bolt, target, opts) {
      const o = opts || {};
      const seed = (this.rng() * 4294967295) >>> 0;
      const tl = Lum.makeTimeline(kind, M.mulberry32(seed), { mainLength: bolt.mainLength });
      let offset;
      if (kind === 'spider') offset = [target.point[0] - bolt.origin[0], 0, target.point[2] - bolt.origin[2]];
      else offset = [target.point[0] - bolt.strike[0], target.point[1], target.point[2] - bolt.strike[2]];
      const boltKey = 'b' + (this.eventId);
      this.renderer.addBolt(boltKey, bolt);
      const ev = {
        id: this.eventId++, kind, bolt, boltKey, tl, offset, target, tStart: this.simT,
        lights: bolt.lights, gain: GAIN[kind], replay: false, auto: !!o.auto,
      };
      ev.stats = this.makeStats(ev);
      this.pushEvent(ev);
      this.focus = ev;
      if (this.lastReplay && this.lastReplay.boltKey !== boltKey && !this.events.some((e) => e.boltKey === this.lastReplay.boltKey)) {
        this.renderer.removeBolt(this.lastReplay.boltKey);
      }
      this.lastReplay = ev;
      this.onEvent('strike', ev.stats);
      this.scheduleThunder(ev);
      if (kind === 'spider' && this.rng() < 0.5) {
        // Örümcek yıldırım çoğu zaman bir pozitif bulut-yer ile biter.
        const L = bolt.lights, n = bolt.lightCount;
        const i = Math.max(0, n - 1 - Math.floor(this.rng() * Math.min(4, n)));
        let x = L[i * 8] + offset[0], z = L[i * 8 + 2] + offset[2];
        const cam = T.CAMERA_POS, d = Math.hypot(x - cam[0], z - cam[2]);
        if (d < 1500) { const k = 1500 / Math.max(d, 1); x = cam[0] + (x - cam[0]) * k; z = cam[2] + (z - cam[2]) * k; }
        this.delayed.push({ at: this.simT + tl.leaderDur * M.lerp(0.55, 0.9, this.rng()), kind: 'cgp', target: T.targetAt(x, z) });
      }
    }

    startIC(target, opts) {
      const seed = (this.rng() * 4294967295) >>> 0;
      const rng = M.mulberry32(seed);
      const tl = Lum.makeTimeline('ic', rng);
      const c = [target.point[0], T.CLOUD_BASE + M.lerp(250, 1500, rng()), target.point[2]];
      const n = 3 + Math.floor(rng() * 4);
      const lights = new Float32Array(n * 8);
      for (let i = 0; i < n; i++) {
        lights.set([c[0] + M.gauss(rng) * 1300, Math.max(T.CLOUD_BASE + 120, c[1] + M.gauss(rng) * 250), c[2] + M.gauss(rng) * 1300, 0, 0,
          M.lerp(0.5, 1, rng()), Lum.FLAG.CLOUD, 1 | (Math.floor(rng() * 256) & 0xfe)], i * 8);
      }
      const ev = { id: this.eventId++, kind: 'ic', tl, offset: [0, 0, 0], target, tStart: this.simT, lights, replay: false, auto: !!(opts && opts.auto) };
      ev.stats = this.makeStats(ev);
      this.pushEvent(ev);
      if (!(opts && opts.auto) || !this.focus || this.simT - this.focus.tStart > 1.2) this.focus = ev;
      this.onEvent('strike', ev.stats);
      // Sahte akustik: bulut içinde yatay kanallar
      const ac = [];
      for (let k = 0; k < 3; k++) {
        let x = c[0], y = c[1], z = c[2], az = rng() * 6.283;
        const len = M.lerp(1200, 3500, rng());
        for (let d = 0; d < len; d += 20) {
          az += M.gauss(rng) * 0.08;
          const dx = Math.cos(az), dz = Math.sin(az);
          ac.push(x + dx * 10, y, z + dz * 10, dx, 0, dz, 20, 0.45, 0);
          x += dx * 20; z += dz * 20; y += M.gauss(rng) * 4;
        }
      }
      ev.acoustic = Float32Array.from(ac);
      this.scheduleThunder(ev);
    }

    makeStats(ev) {
      const tl = ev.tl, cam = T.CAMERA_POS;
      const p = ev.target.point;
      const dist = Math.hypot(p[0] - cam[0], p[2] - cam[2]);
      const s = {
        id: ev.id, kind: ev.kind, kindLabel: KIND_LABEL[ev.kind], surface: ev.target.surface,
        distanceKm: dist / 1000, strokes: tl.strokes.length, tStartWall: this.wallT,
        thunderDelay: this.estimateThunderDelay(ev),
      };
      if (ev.bolt) {
        const L = ev.bolt.mainLength;
        s.peakKA = tl.peakKA.length ? tl.peakKA[0] : null;
        s.mainKm = L / 1000;
        s.branches = ev.bolt.stats.branchCount;
        s.leaderMs = tl.leaderDur * 1000;
        let e = 0;
        for (const ka of tl.peakKA) e += 1e5 * L * (ka / 30);
        s.energyGJ = e / 1e9;
        s.tempK = Math.round(M.lerp(27000, 31500, this.rng()) / 500) * 500;
      }
      if (ev.kind === 'spider') { s.strokes = 0; s.surface = 'bulut tabanı'; }
      if (ev.kind === 'ic') s.surface = 'bulut';
      return s;
    }

    estimateThunderDelay(ev) {
      const cam = T.CAMERA_POS;
      let best = Infinity;
      const A = ev.bolt ? ev.bolt.acoustic : null;
      if (A) {
        for (let i = 0; i < A.length; i += 9) {
          const d = Math.hypot(A[i] + ev.offset[0] - cam[0], A[i + 1] + ev.offset[1] - cam[1], A[i + 2] + ev.offset[2] - cam[2]);
          if (d < best) best = d;
        }
      } else {
        best = Math.hypot(ev.target.point[0] - cam[0], T.CLOUD_BASE + 400 - cam[1], ev.target.point[2] - cam[2]);
      }
      return best / 343;
    }

    scheduleThunder(ev) {
      if (ev.replay) return;
      const first = ev.tl.strokes.length ? ev.tl.strokes[0].t : 0;
      const arrivalBase = this.wallT + first / Math.max(this.timeScale, 1e-6);
      if (this.timeScale < 0.999) return; // yavaş çekimde gök gürültüsü çalınmaz
      const cam = T.CAMERA_POS;
      const listener = [cam[0] - ev.offset[0], cam[1] - ev.offset[1], cam[2] - ev.offset[2]];
      const acoustic = ev.bolt ? ev.bolt.acoustic.slice() : ev.acoustic;
      // Stereo konum: hedef yönünün kameranın sağ vektörüne izdüşümü
      const fwd = this.renderer.cameraForward();
      const fl = Math.hypot(fwd[0], fwd[2]) || 1;
      const rightX = -fwd[2] / fl, rightZ = fwd[0] / fl;
      const p = ev.target.point;
      const dx = p[0] - cam[0], dz = p[2] - cam[2], l = Math.hypot(dx, dz) || 1;
      const pan = (dx * rightX + dz * rightZ) / l;
      const strokes = ev.tl.strokes.map((s) => ({ t: s.t, amp: s.amp }));
      this.onEvent('thunder', { id: ev.id, arrivalWall: arrivalBase + ev.stats.thunderDelay, kind: ev.kind });
      this.requestThunder(ev, acoustic, listener, strokes, M.clamp(pan, -1, 1), arrivalBase);
    }

    // Son yıldırımı yavaş çekimde yeniden oynatır (zaman ölçeği arayüzde ayarlanır).
    replay() {
      const last = this.lastReplay;
      if (!last) return false;
      this.events = this.events.filter((e) => e.boltKey !== last.boltKey);
      const ev = Object.assign({}, last, { id: this.eventId++, tStart: this.simT + 0.002 * this.timeScale, replay: true });
      ev.stats = Object.assign({}, last.stats, { id: ev.id, replay: true });
      this.events.push(ev);
      this.focus = ev;
      this.onEvent('replay', ev.stats);
      return true;
    }

    expire(ev) {
      if (ev.boltKey && ev !== this.lastReplay && ev.boltKey !== (this.lastReplay && this.lastReplay.boltKey)
        && !this.events.some((e) => e !== ev && e.boltKey === ev.boltKey)) {
        this.renderer.removeBolt(ev.boltKey);
      }
    }

    // ---------- Kare güncellemesi ----------
    update(simT, wallT, dtSim, dtWall, timeScale) {
      this.simT = simT; this.wallT = wallT; this.timeScale = timeScale;
      this.cloudOffset[0] += this.wind[0] * 1.8 * dtSim;
      this.cloudOffset[1] += this.wind[1] * 1.8 * dtSim;
      if (this.params.auto && this.params.rate > 0) {
        this.autoTimer -= dtSim;
        if (this.autoTimer <= 0) {
          this.spawnAuto();
          const rate = this.params.soft ? Math.min(this.params.rate, 10) : this.params.rate;
          const mean = 60 / rate;
          this.autoTimer = Math.max(this.params.soft ? 3 : 0.4, -Math.log(1 - this.rng()) * mean);
        }
      }
      for (let i = this.delayed.length - 1; i >= 0; i--) {
        if (simT >= this.delayed[i].at) { const d = this.delayed.splice(i, 1)[0]; this.strike(d.target, d.kind, { auto: true }); }
      }
      const keep = [];
      for (const ev of this.events) {
        if (simT - ev.tStart < ev.tl.end + 0.6) keep.push(ev); else this.expire(ev);
      }
      this.events = keep;
      this.collectLights(simT, timeScale);
      this.updatePhase(simT);
    }

    collectLights(simT, ts) {
      const cand = this._cand;
      cand.length = 0;
      const out = this._out, soft = this.params.soft;
      for (const ev of this.events) {
        const t = simT - ev.tStart;
        if (t < 0) continue;
        const L = ev.lights, n = L.length / 8;
        const g = I_REF * LIGHT_SCALE[ev.kind];
        for (let i = 0; i < n; i++) {
          const o = i * 8;
          Lum.vertex(ev.tl, L[o + 4], L[o + 3], L[o + 5], L[o + 6], L[o + 7], t, ts, out, soft);
          const r = g * (out.hot * COL_HOT[0] + out.leader * COL_LEADER[0] + out.cc * COL_CC[0]);
          const gg = g * (out.hot * COL_HOT[1] + out.leader * COL_LEADER[1] + out.cc * COL_CC[1]);
          const b = g * (out.hot * COL_HOT[2] + out.leader * COL_LEADER[2] + out.cc * COL_CC[2]);
          const I = r + gg + b;
          if (!(I > 2e3)) continue;
          const y = L[o + 1] + ev.offset[1];
          const inCloud = (L[o + 6] & Lum.FLAG.CLOUD) || y > T.CLOUD_BASE + 80 ? 1 : 0;
          cand.push({ x: L[o] + ev.offset[0], y, z: L[o + 2] + ev.offset[2], r, g: gg, b, I, inCloud });
        }
      }
      cand.sort((a, b) => b.I - a.I);
      const n = Math.min(16, cand.length);
      const P = this.lights.pos, C = this.lights.col;
      P.fill(0); C.fill(0);
      const cam = T.CAMERA_POS;
      let sr = 0, sg = 0, sb = 0, total = 0;
      for (let i = 0; i < n; i++) {
        const c = cand[i];
        P[i * 4] = c.x; P[i * 4 + 1] = c.y; P[i * 4 + 2] = c.z; P[i * 4 + 3] = c.inCloud ? 380 : 120;
        C[i * 4] = c.r; C[i * 4 + 1] = c.g; C[i * 4 + 2] = c.b; C[i * 4 + 3] = c.inCloud;
        const dh2 = (c.x - cam[0]) ** 2 + (c.z - cam[2]) ** 2;
        const k = 0.18 / (dh2 + 9e6) * (c.inCloud ? 1.3 : 1);
        sr += c.r * k; sg += c.g * k; sb += c.b * k;
        total += c.I;
      }
      this.lights.n = n;
      this.lights.nCloud = Math.min(n, 10);
      this.flashSky[0] = sr; this.flashSky[1] = sg; this.flashSky[2] = sb;
      this.flashLevel = total / I_REF;
      // Yakınlık ağırlıklı parlama düzeyi (pozlama uyumu için): yakın ışıklar daha çok etkiler
      let near = 0;
      for (let i = 0; i < n; i++) {
        const c = cand[i];
        const d2 = (c.x - cam[0]) ** 2 + (c.y - cam[1]) ** 2 + (c.z - cam[2]) ** 2;
        near += c.I / (d2 + 4e6);
      }
      this.nearFlash = near;
    }

    // Arayüzde gösterilen evre
    phaseOf(ev, t) {
      if (!ev) return { key: 'sakin', label: 'Sakin' };
      const tl = ev.tl;
      if (t < 0) return { key: 'sakin', label: 'Sakin' };
      if (ev.kind === 'ic') return t < tl.end - 0.8 ? { key: 'ic', label: 'Bulut içi boşalma' } : { key: 'sakin', label: 'Sakin' };
      if (ev.kind === 'spider') {
        if (t < tl.leaderDur) return { key: 'leader', label: 'Yatay öncü yayılıyor' };
        if (t < tl.glowEnd) return { key: 'rs', label: 'Örümcek ışıması' };
        return t < tl.end - 0.6 ? { key: 'cool', label: 'Kanal soğuyor' } : { key: 'sakin', label: 'Sakin' };
      }
      const S = tl.strokes, n = S.length;
      if (t < tl.leaderDur * 0.985) return { key: 'leader', label: 'Basamaklı öncü' };
      if (t < S[0].t) return { key: 'attach', label: 'Yukarı bağlantı öncüsü' };
      for (let k = n - 1; k >= 0; k--) {
        const st = S[k];
        if (t >= st.t) {
          if (t < st.t + 0.004) return { key: 'rs', label: `Dönüş darbesi ${k + 1}/${n}` };
          if (st.cc > 0 && t < st.t + st.cc) return { key: 'cc', label: 'Sürekli akım' };
          if (k + 1 < n) {
            const next = S[k + 1];
            if (t >= next.t - tl.mainLength / tl.vDart) return { key: 'dart', label: `Ok öncü ${k + 2}/${n}` };
            return { key: 'cool', label: 'Darbe arası' };
          }
          return t < st.t + st.cc + 0.35 ? { key: 'cool', label: 'Kanal soğuyor' } : { key: 'sakin', label: 'Sakin' };
        }
      }
      return { key: 'sakin', label: 'Sakin' };
    }

    updatePhase(simT) {
      const ev = this.focus;
      const t = ev ? simT - ev.tStart : -1;
      // Kare arasında kalan kısa evreler (dönüş darbesi ~4 ms) atlanmasın: bu karede geçilen son darbe bildirilir.
      if (ev && (ev.kind === 'cg' || ev.kind === 'cgp')) {
        const prev = this.phaseEv === ev ? this.phaseT : -1;
        const S = ev.tl.strokes;
        for (let k = S.length - 1; k >= 0; k--) {
          if (S[k].t > prev && S[k].t <= t) {
            const label = `Dönüş darbesi ${k + 1}/${S.length}`;
            if (label !== this.phaseKey) { this.phaseKey = label; this.onEvent('phase', { key: 'rs', label }); }
            break;
          }
        }
      }
      this.phaseEv = ev; this.phaseT = t;
      const ph = this.phaseOf(ev, t);
      if (ph.label !== this.phaseKey) {
        this.phaseKey = ph.label;
        this.onEvent('phase', ph);
      }
    }

    // Işık eğrisi: odak olayın fiziksel parlaklığı (kalıcılık yok), [t0, t1] aralığında n örnek.
    lightCurve(ev, t0, t1, n) {
      const out = this._out, v = new Float32Array(n);
      if (!ev) return v;
      const L = ev.lights, m = L.length / 8, tl = ev.tl;
      const fronts = tl.strokes.map((s) => s.t);
      for (let i = 0; i < n; i++) {
        const ta = t0 + (t1 - t0) * i / n, tb = t0 + (t1 - t0) * (i + 1) / n;
        let best = 0;
        const probes = [ta, (ta + tb) / 2];
        for (const f of fronts) if (f >= ta && f < tb) probes.push(f + 2e-6, f + 1.5e-5, f + 3.5e-5);
        for (const t of probes) {
          let sum = 0;
          for (let j = 0; j < m; j++) {
            const o = j * 8;
            if (ev.kind !== 'ic' && ev.kind !== 'spider' && !(L[o + 6] & Lum.FLAG.MAIN)) continue;
            Lum.vertex(tl, L[o + 4], L[o + 3], L[o + 5], L[o + 6], L[o + 7], t, 1e-9, out, false);
            sum += out.hot + out.leader + out.cc;
          }
          if (sum > best) best = sum;
        }
        v[i] = best;
      }
      return v;
    }

    // Renderer için kare durumu
    frame(dtWall, exposure) {
      const bolts = [];
      for (const ev of this.events) {
        if (!ev.bolt) continue;
        bolts.push({ id: ev.boltKey, offset: ev.offset, t: this.simT - ev.tStart, timeline: ev.tl, gain: ev.gain });
      }
      const rain = this.params.rain;
      // Pozlama uyumu: yakın ve güçlü flaşta ~25 ms'de kısılır, ~0,6 sn'de geri döner (göz bebeği/kamera).
      const target = 1 / (1 + 0.9 * Math.sqrt(this.nearFlash || 0));
      const tau = target < (this.adapt || 1) ? 0.025 : 0.6;
      this.adapt = (this.adapt || 1) + (target - (this.adapt || 1)) * (1 - Math.exp(-(dtWall || 0.016) / tau));
      const ph = (this.simT % 2) / 2;
      const towerLamp = M.smoothstep(0.0, 0.04, ph) * (1 - M.smoothstep(0.46, 0.5, ph));
      return {
        simT: this.simT, wallT: this.wallT, timeScale: this.timeScale, dtWall,
        rain, wind: this.wind, cloudOffset: this.cloudOffset,
        sigmaE: 1.1e-4 + rain * 2.4e-4, sigmaS: 0.35e-4 + rain * 0.8e-4,
        cloudBase: T.CLOUD_BASE,
        lights: this.lights, flashSky: this.flashSky,
        exposure: (exposure != null ? exposure : 2.4) * this.adapt,
        soft: this.params.soft, towerLamp, bolts,
      };
    }
  }

  Storm.KIND_LABEL = KIND_LABEL;
  F.Storm = Storm;
})(typeof self !== 'undefined' ? self : globalThis);
