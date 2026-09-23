'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const F = loadFirtina(['js/sim/dbm.js']);
const DBM = F.DBM;
const S = DBM.SEG_STRIDE;

// Parça düzeni: p0.xyz, p1.xyz, tL0, tL1, s0, s1, w0, w1, width, flags, strokeMask, pad
const O = { p0: 0, p1: 3, tL0: 6, tL1: 7, s0: 8, s1: 9, w0: 10, w1: 11, width: 12, flags: 13, mask: 14 };

function seg(b, i, field) { return b.seg[i * S + O[field]]; }
function key(x, y, z) { return `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`; }

const cache = new Map();
function bolt(opts) {
  const k = JSON.stringify(opts);
  if (!cache.has(k)) cache.set(k, DBM.generate(opts));
  return cache.get(k);
}

const CG = { kind: 'cg', seed: 12345, eta: 3, cloudBase: 1400 };

test('negatif bulut-yer kanalı zemine iner ve başlangıç bulut tabanının üstündedir', () => {
  const b = bolt(CG);
  assert.ok(Math.abs(b.strike[1]) < 1e-3, `çarpma yüksekliği ${b.strike[1]}`);
  assert.ok(b.origin[1] > CG.cloudBase, `başlangıç yüksekliği ${b.origin[1]}`);
  assert.ok(b.segCount > 50, `parça sayısı ${b.segCount}`);
  assert.equal(b.SEG_STRIDE, S);
});

test('ağaç bağlıdır: her parça kökten, bir parçanın sonundan ya da zeminden başlar', () => {
  const b = bolt(CG);
  const ends = new Set([key(b.origin[0], b.origin[1], b.origin[2])]);
  for (let i = 0; i < b.segCount; i++) ends.add(key(b.seg[i * S + 3], b.seg[i * S + 4], b.seg[i * S + 5]));
  let orphans = 0;
  for (let i = 0; i < b.segCount; i++) {
    const x = b.seg[i * S], y = b.seg[i * S + 1], z = b.seg[i * S + 2];
    const isGroundStreamer = (seg(b, i, 'flags') & DBM.FLAG.STREAMER) !== 0 && Math.abs(y) < 1e-3;
    if (!ends.has(key(x, y, z)) && !isGroundStreamer) orphans++;
  }
  assert.equal(orphans, 0);
});

test('ana kanalda dönüş darbesi mesafesi zeminden köke doğru artar', () => {
  const b = bolt(CG);
  let mainCount = 0, maxS = 0;
  for (let i = 0; i < b.segCount; i++) {
    if ((seg(b, i, 'flags') & DBM.FLAG.MAIN) === 0) continue;
    mainCount++;
    maxS = Math.max(maxS, seg(b, i, 's0'));
    assert.ok(seg(b, i, 's0') > seg(b, i, 's1') - 1e-6, `parça ${i}: s0 ${seg(b, i, 's0')} s1 ${seg(b, i, 's1')}`);
  }
  assert.ok(mainCount > 20);
  assert.ok(Math.abs(b.mainLength - maxS) < 1e-3 * b.mainLength + 1e-6, `ana uzunluk ${b.mainLength}, en büyük s ${maxS}`);
});

test('öncü varış zamanı ana kanalda kökten bağlantı noktasına azalmaz ve bağlantı anı 1 olur', () => {
  const b = bolt(CG);
  let maxT = -Infinity;
  for (let i = 0; i < b.segCount; i++) {
    const f = seg(b, i, 'flags');
    if ((f & DBM.FLAG.MAIN) === 0 || (f & DBM.FLAG.UPWARD) !== 0) continue;
    assert.ok(seg(b, i, 'tL1') >= seg(b, i, 'tL0') - 1e-6, `parça ${i}`);
    maxT = Math.max(maxT, seg(b, i, 'tL1'));
  }
  assert.ok(Math.abs(maxT - 1) < 1e-4, `bağlantı anı ${maxT}`);
});

