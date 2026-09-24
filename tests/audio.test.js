'use strict';
// Ses motoru: Web Audio düğümleri sahte bir bağlamla sınanır (gerçek AudioContext Node'da yok).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFirtina } = require('./helpers.js');

const F = loadFirtina(['js/audio/audio.js']);

function fakeEngine() {
  const started = [];
  const node = () => ({ connect() {}, gain: { value: 1 }, pan: { value: 0 } });
  const ctx = {
    currentTime: 100, sampleRate: 22050,
    createBuffer: (ch, n, sr) => ({ duration: n / sr, getChannelData: () => new Float32Array(n) }),
    createBufferSource: () => ({ connect() {}, start: (...a) => started.push(a), set onended(f) {} }),
    createGain: node, createStereoPanner: node,
  };
  const eng = new F.AudioEngine();
  Object.assign(eng, { ok: true, ctx, thunderBus: node() });
  return { eng, started };
}

test('geç gelen gök gürültüsü olması gereken yerinden (ofsetle) başlar', () => {
  const { eng, started } = fakeEngine();
  eng.playThunder({ data: new Float32Array(22050 * 20), sampleRate: 22050, gain: 1 }, -4, 0);
  assert.equal(started.length, 1);
  assert.equal(started[0][0], 100);
  assert.ok(Math.abs(started[0][1] - 4) < 1e-9, `ofset ${started[0][1]}`);
});

test('zamanında gelen gök gürültüsü gecikmeyle ve ofsetsiz başlar; tamamen geçmiş olan çalınmaz', () => {
  const { eng, started } = fakeEngine();
  eng.playThunder({ data: new Float32Array(22050 * 20), sampleRate: 22050, gain: 1 }, 2.5, 0);
  assert.deepEqual(started[0], [102.5, 0]);
  eng.playThunder({ data: new Float32Array(22050 * 2), sampleRate: 22050, gain: 1 }, -3, 0);
  assert.equal(started.length, 1, 'bitmiş ses çalınmamalı');
});
