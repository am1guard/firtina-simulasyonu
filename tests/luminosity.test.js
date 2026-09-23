'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const F = loadFirtina(['js/core/math.js', 'js/sim/luminosity.js']);
const Lum = F.Lum;
const FLAG = Lum.FLAG;

// Denetimli zaman çizelgesi: 25 ms öncü, 3 darbe, sürekli akım yok.
function fixedTimeline(extra) {
  return Object.assign({
    kind: 'cg', leaderDur: 0.025, vRS: Lum.CONST.V_RS, vDart: Lum.CONST.V_DART, mainLength: 3000,
    strokes: [
      { t: 0.025, amp: 1, cc: 0, ccAmp: 0, mc: [] },
      { t: 0.080, amp: 0.6, cc: 0, ccAmp: 0, mc: [] },
      { t: 0.140, amp: 0.5, cc: 0, ccAmp: 0, mc: [] },
    ],
  }, extra || {});
}
const MAIN = { tL: 0.5, s: 1200, w: 1, flags: FLAG.MAIN, mask: 0xff };
const BRANCH = { tL: 0.6, s: 2500, w: 0.3, flags: FLAG.BRANCH, mask: 0x01 };
const out = { hot: 0, leader: 0, cc: 0 };
function lum(tl, v, t, ts = 1) { Lum.vertex(tl, v.tL, v.s, v.w, v.flags, v.mask, t, ts, out); return out.hot + out.leader + out.cc; }

test('öncü varışından önce kanal karanlıktır', () => {
  const tl = fixedTimeline();
  assert.equal(lum(tl, MAIN, 0.5 * 0.025 - 1e-4), 0);
});

test('öncü varışından sonra kanal zayıf, uç parlak ışır', () => {
  const tl = fixedTimeline();
  const tArr = 0.5 * 0.025;
  const tip = lum(tl, MAIN, tArr + 1e-5);
  const later = lum(tl, MAIN, tArr + 0.01);
  assert.ok(tip > later && later > 0, `uç ${tip}, sonra ${later}`);
  assert.ok(tip < 0.3, `öncü dönüş darbesinden sönük olmalı: ${tip}`);
});

test('ilk dönüş darbesinde ana kanal tepe parlaklığa ulaşır', () => {
  const tl = fixedTimeline();
  const tFront = 0.025 + MAIN.s / tl.vRS;
  Lum.vertex(tl, MAIN.tL, MAIN.s, MAIN.w, MAIN.flags, MAIN.mask, tFront + 1e-7, 1, out);
  assert.ok(out.hot > 0.9, `sıcak bileşen ${out.hot}`);
});

test('gerçek zamanda tek darbeden 250 ms sonra ana kanal sönmüştür', () => {
  const tl = fixedTimeline({ strokes: [{ t: 0.025, amp: 1, cc: 0, ccAmp: 0, mc: [] }] });
  assert.ok(lum(tl, MAIN, 0.025 + 0.25) < 0.05);
});

test('ikinci darbe dalları yakmaz', () => {
  const tl = fixedTimeline();
  const t2 = 0.080 + BRANCH.s / tl.vRS + 1e-6;
  const before = lum(tl, BRANCH, t2 - 2e-6);
  const after = lum(tl, BRANCH, t2);
  assert.ok(after <= before + 1e-9, `dal ikinci darbede parladı: ${before} -> ${after}`);
});

test('ok öncü ikinci darbeden önce ana kanalı yukarıdan aşağı aydınlatır', () => {
  const tl = fixedTimeline();
  const tDart = 0.080 - MAIN.s / tl.vDart;
  Lum.vertex(tl, MAIN.tL, MAIN.s, MAIN.w, MAIN.flags, MAIN.mask, tDart + 1e-6, 1, out);
  assert.ok(out.leader > 0.05, `ok öncü ${out.leader}`);
});

test('yavaş çekimde dönüş darbesi cephesi kanal boyunca ilerler', () => {
  const tl = fixedTimeline();
  const t = 0.025 + 1000 / tl.vRS;
  const low = { ...MAIN, s: 500 }, high = { ...MAIN, s: 2000 };
  Lum.vertex(tl, low.tL, low.s, low.w, low.flags, low.mask, t, 1e-4, out);
  const lowHot = out.hot;
  Lum.vertex(tl, high.tL, high.s, high.w, high.flags, high.mask, t, 1e-4, out);
  assert.ok(lowHot > 0.5, `alt nokta ${lowHot}`);
  assert.equal(out.hot, 0);
});

test('sürekli akım darbe sonrasında kanalı düşük düzeyde açık tutar', () => {
  const tl = fixedTimeline({ strokes: [{ t: 0.025, amp: 1, cc: 0.15, ccAmp: 0.1, mc: [] }] });
  Lum.vertex(tl, MAIN.tL, MAIN.s, MAIN.w, MAIN.flags, MAIN.mask, 0.025 + 0.1, 1, out);
  assert.ok(out.cc > 0.05 && out.cc < 0.2, `sürekli akım ${out.cc}`);
  Lum.vertex(tl, MAIN.tL, MAIN.s, MAIN.w, MAIN.flags, MAIN.mask, 0.025 + 0.4, 1, out);
  assert.ok(out.cc < 0.005);
});

