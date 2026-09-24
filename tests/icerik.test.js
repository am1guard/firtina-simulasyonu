'use strict';
// İçerik kuralları: emoji yok, arayüz renkleri ve ölçüleri belirteçlerden gelir, güvenlik metni tutarlı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers.js');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '.superpowers', '__pycache__'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|css|js|mjs|md|py|json)$/.test(e.name)) out.push(p);
  }
  return out;
}
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

test('proje dosyalarında emoji yoktur', () => {
  const bad = [];
  for (const f of walk(ROOT, [])) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (EMOJI.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});

test('bileşen stillerinde ham renk ve 2px üstü ham ölçü yoktur (belirteç kullanılır)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const lines = css.split('\n');
  const bad = [];
  let inRoot = false;
  lines.forEach((line, i) => {
    if (/^:root\s*\{/.test(line)) { inRoot = true; return; }
    if (inRoot) { if (/^\}/.test(line)) inRoot = false; return; }
    const l = line.replace(/\/\*.*?\*\//g, '');
    if (/^\s*@media/.test(l)) return;
    if (/#[0-9a-fA-F]{3,8}\b/.test(l) || /rgba?\(/.test(l)) bad.push(`${i + 1}: ${l.trim()}`);
    const px = [...l.replace(/env\([^)]*\)/g, '').matchAll(/(-?\d*\.?\d+)px/g)].map((m) => Math.abs(parseFloat(m[1]))).filter((v) => v > 2);
    if (px.length) bad.push(`${i + 1}: ${l.trim()}`);
  });
  assert.deepEqual(bad, []);
});

test('arayüz betiğinde ham renk yoktur (renkler CSS belirteçlerinden okunur)', () => {
  const js = fs.readFileSync(path.join(ROOT, 'js/ui/ui.js'), 'utf8');
  const bad = js.split('\n').map((l, i) => [l, i + 1])
    .filter(([l]) => /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(l) || /rgba?\(/.test(l)).map(([l, n]) => `${n}: ${l.trim()}`);
  assert.deepEqual(bad, []);
});

test('başlangıç kartındaki ışığa duyarlılık metni anahtarın varsayılanıyla çelişmez', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/modunu açık tut/.test(html));
  assert.ok(/yumuşak parlama modunu aç/.test(html));
});
