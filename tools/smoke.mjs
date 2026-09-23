// Tarayıcı duman testi ve ekran görüntüleri (Playwright; yalnızca geliştirme için).
// Kurulum: npm i playwright-core  (ya da PW_CORE=/yol/node_modules/playwright-core)
// Kullanım: node tools/smoke.mjs --browser chromium|webkit --out klasor [--scenario calm,strike,rapid,nofloat] [--w 1600 --h 900]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';

const require = createRequire(import.meta.url);
const pw = process.env.PW_CORE ? require(process.env.PW_CORE) : await import('playwright-core');
const browserName = args.browser || 'chromium';
const outDir = path.resolve(args.out || 'duman');
fs.mkdirSync(outDir, { recursive: true });
const W = Number(args.w || 1600), H = Number(args.h || 900);
const scenarios = (args.scenario || 'calm,strike,rapid,nofloat').split(',');
const page0 = args.page || 'index.html';

const launchArgs = browserName === 'chromium'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
  : [];
const browser = await pw[browserName].launch({ headless: true, args: launchArgs });
const results = [];

async function open(query) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const url = pathToFileURL(path.join(ROOT, page0)).href + (query ? '?' + query : '');
  await page.goto(url);
  await page.waitForFunction(() => window.__firtina && ('ready' in window.__firtina), null, { timeout: 60000 });
  const state = await page.evaluate(() => ({ ready: window.__firtina.ready, error: window.__firtina.error || null,
    floatRT: window.__firtina.renderer ? window.__firtina.renderer.floatRT : null,
    worldMs: window.__firtina.worldMs,
    gl: (() => { const r = window.__firtina.renderer; if (!r) return null; const gl = r.gl; const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() }));
  return { page, logs, state };
}

async function shot(page, name) {
  const file = path.join(outDir, `${browserName}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

// Olay başlayana kadar kare ilerletir (worker eşzamansızdır).
async function waitEvent(page, count) {
  for (let i = 0; i < 400; i++) {
    const n = await page.evaluate(() => window.__firtina.storm.events.filter((e) => e.bolt).length);
    if (n >= count) return true;
    await page.evaluate(() => window.__firtina.step(1, 1));
    await page.waitForTimeout(15);
  }
  return false;
}

for (const sc of scenarios) {
  const t0 = Date.now();
  const r = { scenario: sc, shots: [], errors: [] };
  const { page, logs, state } = await open(sc === 'nofloat' ? 'test&nofloat' : sc === 'bright' ? 'test&exp=' + (args.exp || 20) : 'test');
  r.state = state;
  try {
    if (!state.ready) throw new Error('hazır değil: ' + state.error);
    await page.evaluate(() => { window.__firtina.storm.params.auto = false; });
    if (sc === 'calm' || sc === 'nofloat') {
      await page.evaluate(() => window.__firtina.step(16.7, 40));
      r.shots.push(await shot(page, sc));
    }
    if (sc === 'perf') {
      // Gerçek zamanlı döngü: 6 sn boyunca kare sayısı ve uyarlamalı kalite düzeyi
      await page.close();
      const o = await open('');
      await o.page.evaluate(() => { window.__firtina.storm.params.rate = 20; });
      const f0 = await o.page.evaluate(() => window.__firtina.frames);
      await o.page.waitForTimeout(6000);
      r.perf = await o.page.evaluate((f0) => ({ fps: (window.__firtina.frames - f0) / 6, quality: window.__firtina.renderer.quality, size: [window.__firtina.renderer.targets.W, window.__firtina.renderer.targets.H], events: window.__firtina.storm.events.length }), f0);
      r.shots.push(await shot(o.page, 'perf'));
      logs.push(...o.logs);
      await o.page.close();
      results.push(Object.assign(r, { logs: logs.slice(), ms: Date.now() - t0 }));
      continue;
    }
    if (sc === 'ui' || sc === 'mobile') {
      // Gerçek başlangıç akışı: başlangıç kartı, Başlat, ilk yıldırım, ayarlar paneli
      await page.close();
      const vp = sc === 'mobile' ? { width: 390, height: 844 } : { width: W, height: H };
      const pg = await browser.newPage({ viewport: vp, deviceScaleFactor: sc === 'mobile' ? 2 : 1, hasTouch: sc === 'mobile' });
      const lg = [];
      pg.on('console', (m) => lg.push(`[${m.type()}] ${m.text()}`));
      pg.on('pageerror', (e) => lg.push(`[pageerror] ${e.message}`));
      await pg.goto(pathToFileURL(path.join(ROOT, page0)).href);
      await pg.waitForFunction(() => window.__firtina && window.__firtina.ready, null, { timeout: 60000 });
      await pg.waitForTimeout(800);
      r.shots.push(await shot(pg, sc + '-1-gate'));
      await pg.click('#baslat');
      await pg.waitForFunction(() => window.__firtina.storm.events.some((e) => e.bolt), null, { timeout: 15000 }).catch(() => {});
      await pg.waitForTimeout(sc === 'mobile' ? 120 : 60);
      r.shots.push(await shot(pg, sc + '-2-strike'));
      await pg.waitForTimeout(1500);
      r.shots.push(await shot(pg, sc + '-3-after'));
      await pg.click('#ayarlar-ac');
      await pg.waitForTimeout(400);
      r.shots.push(await shot(pg, sc + '-4-panel'));
      r.uiState = await pg.evaluate(() => ({ phase: document.getElementById('evre-ad').textContent, stats: document.getElementById('cakis-turu').textContent, thunder: document.getElementById('gg-metin').textContent, overflowX: document.documentElement.scrollWidth > window.innerWidth }));
      logs.push(...lg);
      await pg.close();
      results.push(Object.assign(r, { logs: logs.slice(), ms: Date.now() - t0 }));
      continue;
    }
    if (sc === 'kinds') {
      // Her olay türü için tepe anı: [ad, x, z, tür, göreli zaman]
      const cases = [['ic', 900, -6000, 'ic', 'ic'], ['spider', -300, -2400, 'spider', 0.35], ['cgp', 1500, -7800, 'cgp', null],
        ['tower', 720, -2150, 'cg', null], ['lake', 250, -520, 'cg', null], ['far', -2600, -10500, 'cg', null]];
      await page.evaluate(() => window.__firtina.step(16.7, 5));
      for (const [name, x, z, kind, tRel] of cases) {
        const n0 = await page.evaluate(() => window.__firtina.storm.eventId);
        await page.evaluate(({ x, z, kind }) => window.__firtina.strikeAt(x, z, kind), { x, z, kind });
        for (let i = 0; i < 300; i++) {
          const ok = await page.evaluate((n0) => { const f = window.__firtina.storm.focus; return !!f && f.id >= n0; }, n0);
          if (ok) break;
          await page.evaluate(() => window.__firtina.step(1, 1));
          await page.waitForTimeout(15);
        }
        const t = await page.evaluate(({ tRel }) => {
          const f = window.__firtina, ev = f.storm.focus;
          const target = tRel === 'ic' ? ev.tl.strokes[0].t + 0.004 : tRel != null ? tRel : ev.tl.strokes[0].t + 0.01;
          const ts = f.clock.timeScale, gap = ev.tStart + target - 0.0167 * ts - f.clock.simT;
          if (gap > 0) { f.clock.timeScale = gap / 0.05; f.step(50, 1); f.clock.timeScale = ts; }
          const remain = ev.tStart + target - f.clock.simT;
          if (remain > 0) f.step(remain / ts * 1000, 1);
          return { kind: ev.kind, surface: ev.stats.surface, t: f.clock.simT - ev.tStart };
        }, { tRel });
        r.shots.push(await shot(page, 'kind-' + name));
        (r.kinds = r.kinds || []).push(Object.assign({ name }, t));
        await page.evaluate(() => { const f = window.__firtina; f.clock.timeScale = 50; f.step(40, 3); f.clock.timeScale = 1; f.step(16.7, 2); });
      }
    }
    if (sc === 'slowmo') {
      // Yüksek hızlı kamera: bağlantı öncüleri ve kanal boyunca ilerleyen dönüş darbesi cephesi
      await page.evaluate(() => { const f = window.__firtina; f.step(16.7, 5); f.clock.timeScale = 1 / 5000; f.strikeAt(-500, -2600, 'cg'); });
      if (!(await waitEvent(page, 1))) throw new Error('yıldırım başlamadı');
      const go = (rel) => page.evaluate(({ rel }) => {
        const f = window.__firtina, ev = f.storm.focus, ts = f.clock.timeScale;
        const target = ev.tStart + rel(ev);
        const gap = target - 0.0167 * ts - f.clock.simT;
        if (gap > 0) { f.clock.timeScale = gap / 0.05; f.step(50, 1); f.clock.timeScale = ts; }
        const remain = target - f.clock.simT;
        if (remain > 0) f.step(remain / ts * 1000, 1);
        return f.clock.simT - ev.tStart;
      }, { rel });
      r.times = [];
      r.times.push(await page.evaluate(() => { const f = window.__firtina, ev = f.storm.focus, ts = f.clock.timeScale; const target = ev.tStart + ev.tl.leaderDur * 0.994; const gap = target - 0.0167 * ts - f.clock.simT; if (gap > 0) { f.clock.timeScale = gap / 0.05; f.step(50, 1); f.clock.timeScale = ts; } const remain = target - f.clock.simT; if (remain > 0) f.step(remain / ts * 1000, 1); return f.clock.simT - ev.tStart; }));
      r.shots.push(await shot(page, 'slowmo-1-attach'));
      r.times.push(await page.evaluate(() => { const f = window.__firtina, ev = f.storm.focus, ts = f.clock.timeScale; const target = ev.tStart + ev.tl.strokes[0].t + 1.2e-5; const gap = target - 0.0167 * ts - f.clock.simT; if (gap > 0) { f.clock.timeScale = gap / 0.05; f.step(50, 1); f.clock.timeScale = ts; } const remain = target - f.clock.simT; if (remain > 0) f.step(remain / ts * 1000, 1); return f.clock.simT - ev.tStart; }));
      r.shots.push(await shot(page, 'slowmo-2-front'));
    }
    if (sc === 'bright') {
      // Yüksek pozlama: karanlıkta bulut dokusu var mı?
      await page.evaluate(() => { window.__firtina.exposure = Number(new URLSearchParams(location.search).get('exp') || 20); window.__firtina.step(16.7, 20); });
      r.shots.push(await shot(page, 'bright'));
    }
    if (sc === 'strike') {
      const x = Number(args.x || -900), z = Number(args.z || -4200);
      await page.evaluate(() => window.__firtina.step(16.7, 10));
      // Yavaş çekim: öncü evresi görünür
      await page.evaluate(({ x, z }) => { const f = window.__firtina; f.clock.timeScale = 0.01; f.strikeAt(x, z, 'cg'); }, { x, z });
      if (!(await waitEvent(page, 1))) throw new Error('yıldırım başlamadı');
      const info = await page.evaluate(() => { const ev = window.__firtina.storm.focus; return { leader: ev.tl.leaderDur, strokes: ev.tl.strokes.map((s) => +s.t.toFixed(4)), start: ev.tStart, sim: window.__firtina.clock.simT, stats: ev.stats }; });
      r.info = info;
      // Hedef zamana git: büyük aralık geçici zaman ölçeğiyle atlanır, son kare doğru ölçekte çizilir
      // (saat kare başına en fazla 0,1 sn duvar süresi ilerler).
      const stepTo = async (tRel) => page.evaluate(({ tRel }) => {
        const f = window.__firtina, ev = f.storm.focus, ts = f.clock.timeScale;
        const target = ev.tStart + tRel;
        const gap = target - 0.0167 * ts - f.clock.simT;
        if (gap > 0) { f.clock.timeScale = gap / 0.05; f.step(50, 1); f.clock.timeScale = ts; }
        const remain = target - f.clock.simT;
        if (remain > 0) f.step(remain / ts * 1000, 1);
        return f.clock.simT - ev.tStart;
      }, { tRel });
      r.times = [];
      r.times.push(await stepTo(info.leader * 0.6));
      r.shots.push(await shot(page, 'strike-1-leader'));
      r.times.push(await stepTo(info.strokes[0] + 0.00002));
      r.shots.push(await shot(page, 'strike-2-return'));
      await page.evaluate(() => { window.__firtina.clock.timeScale = 1; });
      r.times.push(await stepTo(info.strokes[0] + 0.012));
      r.shots.push(await shot(page, 'strike-3-flash'));
      r.times.push(await stepTo(info.strokes[0] + 0.12));
      r.shots.push(await shot(page, 'strike-4-after'));
    }
    if (sc === 'rapid') {
      await page.evaluate(() => {
        const f = window.__firtina;
        for (let i = 0; i < 30; i++) { f.strikeAt(-3000 + i * 200, -3000 - (i % 5) * 900, i % 7 === 0 ? 'ic' : 'cg'); f.step(16.7, 1); }
      });
      for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__firtina.step(16.7, 3)); await page.waitForTimeout(10); }
      r.shots.push(await shot(page, 'rapid'));
      r.events = await page.evaluate(() => window.__firtina.storm.events.length);
    }
    r.glError = await page.evaluate(() => window.__firtina.glError());
  } catch (e) {
    r.errors.push(String(e.message || e));
  }
  r.logs = logs.filter((l) => !l.includes('GPU stall due to ReadPixels'));
  r.ms = Date.now() - t0;
  results.push(r);
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, `${browserName}-sonuc.json`), JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`${browserName} ${r.scenario}: ${r.errors.length ? 'HATA ' + r.errors.join(' | ') : 'tamam'} (${r.ms} ms) gl=${r.state && r.state.gl} float=${r.state && r.state.floatRT} glError=${r.glError}`);
  for (const l of r.logs) console.log('   ' + l.slice(0, 400));
  if (r.info) console.log('   bilgi: ' + JSON.stringify(r.info).slice(0, 400));
  if (r.times) console.log('   zamanlar: ' + r.times.map((t) => (t * 1000).toFixed(3) + ' ms').join(', '));
  if (r.perf) console.log('   performans: ' + JSON.stringify(r.perf));
  if (r.uiState) console.log('   arayüz: ' + JSON.stringify(r.uiState));
  if (r.kinds) console.log('   türler: ' + JSON.stringify(r.kinds));
}