test('zaman çizelgesi aynı tohumla aynıdır ve fiziksel sınırlar içindedir', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const a = Lum.makeTimeline('cg', F.math.mulberry32(seed), { mainLength: 3000 });
    const b = Lum.makeTimeline('cg', F.math.mulberry32(seed), { mainLength: 3000 });
    assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
    assert.ok(a.strokes.length >= 1 && a.strokes.length <= 8);
    assert.ok(Math.abs(a.strokes[0].t - a.leaderDur) < 1e-12);
    assert.ok(a.leaderDur >= 0.015 && a.leaderDur <= 0.04);
    for (let k = 1; k < a.strokes.length; k++) {
      const gap = a.strokes[k].t - a.strokes[k - 1].t;
      assert.ok(gap >= 0.015 - 1e-9 && gap <= 0.4 + 1e-9, `aralık ${gap}`);
    }
    assert.ok(a.end > a.strokes[a.strokes.length - 1].t);
  }
});

test('pozitif yıldırım tek güçlü darbe ve uzun sürekli akım üretir', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const tl = Lum.makeTimeline('cgp', F.math.mulberry32(seed), { mainLength: 5000 });
    assert.equal(tl.strokes.length, 1);
    assert.ok(tl.strokes[0].amp >= 1.5);
    assert.ok(tl.strokes[0].cc >= 0.1);
  }
});

test('yumuşatıcı kare başına değişimi ve tepeyi sınırlar', () => {
  const lim = new Lum.FlashLimiter();
  let prev = 0, maxDisp = 0, maxStep = 0;
  for (let frame = 0; frame < 240; frame++) {
    const F0 = (Math.floor(frame / 3) % 2) ? 20 : 0; // 10 Hz yanıp sönme
    const disp = lim.apply(F0, 1 / 60, true);
    maxDisp = Math.max(maxDisp, disp);
    maxStep = Math.max(maxStep, Math.abs(disp - prev));
    prev = disp;
  }
  assert.ok(maxDisp <= 20 * Lum.CONST.SOFT_SCALE + 1e-9, `tepe ${maxDisp}`);
  assert.ok(maxStep <= 0.12 * 20 * Lum.CONST.SOFT_SCALE, `adım ${maxStep}`);
});

test('yumuşatıcı kapalıyken sinyali değiştirmez', () => {
  const lim = new Lum.FlashLimiter();
  assert.equal(lim.apply(20, 1 / 60, false), 20);
});

test('yumuşak parlama kipinde çok darbeli çakış ani titreşim üretmez', () => {
  const tl = fixedTimeline();
  const vals = [];
  for (let frame = 0; frame < 90; frame++) {
    Lum.vertex(tl, MAIN.tL, MAIN.s, MAIN.w, MAIN.flags, MAIN.mask, frame / 60, 1, out, true);
    vals.push(out.hot + out.leader + out.cc);
  }
  const peak = Math.max(...vals);
  assert.ok(peak > 0.05, `tepe ${peak}`);
  assert.ok(peak <= Lum.CONST.SOFT_SCALE * 2.5, `tepe çok yüksek ${peak}`);
  let maxStep = 0, peaks = 0;
  for (let i = 1; i < vals.length; i++) maxStep = Math.max(maxStep, Math.abs(vals[i] - vals[i - 1]));
  for (let i = 1; i < vals.length - 1; i++) if (vals[i] > vals[i - 1] && vals[i] >= vals[i + 1] && vals[i] > 0.1 * peak) peaks++;
  assert.ok(maxStep <= 0.2 * peak, `kare adımı ${maxStep} / tepe ${peak}`);
  assert.ok(peaks <= 1, `tepe sayısı ${peaks}`);
});

test('saat büyük boşlukları kırpar, duraklatma ve zaman ölçeği uygular', () => {
  const c = new Lum.Clock();
  c.tick(1000);
  let r = c.tick(6000);
  assert.equal(r.dtWall, Lum.CONST.MAX_DT);
  c.timeScale = 0.01;
  r = c.tick(6016);
  assert.ok(Math.abs(r.dtSim - 0.016 * 0.01) < 1e-9);
  c.paused = true;
  r = c.tick(6032);
  assert.equal(r.dtSim, 0);
  assert.ok(r.dtWall > 0);
});

test('bulut içi (IC) darbeleri sonlu parlaklık üretir ve söner', () => {
  const tl = Lum.makeTimeline('ic', F.math.mulberry32(3));
  assert.equal(tl.leaderDur, 0);
  for (const t0 of [0, tl.strokes[0].t]) {
    Lum.vertex(tl, 0, 0, 1, FLAG.CLOUD, 0xff, t0, 1, out);
    assert.ok(Number.isFinite(out.hot) && Number.isFinite(out.leader) && Number.isFinite(out.cc), `t=${t0}: ${out.hot} ${out.leader}`);
    assert.equal(out.leader, 0, 'bulut içi olayda öncü ışıması olmamalı');
  }
  const t = tl.strokes[0].t + 0.002;
  Lum.vertex(tl, 0, 0, 1, FLAG.CLOUD, 0xff, t, 1, out);
  assert.ok(Number.isFinite(out.hot) && Number.isFinite(out.leader), `${out.hot} ${out.leader}`);
  assert.ok(out.hot > 0.1, `ic ${out.hot}`);
  Lum.vertex(tl, 0, 0, 1, FLAG.CLOUD, 0xff, tl.end + 0.5, 1, out);
  assert.ok(out.hot < 0.01);
});
