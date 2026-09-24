'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const M = loadFirtina(['js/core/math.js']).math;
const d = Math.PI / 180;

test('effectiveFov yatay ekranda yakınlaştırma açısını korur', () => {
  for (const z of [18, 30, 50, 68]) assert.ok(Math.abs(M.effectiveFov(z * d, 16 / 9) - z * d) < 1e-9, `${z}`);
});

test('effectiveFov dikey ekranda genişletir ama yakınlaştırma çalışır ve 100° ile sınırlıdır', () => {
  const p = 390 / 844;
  const def = M.effectiveFov(50 * d, p), zin = M.effectiveFov(18 * d, p), zout = M.effectiveFov(68 * d, p);
  assert.ok(def > 80 * d && def < 90 * d, `varsayılan ${def / d}`);
  assert.ok(zin < def * 0.5, `yakın ${zin / d}`);
  assert.ok(zout > def && zout <= 100 * d + 1e-9, `uzak ${zout / d}`);
});

test('yawLimit görüşü arazi ağının içinde tutar', () => {
  const meshHalf = 1.75;
  for (const aspect of [16 / 9, 21 / 9, 4 / 3, 390 / 844, 820 / 1180]) {
    for (const zoom of [18, 50, 68]) {
      const fov = M.effectiveFov(zoom * d, aspect);
      const half = Math.atan(Math.tan(fov / 2) * aspect);
      const lim = M.yawLimit(meshHalf, fov, aspect, 0.75);
      assert.ok(lim >= 0 && lim <= 0.75, `${aspect} ${zoom}: sınır ${lim}`);
      assert.ok(lim + half <= meshHalf - 0.04, `${aspect} ${zoom}: kenar ${lim + half}`);
    }
  }
});
