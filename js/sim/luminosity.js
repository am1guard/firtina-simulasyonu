/* Yıldırım Gözlemevi — kanal parlaklığının zaman modeli.
 *
 * Bir yıldırım çakışının evreleri: basamaklı öncü (zayıf kanal, parlak uçlar), yukarı bağlantı öncüsü,
 * dönüş darbesi (yerden yukarı ~1,1e8 m/s ilerleyen cephe), ok öncü ve ardışık darbeler, sürekli akım ve
 * M-bileşenleri. Aynı işlev GLSL'de (shaders.js: boltLum) birebir yinelenir; sabitler yalnızca burada
 * tanımlanır ve shader'a buradan aktarılır.
 *
 * Zaman birimleri: t, yıldırımın başlangıcından beri geçen simülasyon saniyesidir. ts, zaman ölçeğidir
 * (1 = gerçek zaman). Algısal kalıcılık (retina ve kamera tümlemesi) duvar saatinde (Δ / ts) söner. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};
  const M = F.math;

  const FLAG = { MAIN: 1, BRANCH: 2, STREAMER: 4, CLOUD: 8, UPWARD: 16 };

  const CONST = {
    V_RS: 1.1e8,        // dönüş darbesi hızı (m/s), ışık hızının ~1/3'ü
    V_DART: 1.6e7,      // ok öncü hızı (m/s)
    A1: 0.8, TAU1: 60e-6,   // dönüş darbesi hızlı sönüm
    A2: 0.2, TAU2: 1.6e-3,  // sıcak kanalın ardıl ışıması
    PERSIST: 0.35, TAU_EYE: 0.07, // algısal kalıcılık (duvar saati)
    LEADER_BASE: 0.008, LEADER_TIP: 0.1, TIP_FRAC: 0.035, LEADER_FADE: 0.002,
    DART_BASE: 0.03, DART_TIP: 0.3, TAU_DART: 40e-6,
    CC_RISE: 0.0015, CC_TAIL: 0.025, MC_TAU: 0.003, MAX_MC: 2, // M-bileşeni: darbe başına en fazla 2 (GLSL ile eş)
    SPIDER_V: 2.5e6, SPIDER_TAU: 0.012, SPIDER_BASE: 0.09, SPIDER_TIP: 0.35,
    IC_TAU1: 0.003, IC_TAU2: 0.03, // bulut içi darbelerin sönüm sabitleri
    SOFT_SCALE: 0.35,   // yumuşak parlama kipinde tepe ölçeği
    SOFT_RISE: 0.25, SOFT_FALL: 0.8, // yumuşak zarf zaman sabitleri (duvar saati, sn)
    SOFT_NORM: 2.06,    // yumuşak zarfın tepesini 1'e getiren çarpan
    LIM_RISE: 0.35, LIM_FALL: 0.7,   // FlashLimiter zaman sabitleri
    MAX_DT: 0.1,        // kare arası en büyük adım (sekme dönüşü vb.)
  };

  // Tek bir köşenin parlaklığı. out = { hot, leader, cc } (ayrı renklendirme için üç bileşen).
  function vertex(tl, tLn, s, w, flags, mask, t, ts, out, soft) {
    const C = CONST;
    let hot = 0, leader = 0, cc = 0;
    const strokes = tl.strokes;
    if (tl.kind === 'ic') {
      // Bulut içi boşalma: öncü yok; K-süreci darbeleri bulutta saçılarak daha yavaş söner.
      for (let k = 0; k < strokes.length; k++) {
        if (!(mask & (1 << k))) continue;
        const d = t - strokes[k].t;
        if (d < 0) continue;
        if (soft) hot += strokes[k].amp * w * softEnv(d / ts);
        else hot += strokes[k].amp * w * (0.7 * Math.exp(-d / C.IC_TAU1) + 0.3 * Math.exp(-d / C.IC_TAU2) + C.PERSIST * Math.exp(-(d / ts) / C.TAU_EYE));
      }
      out.hot = hot; out.leader = 0; out.cc = 0;
      return out;
    }
    const spider = tl.kind === 'spider';
    const tArr = tLn * tl.leaderDur;

    if (t >= tArr) {
      const dt = t - tArr;
      const tip = soft ? 0 : Math.exp(-dt / (C.TIP_FRAC * tl.leaderDur));
      if (spider) {
        const fade = t > tl.glowEnd ? Math.exp(-(t - tl.glowEnd) / 0.12) : 1;
        leader = (C.SPIDER_BASE + C.SPIDER_TIP * tip) * (0.35 + 0.65 * w) * fade * (soft ? 0.6 : 1);
      } else {
        let l = C.LEADER_BASE + C.LEADER_TIP * tip;
        const firstRS = strokes.length ? strokes[0].t : Infinity;
        if (t > firstRS) l *= Math.exp(-(t - firstRS) / C.LEADER_FADE);
        leader = l * (0.55 + 0.45 * w) * ((flags & FLAG.STREAMER) ? 1.2 : 1) * (soft ? 0.5 : 1);
      }
    }

    for (let k = 0; k < strokes.length; k++) {
      if (!(mask & (1 << k))) continue;
      const st = strokes[k];
      if (spider) {
        const tf = st.t + s / C.SPIDER_V;
        if (t >= tf && t >= tArr) {
          const d = t - tf;
          if (soft) hot += st.amp * w * softEnv(d / ts) * 0.5;
          else hot += st.amp * w * (0.6 * Math.exp(-d / C.SPIDER_TAU) + 0.5 * C.PERSIST * Math.exp(-(d / ts) / C.TAU_EYE));
        }
        continue;
      }
      const tFront = st.t + s / tl.vRS;
      if (!soft && k > 0 && s > 0) {
        const tD = st.t - s / tl.vDart;
        if (t >= tD && t < tFront) leader += (C.DART_BASE + C.DART_TIP * Math.exp(-(t - tD) / C.TAU_DART)) * Math.sqrt(st.amp) * w;
      }
      if (t >= tFront) {
        const d = t - tFront;
        if (soft) hot += st.amp * w * softEnv(d / ts);
        else hot += st.amp * w * (C.A1 * Math.exp(-d / C.TAU1) + C.A2 * Math.exp(-d / C.TAU2) + C.PERSIST * Math.exp(-(d / ts) / C.TAU_EYE));
        if (st.cc > 0) {
          const env = d < st.cc ? Math.min(1, d / C.CC_RISE) : Math.exp(-(d - st.cc) / C.CC_TAIL);
          let m = 1;
          if (!soft) {
            for (let j = 0; j < st.mc.length; j++) {
              const dm = d - st.mc[j].t;
              if (dm > 0) m += st.mc[j].amp * Math.exp(-dm / C.MC_TAU);
            }
          }
          cc += st.amp * w * st.ccAmp * env * m * (soft ? 0.5 : 1);
        }
      }
    }
    out.hot = hot; out.leader = leader; out.cc = cc;
    return out;
  }

  // Yumuşak parlama zarfı: yavaş yükselir, yavaş söner; tepesi SOFT_SCALE.
  function softEnv(x) {
    const C = CONST;
    return C.SOFT_SCALE * C.SOFT_NORM * (1 - Math.exp(-x / C.SOFT_RISE)) * Math.exp(-x / C.SOFT_FALL);
  }

  const STROKE_P = [0.17, 0.18, 0.2, 0.16, 0.12, 0.08, 0.05, 0.04];
  function strokeCount(rng) {
    let r = rng(), n = 1;
    for (let i = 0; i < STROKE_P.length; i++) { r -= STROKE_P[i]; if (r <= 0) { n = i + 1; break; } n = i + 1; }
    return n;
  }

  // Bir çakışın zaman çizelgesi. rng: [0,1) üreteci. opts.mainLength: ana kanal uzunluğu (m).
  function makeTimeline(kind, rng, opts) {
    const o = opts || {};
    const tl = { kind, vRS: CONST.V_RS, vDart: CONST.V_DART, mainLength: o.mainLength || 3000,
      leaderDur: 0, strokes: [], peakKA: [], glowEnd: 0, end: 0 };
    const lerp = M.lerp, clamp = M.clamp, lognormal = M.lognormal;
    let last = 0;
    if (kind === 'cg') {
      tl.leaderDur = clamp(lognormal(rng, 0.024, 0.25), 0.015, 0.04);
      const n = strokeCount(rng);
      const I1 = clamp(lognormal(rng, 30, 0.6), 6, 200);
      let t = tl.leaderDur, prevCC = 0;
      for (let k = 0; k < n; k++) {
        if (k > 0) {
          let gap = clamp(lognormal(rng, 0.05, 0.55), 0.015, 0.4);
          if (prevCC > 0) gap = Math.max(gap, prevCC + 0.012);
          t += gap;
        }
        const Ik = k === 0 ? I1 : clamp(lognormal(rng, 12, 0.6), 3, 120);
        const amp = k === 0 ? 1 : clamp(Math.pow(Ik / I1, 0.7), 0.25, 1.3);
        const hasCC = rng() < (k === n - 1 ? 0.45 : 0.25);
        const cc = hasCC ? lerp(0.04, 0.25, rng()) : 0;
        const ccAmp = hasCC ? lerp(0.05, 0.12, rng()) : 0;
        const mc = [];
        if (hasCC) { const m = Math.floor(rng() * 3); for (let j = 0; j < m; j++) mc.push({ t: rng() * cc, amp: lerp(0.8, 3, rng()) }); }
        tl.strokes.push({ t, amp, cc, ccAmp, mc });
        tl.peakKA.push(Ik);
        prevCC = cc;
        last = Math.max(last, t + cc);
      }
    } else if (kind === 'cgp') {
      tl.leaderDur = clamp(lognormal(rng, 0.04, 0.25), 0.025, 0.07);
      const I = clamp(lognormal(rng, 60, 0.5), 20, 300);
      const cc = lerp(0.1, 0.3, rng());
      const mc = [];
      const m = 1 + Math.floor(rng() * 2);
      for (let j = 0; j < m; j++) mc.push({ t: rng() * cc, amp: lerp(0.8, 2.5, rng()) });
      tl.strokes.push({ t: tl.leaderDur, amp: lerp(1.6, 2.4, rng()), cc, ccAmp: lerp(0.12, 0.2, rng()), mc });
      tl.peakKA.push(I);
      last = tl.leaderDur + cc;
    } else if (kind === 'spider') {
      tl.leaderDur = lerp(0.35, 0.7, rng());
      const n = 3 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) tl.strokes.push({ t: lerp(0.1, 1.0, rng()) * tl.leaderDur + (k === n - 1 ? 0.15 : 0), amp: lerp(0.3, 0.9, rng()), cc: 0, ccAmp: 0, mc: [] });
      tl.strokes.sort((a, b) => a.t - b.t);
      tl.glowEnd = tl.leaderDur + lerp(0.1, 0.3, rng());
      last = tl.glowEnd;
    } else { // 'ic': bulut içi, yalnızca ışık darbeleri (K değişimleri)
      const n = 3 + Math.floor(rng() * 6); // en fazla 8 darbe (GLSL sınırı)
      const span = lerp(0.1, 0.6, rng());
      for (let k = 0; k < n; k++) tl.strokes.push({ t: rng() * span, amp: lerp(0.2, 1, rng()), cc: 0, ccAmp: 0, mc: [] });
      tl.strokes.sort((a, b) => a.t - b.t);
      last = span;
    }
    tl.end = last + 1.0;
    return tl;
  }

  // Genel sinyal yumuşatıcı: asimetrik alçak geçiren; yumuşak kipte tepeyi SOFT_SCALE ile ölçekler.
  class FlashLimiter {
    constructor() { this.level = 0; }
    apply(signal, dtWall, enabled) {
      if (!enabled) { this.level = signal * CONST.SOFT_SCALE; return signal; }
      const target = signal * CONST.SOFT_SCALE;
      const tau = target > this.level ? CONST.LIM_RISE : CONST.LIM_FALL;
      this.level += (target - this.level) * (1 - Math.exp(-dtWall / tau));
      return this.level;
    }
  }

  // Duvar ve simülasyon saati. tick(ms) -> { dtWall, dtSim } (saniye).
  class Clock {
    constructor() { this.last = null; this.simT = 0; this.wallT = 0; this.timeScale = 1; this.paused = false; }
    tick(nowMs) {
      if (this.last === null) { this.last = nowMs; return { dtWall: 0, dtSim: 0 }; }
      let dt = (nowMs - this.last) / 1000;
      this.last = nowMs;
      if (!(dt > 0)) dt = 0;
      if (dt > CONST.MAX_DT) dt = CONST.MAX_DT;
      this.wallT += dt;
      const dtSim = this.paused ? 0 : dt * this.timeScale;
      this.simT += dtSim;
      return { dtWall: dt, dtSim };
    }
  }

  F.Lum = { FLAG, CONST, vertex, softEnv, makeTimeline, FlashLimiter, Clock };
})(typeof self !== 'undefined' ? self : globalThis);
