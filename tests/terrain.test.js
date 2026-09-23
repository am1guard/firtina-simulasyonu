'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const F = loadFirtina(['js/core/math.js', 'js/world/terrain.js']);
const T = F.Terrain;
const CAM = T.CAMERA_POS;

function dirFromAngles(yawDeg, pitchDeg) {
  const y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}
function hdist(p) { return Math.hypot(p[0] - CAM[0], p[2] - CAM[2]); }

test('yükseklik sonlu ve süreklidir (orman örtüsü hariç)', () => {
  for (let x = -3000; x <= 3000; x += 97) {
    for (let z = -9000; z <= 200; z += 131) {
      const a = T.groundHeight(x, z), b = T.groundHeight(x + 1, z), c = T.groundHeight(x, z + 1);
      assert.ok(Number.isFinite(a));
      assert.ok(Math.abs(b - a) < 2 && Math.abs(c - a) < 2, `(${x}, ${z}) eğim çok dik`);
    }
  }
});

test('kamera kıyıdadır, önünde göl vardır', () => {
  const g = T.groundHeight(CAM[0], CAM[2]);
  assert.ok(g > 4 && g < CAM[1] - 1.5, `kamera altı zemin ${g}`);
  assert.ok(T.height(0, -700) < 0, 'göl merkezi su altında olmalı');
  assert.ok(T.isWater(0, -700));
  assert.ok(!T.isWater(CAM[0], CAM[2]));
});

test('gökyüzüne tıklama makul bir uzaklıkta zemine oturur', () => {
  for (const [yaw, pitch] of [[0, 20], [-30, 8], [35, 3], [0, 0.5], [10, 45]]) {
    const r = T.pickTarget(CAM, dirFromAngles(yaw, pitch));
    const d = hdist(r.point);
    assert.ok(d >= 1500 - 1e-6 && d <= 14000 + 1e-6, `yaw ${yaw} pitch ${pitch}: ${d}`);
    assert.ok(Math.abs(r.point[1] - Math.max(0, T.height(r.point[0], r.point[2]))) < 1e-6 || r.surface === 'kule');
    assert.ok(typeof r.surface === 'string' && r.surface.length > 0);
  }
});

test('göle bakan ışın su yüzeyinde sonlanır', () => {
  const target = [60, 0, -650];
  const dir = [target[0] - CAM[0], target[1] - CAM[1], target[2] - CAM[2]];
  const l = Math.hypot(...dir);
  const r = T.pickTarget(CAM, dir.map((v) => v / l));
  assert.equal(r.surface, 'göl');
  assert.ok(Math.abs(r.point[1]) < 1e-6);
  assert.ok(Math.hypot(r.point[0] - target[0], r.point[2] - target[2]) < 30);
});

test('kulenin yakınına tıklama kule ucuna yapışır', () => {
  const tw = T.tower;
  const aim = [tw.base[0] + 120, tw.base[1] + 30, tw.base[2]];
  const dir = [aim[0] - CAM[0], aim[1] - CAM[1], aim[2] - CAM[2]];
  const l = Math.hypot(...dir);
  const r = T.pickTarget(CAM, dir.map((v) => v / l));
  assert.equal(r.surface, 'kule');
  assert.deepEqual(r.point.map((v) => +v.toFixed(3)), tw.tip.map((v) => +v.toFixed(3)));
});

test('çok yakın hedef en az 150 m uzağa itilir', () => {
  const r = T.pickTarget(CAM, dirFromAngles(0, -14));
  assert.ok(hdist(r.point) >= 150 - 1e-6, `uzaklık ${hdist(r.point)}`);
});

test('arazi ağı geçerlidir', () => {
  const m = T.buildMesh({ rings: 64, spokes: 96 });
  const n = m.positions.length / 3;
  assert.equal(m.normals.length, m.positions.length);
  for (const v of m.positions) assert.ok(Number.isFinite(v));
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3);
  }
  for (const i of m.indices) assert.ok(i < n);
  assert.equal(m.indices.length % 3, 0);
});

test('köy en az 50 ev içerir ve hiçbiri suda değildir', () => {
  const v = T.buildVillage();
  assert.ok(v.houses.length >= 50, `ev sayısı ${v.houses.length}`);
  for (const h of v.houses) {
    assert.ok(!T.isWater(h.x, h.z), `ev suda: ${h.x}, ${h.z}`);
    assert.ok(h.y >= 0);
  }
  assert.ok(v.lamps.length / T.LAMP_STRIDE >= 10);
  assert.equal(v.indices.length % 3, 0);
});

test('targetAt zemin hedefi üretir ve kuleye yakınsa kule ucuna yapışır', () => {
  const a = T.targetAt(-1500, -5000);
  assert.ok(Math.abs(a.point[1] - T.surfaceHeight(-1500, -5000)) < 1e-9);
  assert.ok(Math.abs(a.dist - Math.hypot(-1500 - CAM[0], -5000 - CAM[2])) < 1e-6);
  const b = T.targetAt(T.tower.base[0] + 100, T.tower.base[2] - 80);
  assert.equal(b.surface, 'kule');
  assert.deepEqual(b.point, T.tower.tip);
  const w = T.targetAt(0, -700);
  assert.equal(w.surface, 'göl');
  assert.equal(w.point[1], 0);
});
