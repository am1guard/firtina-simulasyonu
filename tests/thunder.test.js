'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const F = loadFirtina(['js/audio/thunder.js']);
const Th = F.Thunder;
const SR = 16000;

// x = dist konumunda, zeminden 1500 m'ye dikey kanal; 15 m'lik akustik parçalar.
function verticalChannel(dist) {
  const a = [];
  for (let y = 0; y < 1500; y += 15) a.push(dist, y + 7.5, 0, 0, 1, 0, 15, 1, 1);
  return Float32Array.from(a);
}
const LISTENER = [0, 1.5, 0];
const ONE = [{ t: 0, amp: 1 }];

function hfRatio(data) {
  let e = 0, d = 0;
  for (let i = 1; i < data.length; i++) { e += data[i] * data[i]; d += (data[i] - data[i - 1]) ** 2; }
  return d / (e || 1);
}

test('ilk varış gecikmesi en yakın uzaklık / 343 m/s olur', () => {
  const r = Th.synth({ acoustic: verticalChannel(3000), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 1 });
  const expected = Math.hypot(3000, 7.5 - 1.5) / 343;
  assert.ok(Math.abs(r.delay - expected) / expected < 0.02, `gecikme ${r.delay}, beklenen ${expected}`);
});

test('çıktı sonlu, normalleştirilmiş ve kanal uzunluğuyla uyumlu sürededir', () => {
  const r = Th.synth({ acoustic: verticalChannel(3000), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 2 });
  let peak = 0;
  for (const v of r.data) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  assert.ok(peak > 0.5 && peak <= 1 + 1e-6, `tepe ${peak}`);
  assert.equal(r.sampleRate, SR);
  const spread = (Math.hypot(3000, 1500) - 3000) / 343;
  assert.ok(r.duration > spread && r.duration < spread + 3, `süre ${r.duration}`);
  assert.ok(Math.abs(r.data.length / SR - r.duration) < 0.01);
});

test('uzak gök gürültüsünün yüksek frekans oranı yakınınkinden düşüktür', () => {
  const near = Th.synth({ acoustic: verticalChannel(800), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 3 });
  const far = Th.synth({ acoustic: verticalChannel(9000), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 3 });
  assert.ok(hfRatio(near.data) > 2 * hfRatio(far.data), `yakın ${hfRatio(near.data)}, uzak ${hfRatio(far.data)}`);
});

test('yakın çakışın ses kazancı uzaktakinden büyüktür', () => {
  const near = Th.synth({ acoustic: verticalChannel(800), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 4 });
  const far = Th.synth({ acoustic: verticalChannel(9000), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 4 });
  assert.ok(near.gain > far.gain && far.gain > 0 && near.gain <= 1);
});

test('ardışık darbeler ana kanaldan yeniden ses üretir', () => {
  const one = Th.synth({ acoustic: verticalChannel(2000), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 5 });
  const two = Th.synth({ acoustic: verticalChannel(2000), strokes: [{ t: 0, amp: 1 }, { t: 0.5, amp: 0.8 }], listener: LISTENER, sampleRate: SR, seed: 5 });
  assert.ok(two.duration > one.duration + 0.4, `bir ${one.duration}, iki ${two.duration}`);
  assert.ok(two.energy > one.energy * 1.3, `enerji bir ${one.energy}, iki ${two.energy}`);
});

test('boş akustik dizi sessiz ama geçerli sonuç verir', () => {
  const r = Th.synth({ acoustic: new Float32Array(0), strokes: ONE, listener: LISTENER, sampleRate: SR, seed: 6 });
  assert.equal(r.data.length, 0);
  assert.equal(r.gain, 0);
});
