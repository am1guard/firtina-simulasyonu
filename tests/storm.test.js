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

function runScaled(storm, frames, dtWall, ts) {
  for (let i = 0; i < frames; i++) {
    const simT = storm.simT + dtWall * ts, wallT = storm.wallT + dtWall;
    storm.update(simT, wallT, dtWall * ts, dtWall, ts);
  }
}
function totalLight(storm) { let s = 0; for (let k = 0; k < storm.lights.n; k++) s += storm.lights.col[k * 4] + storm.lights.col[k * 4 + 1] + storm.lights.col[k * 4 + 2]; return s; }

test('yavaş çekimden gerçek zamana dönüş sahneyi yeniden parlatmaz (normal ve yumuşak)', () => {
  for (const soft of [false, true]) {
    const storm = makeStorm([]);
    storm.params.soft = soft;
    storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
    const ev = storm.focus, last = ev.tl.strokes[ev.tl.strokes.length - 1];
    const ts = 1 / 200, dt = 1 / 60;
    // Son darbe + sürekli akım bitene kadar yavaş çekim, ardından 3 sn duvar süresi daha
    while (storm.simT - ev.tStart < last.t + last.cc + 0.03) runScaled(storm, 1, dt, ts);
    runScaled(storm, 180, dt, ts);
    const before = totalLight(storm);
    runScaled(storm, 1, dt, 1);
    const after = totalLight(storm);
    assert.ok(after <= before * 1.05 + 1e3, `${soft ? 'yumuşak' : 'normal'}: ${before.toExponential(2)} -> ${after.toExponential(2)}`);
  }
});

test('yumuşak kipte ışık çıkışı kare başına sınırlı hızla yükselir', () => {
  const storm = makeStorm([]);
  storm.params.soft = true;
  let prev = 0, worst = 0;
  storm.startIC(F.Terrain.targetAt(0, -4000), {});
  storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
  for (let i = 0; i < 120; i++) {
    runScaled(storm, 1, 1 / 60, 1);
    const cur = totalLight(storm);
    if (prev > 1e5) worst = Math.max(worst, cur / prev);
    prev = cur;
  }
  assert.ok(worst < 1.12, `kare başına en büyük artış oranı ${worst.toFixed(3)}`);
});

test('kullanıcı çakışları hız sınırlıdır (normal 0,4 sn, yumuşak 3 sn)', () => {
  const storm = makeStorm([]);
  const tgt = F.Terrain.targetAt(-900, -4200);
  storm.ready.cg.push(bolt, bolt, bolt, bolt);
  assert.equal(storm.strike(tgt, 'cg', { user: true }), 'ok');
  runScaled(storm, 6, 1 / 60, 1);
  assert.equal(storm.strike(tgt, 'cg', { user: true }), 'hiz');
  runScaled(storm, 24, 1 / 60, 1);
  assert.equal(storm.strike(tgt, 'cg', { user: true }), 'ok');
  storm.params.soft = true;
  runScaled(storm, 60, 1 / 60, 1);
  assert.equal(storm.strike(tgt, 'cg', { user: true }), 'hiz');
  runScaled(storm, 130, 1 / 60, 1);
  assert.equal(storm.strike(tgt, 'cg', { user: true }), 'ok');
  assert.equal(storm.strike(tgt, 'cg', {}), 'ok', 'otomatik çakışlar sınırlanmaz');
});

test('bulut içi olayda gök gürültüsü gecikmesi akustik kanaldan hesaplanır', () => {
  const cam = F.Terrain.CAMERA_POS;
  for (let i = 0; i < 20; i++) {
    const events = [];
    const storm = makeStorm(events);
    storm.startIC(F.Terrain.targetAt(-2000 + i * 150, -5000), {});
    const ev = storm.focus, A = ev.acoustic;
    let best = Infinity;
    for (let j = 0; j < A.length; j += 9) best = Math.min(best, Math.hypot(A[j] - cam[0], A[j + 1] - cam[1], A[j + 2] - cam[2]));
    assert.ok(Math.abs(ev.stats.thunderDelay - best / 343) < 0.01, `${ev.stats.thunderDelay} vs ${best / 343}`);
  }
});

test('worker çökerse üretim ana iş parçacığına geçer ve kuyruk dolar', async () => {
  const storm = makeStorm([]);
  const posted = [];
  const fake = { postMessage: (m) => posted.push(m) };
  storm.attachWorker(fake);
  storm.ready = { cg: [], cgp: [], spider: [] };
  storm.inflight = { cg: 0, cgp: 0, spider: 0 };
  storm.fillQueues();
  assert.ok(posted.length > 0);
  fake.onerror();
  assert.equal(storm.worker, null);
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(storm.ready.cg.length >= 1, `hazır cg ${storm.ready.cg.length}`);
});

test('worker hata iletisinden sonra kuyruk yeniden istenir', () => {
  const storm = makeStorm([]);
  const posted = [];
  const fake = { postMessage: (m) => posted.push(m) };
  storm.attachWorker(fake);
  storm.ready = { cg: [], cgp: [], spider: [] };
  storm.inflight = { cg: 0, cgp: 0, spider: 0 };
  storm.fillQueues();
  const first = posted.find((m) => m.type === 'bolt' && m.opts.kind === 'cg');
  const n = posted.length;
  fake.onmessage({ data: { type: 'error', id: first.id, message: 'deneme' } });
  assert.ok(posted.length > n, 'hatadan sonra yeni istek gönderilmedi');
});

test('tekrar, yeni zaman ölçeğiyle kısa bir ön payla başlar', () => {
  const storm = makeStorm([]);
  storm.startBolt('cg', bolt, F.Terrain.targetAt(-900, -4200), {});
  runScaled(storm, 30, 1 / 60, 1);
  assert.ok(storm.replay(1 / 200));
  assert.ok(Math.abs(storm.focus.tStart - storm.simT - 0.002 / 200) < 1e-12);
});

test('geç tamamlanan gök gürültüsü düşürülmez, ses motoruna negatif gecikmeyle verilir', () => {
  const delays = [];
  const audio = { ok: true, setRain() {}, playThunder: (res, delay) => delays.push(delay) };
  const storm = new F.Storm({ renderer: fakeRenderer(), audio, noWorker: true, seed: 42, onEvent: () => {} });
  storm.params.auto = false;
  runScaled(storm, 60, 1 / 60, 1);
  const res = { data: new Float32Array(22050 * 20), sampleRate: 22050, delay: 1 };
  storm.receiveThunder({ kind: 'thunder', pan: 0, arrivalBase: storm.wallT - 5 }, res);
  assert.equal(delays.length, 1, 'gök gürültüsü düşürüldü');
  assert.ok(Math.abs(delays[0] + 4) < 1e-9, `gecikme ${delays[0]}`);
});
