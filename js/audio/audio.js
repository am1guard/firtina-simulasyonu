/* Yıldırım Gözlemevi — Web Audio motoru: gök gürültüsü çalma (kuru + yankı), yağmur ambiyansı ve damlalar.
 * Tarayıcı kuralı gereği ses yalnızca bir kullanıcı etkileşiminden sonra başlatılır (init). */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};

  function noiseBuffer(ctx, seconds, color) {
    const n = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    // Döngü dikişini yumuşat
    const fade = Math.min(2048, n >> 3);
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] *= k; d[n - 1 - i] *= k; }
    return buf;
  }

  // Göl, tepeler ve bulut tabanından yansımaları taklit eden sentetik darbe yanıtı.
  function impulseResponse(ctx, seconds) {
    const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(2, n, sr);
    const echoes = [[0.32, 0.5], [0.78, 0.36], [1.35, 0.26], [2.05, 0.16], [2.9, 0.1]];
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const k = 0.35 + 0.6 * Math.min(1, t / seconds); // kuyruk giderek koyulaşır
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        let v = lp * Math.exp(-t / 1.25) * (1 - Math.exp(-t / 0.03));
        for (const [te, a] of echoes) {
          const dt = t - te - ch * 0.013;
          if (dt > 0 && dt < 0.25) v += a * lp * Math.exp(-dt / 0.06);
        }
        d[i] = v;
      }
    }
    return buf;
  }

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.ok = false;
      this.volume = 0.8;
      this.muted = false;
      this.rain = 0.6;
      this.paused = false;
      this.sources = new Set();
      this.dripAcc = 0;
    }

    // Kullanıcı etkileşimi içinde çağrılmalıdır. Başarıda true döner.
    init() {
      if (this.ctx) { this.resume(); return this.ok; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = null; return false; }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5;
      comp.attack.value = 0.003; comp.release.value = 0.35;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      this.thunderBus = ctx.createGain();
      const dry = ctx.createGain(); dry.gain.value = 0.85;
      const reverb = ctx.createConvolver(); reverb.buffer = impulseResponse(ctx, 4.2);
      const wet = ctx.createGain(); wet.gain.value = 0.5;
      this.thunderBus.connect(dry); dry.connect(this.master);
      this.thunderBus.connect(reverb); reverb.connect(wet); wet.connect(this.master);

      // Yağmur: pembe gürültü (hışırtı) + kahverengi gürültü (uzak uğultu)
      this.rainBus = ctx.createGain();
      this.rainBus.connect(this.master);
      const hissSrc = ctx.createBufferSource(); hissSrc.buffer = noiseBuffer(ctx, 3.1, 'pink'); hissSrc.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7500;
      this.hiss = ctx.createGain();
      hissSrc.connect(hp); hp.connect(lp); lp.connect(this.hiss); this.hiss.connect(this.rainBus);
      const roarSrc = ctx.createBufferSource(); roarSrc.buffer = noiseBuffer(ctx, 4.3, 'brown'); roarSrc.loop = true;
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 380;
      this.roar = ctx.createGain();
      roarSrc.connect(lp2); lp2.connect(this.roar); this.roar.connect(this.rainBus);
      hissSrc.start(); roarSrc.start();

      // Damla sesi: kısa, süzülmüş gürültü patlaması
      this.dripBuf = (function () {
        const n = Math.floor(0.03 * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
        return b;
      })();
      this.dripFilter = ctx.createBiquadFilter(); this.dripFilter.type = 'bandpass';
      this.dripFilter.frequency.value = 2600; this.dripFilter.Q.value = 1.4;
      this.dripFilter.connect(this.rainBus);

      this.ok = true;
      this.setRain(this.rain);
      this.resume();
      return true;
    }

    resume() {
      if (this.ctx && !this.paused && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }

    setPaused(p) {
      this.paused = p;
      if (!this.ctx) return;
      if (p) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
    }

    setVolume(v) { this.volume = v; this.applyGain(); }
    setMuted(m) { this.muted = m; this.applyGain(); }
    applyGain() {
      if (!this.master) return;
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }

    setRain(r) {
      this.rain = r;
      if (!this.ok) return;
      const t = this.ctx.currentTime;
      this.hiss.gain.setTargetAtTime(0.11 * Math.pow(r, 1.2), t, 0.4);
      this.roar.gain.setTargetAtTime(0.08 * r, t, 0.4);
    }

    // res: Thunder.synth çıktısı; delaySec: şimdiden itibaren gecikme; pan: -1 (sol) .. 1 (sağ)
    playThunder(res, delaySec, pan) {
      if (!this.ok || !res || !res.data || !res.data.length) return;
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, res.data.length, res.sampleRate);
      buf.getChannelData(0).set(res.data);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = res.gain * 0.95;
      src.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.85, Math.min(0.85, pan || 0));
        g.connect(p); p.connect(this.thunderBus);
      } else g.connect(this.thunderBus);
      src.start(ctx.currentTime + Math.max(0, delaySec));
      this.sources.add(src);
      src.onended = () => this.sources.delete(src);
    }

    // Kare başına: yağmur damlası seslerini rastgele zamanlar.
    update(dtWall) {
      if (!this.ok || this.paused || this.muted || this.rain <= 0.02) return;
      this.dripAcc += dtWall * 14 * this.rain;
      const ctx = this.ctx;
      while (this.dripAcc >= 1) {
        this.dripAcc -= 1;
        if (Math.random() > 0.8) continue;
        const s = ctx.createBufferSource(); s.buffer = this.dripBuf;
        s.playbackRate.value = 0.55 + Math.random() * 1.4;
        const g = ctx.createGain(); g.gain.value = (0.015 + Math.random() * 0.05) * this.rain;
        s.connect(g);
        if (ctx.createStereoPanner) {
          const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
          g.connect(p); p.connect(this.dripFilter);
        } else g.connect(this.dripFilter);
        s.start(ctx.currentTime + Math.random() * 0.05);
      }
    }

    stopThunder() {
      for (const s of this.sources) { try { s.stop(); } catch (e) { /* zaten bitti */ } }
      this.sources.clear();
    }
  }

  F.AudioEngine = AudioEngine;
})(typeof self !== 'undefined' ? self : globalThis);
