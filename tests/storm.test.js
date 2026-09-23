'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const F = loadFirtina(['js/core/math.js', 'js/sim/dbm.js', 'js/sim/luminosity.js', 'js/audio/thunder.js', 'js/world/terrain.js', 'js/sim/storm.js']);

function fakeRenderer() {
  const bolts = new Set();
  return { bolts, addBolt: (id) => bolts.add(id), removeBolt: (id) => bolts.delete(id), cameraForward: () => [0, 0, -1] };
}

function makeStorm(events) {
  const storm = new F.Storm({ renderer: fakeRenderer(), audio: { ok: false }, noWorker: true, seed: 42,
    onEvent: (type, data) => events.push({ type, data }) });
  storm.params.auto = false;
  return storm;
}

function runFrames(storm, frames, dt) {
  let simT = storm.simT, wallT = storm.wallT;
  for (let i = 0; i < frames; i++) {
    simT += dt; wallT += dt;
    storm.update(simT, wallT, dt, dt, 1);
  }
}

const bolt = F.DBM.generate({ kind: 'cg', seed: 11, eta: 1.7, cloudBase: 1400 });

test('gerçek zamanda kare arasında kalan her dönüş darbesi evre olarak bildirilir', () => {
  const events = [];
  const storm = makeStorm(events);
  storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
  const n = storm.focus.tl.strokes.length;
  runFrames(storm, 60, 1 / 60);
  const rs = events.filter((e) => e.type === 'phase' && e.data.key === 'rs').map((e) => e.data.label);
  for (let k = 1; k <= n; k++) assert.ok(rs.includes(`Dönüş darbesi ${k}/${n}`), `eksik: ${k}/${n} — ${rs.join(', ')}`);
});

test('evre sırası: öncü, bağlantı, dönüş darbesi', () => {
  const events = [];
  const storm = makeStorm(events);
  storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
  const ev = storm.focus, tl = ev.tl;
  assert.equal(storm.phaseOf(ev, tl.leaderDur * 0.5).key, 'leader');
  assert.equal(storm.phaseOf(ev, tl.leaderDur * 0.995).key, 'attach');
  assert.equal(storm.phaseOf(ev, tl.strokes[0].t + 0.001).key, 'rs');
  assert.equal(storm.phaseOf(ev, tl.end + 1).key, 'sakin');
});

test('çakış istatistikleri ve gök gürültüsü gecikmesi tutarlıdır', () => {
  const events = [];
  const storm = makeStorm(events);
  const target = F.Terrain.targetAt(-900, -4200);
  storm.startBolt('cg', bolt, target, {});
  const s = events.find((e) => e.type === 'strike').data;
  assert.ok(Math.abs(s.distanceKm - target.dist / 1000) < 1e-9);
  assert.ok(s.thunderDelay > 3 && s.thunderDelay < s.distanceKm * 1000 / 343 + 1, `gecikme ${s.thunderDelay}`);
  assert.ok(s.energyGJ > 0 && s.peakKA > 0 && s.strokes >= 1);
});

test('ışık kaynakları en fazla 16 olur ve dönüş darbesinde parlar', () => {
  const events = [];
  const storm = makeStorm(events);
  storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
  const t0 = storm.focus.tl.strokes[0].t;
  storm.update(t0 + 0.002, t0 + 0.002, t0 + 0.002, t0 + 0.002, 1);
  assert.ok(storm.lights.n > 0 && storm.lights.n <= 16);
  for (const v of storm.lights.col) assert.ok(Number.isFinite(v));
  assert.ok(storm.flashLevel > 1, `parlama ${storm.flashLevel}`);
});

test('süresi biten olaylar temizlenir, son yıldırım tekrar için tutulur', () => {
  const events = [];
  const storm = makeStorm(events);
  storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
  const key = storm.focus.boltKey;
  runFrames(storm, 240, 1 / 30);
  assert.equal(storm.events.length, 0);
  assert.ok(storm.renderer.bolts.has(key), 'son yıldırım tekrar için silinmemeli');
  assert.ok(storm.replay());
  assert.equal(storm.events.length, 1);
  assert.equal(storm.focus.replay, true);
});