test('yukarı bağlantı öncüsü zeminden bağlantı noktasına yükselir', () => {
  const b = bolt(CG);
  let checked = 0;
  for (let i = 0; i < b.segCount; i++) {
    const f = seg(b, i, 'flags');
    if ((f & DBM.FLAG.MAIN) === 0 || (f & DBM.FLAG.UPWARD) === 0) continue;
    checked++;
    assert.ok(seg(b, i, 'tL1') <= seg(b, i, 'tL0') + 1e-6, `parça ${i}`);
    assert.ok(b.seg[i * S + 1] <= b.junctionHeight + 1e-3, `parça ${i} bağlantı yüksekliğinin üstünde`);
  }
  assert.ok(checked > 0);
});

test('aynı tohum aynı yıldırımı üretir, farklı tohum farklısını', () => {
  const a = DBM.generate(CG);
  const b = DBM.generate(CG);
  const c = DBM.generate({ ...CG, seed: 999 });
  assert.equal(a.segCount, b.segCount);
  assert.deepEqual(Array.from(a.seg.slice(0, 64)), Array.from(b.seg.slice(0, 64)));
  assert.notDeepEqual(Array.from(a.strike), Array.from(c.strike));
});

test('dallanma uç değerlerinde (η 1,5 ve 6) üretim süre bütçesinde kalır ve zemine ulaşır', () => {
  for (const eta of [1.5, 6]) {
    const t0 = performance.now();
    const b = DBM.generate({ ...CG, seed: 7, eta });
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `η=${eta}: ${ms.toFixed(0)} ms`);
    assert.ok(Math.abs(b.strike[1]) < 1e-3, `η=${eta} zemine ulaşmadı`);
  }
});

test('dizilerde NaN yoktur ve ışık/akustik örnekleri üretilir', () => {
  const b = bolt(CG);
  for (const name of ['seg', 'lights', 'acoustic', 'mainPath']) {
    for (const v of b[name]) assert.ok(Number.isFinite(v), `${name} içinde sonlu olmayan değer`);
  }
  assert.ok(b.lightCount >= 6 && b.lightCount <= DBM.MAX_LIGHTS, `ışık sayısı ${b.lightCount}`);
  assert.equal(b.lights.length, b.lightCount * DBM.LIGHT_STRIDE);
  assert.ok(b.acoustic.length / DBM.ACOUSTIC_STRIDE > 100);
});

test('pozitif bulut-yer daha yüksekten başlar ve daha az dallanır', () => {
  const n = DBM.generate({ ...CG, seed: 31 });
  const p = DBM.generate({ ...CG, seed: 31, kind: 'cgp' });
  assert.ok(p.origin[1] > n.origin[1] + 500);
  assert.ok(Math.abs(p.strike[1]) < 1e-3);
  // Pozitif kanal yaklaşık iki kat uzun; karşılaştırma ana kanal km'si başına dal yoğunluğuyla yapılır.
  const density = (b) => b.stats.branchCount / (b.mainLength / 1000);
  assert.ok(density(p) < density(n), `pozitif ${density(p).toFixed(1)}/km, negatif ${density(n).toFixed(1)}/km`);
});

test('örümcek yıldırım ince yatay katmanda kalır ve zemine inmez', () => {
  const b = DBM.generate({ kind: 'spider', seed: 5, eta: 2.5, cloudBase: 1400 });
  let minY = Infinity, maxY = -Infinity, span = 0;
  for (let i = 0; i < b.segCount; i++) {
    for (const o of [0, 3]) {
      const x = b.seg[i * S + o], y = b.seg[i * S + o + 1], z = b.seg[i * S + o + 2];
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      span = Math.max(span, Math.hypot(x - b.origin[0], z - b.origin[2]));
    }
  }
  assert.ok(minY > 1400 - 400, `en alçak ${minY}`);
  assert.ok(maxY < 1400 + 300, `en yüksek ${maxY}`);
  assert.ok(span > 2500, `yayılım ${span}`);
  assert.equal(b.strike, null);
});
