// Tarayıcı duman testi ve ekran görüntüleri (Playwright; yalnızca geliştirme için).
// Kurulum: npm i playwright-core  (ya da PW_CORE=/yol/node_modules/playwright-core)
// Kullanım: node tools/smoke.mjs --browser chromium|webkit --out klasor [--scenario calm,strike,rapid,nofloat] [--w 1600 --h 900]
// Senaryolar: calm, strike, rapid, nofloat, failfloat, kinds, slowmo, ui, mobile, perf, bright, a11y, edge, landscape
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

// #goster metninin, opaklığıyla birlikte koyu sahne (--ink) üzerindeki WCAG kontrast oranı
const SHOW_UI_CONTRAST = () => {
  const el = document.getElementById('goster'), cs = getComputedStyle(el);
  const rgba = (s) => { const v = s.match(/[\d.]+/g).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const ink = rgba(getComputedStyle(document.body).backgroundColor), fg = rgba(cs.color), bg = rgba(cs.backgroundColor);
  const op = Number(cs.opacity);
  const over = (c, a, base) => [0, 1, 2].map((i) => c[i] * a + base[i] * (1 - a));
  const bgIn = over(bg, bg[3], ink), txIn = over(fg, fg[3], bgIn);
  const bgPx = over(bgIn, op, ink), txPx = over(txIn, op, ink);
  const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const a = lum(txPx), b = lum(bgPx);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};


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
  const query = { nofloat: 'test&nofloat', failfloat: 'test&failfloat', bright: 'test&exp=' + (args.exp || 20) }[sc] || 'test';
  const { page, logs, state } = await open(query);
  r.state = state;
  try {
    if (!state.ready) throw new Error('hazır değil: ' + state.error);
    await page.evaluate(() => { window.__firtina.storm.params.auto = false; });
    if (sc === 'calm' || sc === 'nofloat' || sc === 'failfloat') {
      await page.evaluate(() => window.__firtina.step(16.7, 40));
      r.shots.push(await shot(page, sc));
    }
    if (sc === 'nofloat' || sc === 'failfloat') {
      // 8 bit yedek yolda bir çakışın parlama anı
      r.fallback = await page.evaluate(() => ({ floatRT: window.__firtina.renderer.floatRT, floatFailed: window.__firtina.renderer.floatFailed }));
      if (r.fallback.floatRT) throw new Error('yedek yol etkin değil');
      if (sc === 'failfloat' && !r.fallback.floatFailed) throw new Error('kayan noktalı hedef reddi yedeğe geçirmedi');
      await page.evaluate(() => window.__firtina.strikeAt(-900, -4200, 'cg'));
      if (!(await waitEvent(page, 1))) throw new Error('yıldırım başlamadı');
      await page.evaluate(() => {
        const f = window.__firtina, ev = f.storm.focus, target = ev.tStart + ev.tl.strokes[0].t + 0.01;
        const gap = target - 0.0167 - f.clock.simT;
        if (gap > 0) { f.clock.timeScale = gap / 0.05; f.step(50, 1); f.clock.timeScale = 1; }
        const remain = target - f.clock.simT;
        if (remain > 0) f.step(remain * 1000, 1);
      });
      r.shots.push(await shot(page, sc + '-flash'));
    }
    if (sc === 'a11y') {
      await page.close();
      r.checks = await a11yChecks();
      const failed = Object.entries(r.checks).filter(([, v]) => v !== true);
      if (failed.length) r.errors.push('başarısız: ' + failed.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', '));
      results.push(Object.assign(r, { logs: logs.slice(), ms: Date.now() - t0 }));
      continue;
    }
    if (sc === 'landscape') {
      // Yatay telefon ve kısa ekranlar: başlangıç kartının tamamı kaydırılarak okunur, eylem çubuğu ekranda kalır,
      // kartlar sahnenin çoğunu örtmez, ayarlar paneli ekran içinde kalır.
      await page.close();
      r.landscape = {};
      for (const vp of [{ width: 667, height: 375 }, { width: 844, height: 390 }, { width: 932, height: 430 }]) {
        const pg = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, hasTouch: true });
        await pg.goto(pathToFileURL(path.join(ROOT, page0)).href);
        await pg.waitForFunction(() => window.__firtina && window.__firtina.ready, null, { timeout: 60000 });
        const gate = await pg.evaluate(() => {
          const g = document.getElementById('baslangic'), card = g.querySelector('.gate__card');
          g.scrollTop = 0;
          return card.getBoundingClientRect().top >= 0;
        });
        await pg.click('#baslat');
        await pg.waitForTimeout(2500);
        const v = await pg.evaluate(() => {
          const H = innerHeight, W = innerWidth, rect = (id) => document.getElementById(id).getBoundingClientRect();
          const act = document.querySelector('.actions').getBoundingClientRect();
          const cover = ['son-cakis'].concat([...document.querySelectorAll('.hud')].map((e) => (e.id = e.id || 'hud-x'))).reduce((a, id) => {
            const r = rect(id); return a + (r.width * r.height) / (W * H);
          }, 0);
          // İpucu hapı görünürse kartlarla çakışmamalı
          const hint = document.getElementById('ipucu'), hs = getComputedStyle(hint);
          let hintClear = true;
          if (hs.display !== 'none' && !hint.classList.contains('faded')) {
            const h = hint.getBoundingClientRect();
            for (const el of [document.getElementById('son-cakis'), document.querySelector('.hud')]) {
              const r = el.getBoundingClientRect();
              if (h.left < r.right && h.right > r.left && h.top < r.bottom && h.bottom > r.top) hintClear = false;
            }
          }
          return { actionsInside: act.bottom <= H + 0.5 && act.top >= 0, cover: Math.round(cover * 100), hintClear };
        });
        await pg.click('#ayarlar-ac');
        await pg.waitForTimeout(300);
        const panel = await pg.evaluate(() => { const r = document.getElementById('ayarlar').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5; });
        r.shots.push(await shot(pg, `landscape-${vp.width}x${vp.height}`));
        await pg.close();
        const key = `${vp.width}x${vp.height}`;
        r.landscape[key] = { gate, ...v, panel };
        if (!gate || !v.actionsInside || v.cover > 45 || !v.hintClear || !panel) r.errors.push(`${key}: ${JSON.stringify(r.landscape[key])}`);
      }
      results.push(Object.assign(r, { logs: logs.slice(), ms: Date.now() - t0 }));
      continue;
    }
    if (sc === 'edge') {
      // En geniş açı ve en uç yatay dönüşte dünyanın kenarı görünmemeli (yatay ve dikey ekran).
      await page.close();
      for (const [name, vp] of [['yatay', { width: W, height: H }], ['dikey', { width: 390, height: 844 }]]) {
        const pg = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
        await pg.goto(pathToFileURL(path.join(ROOT, page0)).href + '?test');
        await pg.waitForFunction(() => window.__firtina && window.__firtina.ready, null, { timeout: 60000 });
        for (const side of [-1, 1]) {
          const cam = await pg.evaluate((side) => {
            const f = window.__firtina;
            f.storm.params.auto = false;
            f.ui.cam.fov = 68 * Math.PI / 180; f.ui.cam.yaw = side * 10; f.ui.cam.pitch = 0.5;
            f.step(16.7, 3);
            return { yaw: f.ui.cam.yaw, fov: f.renderer.effectiveFov() * 180 / Math.PI };
          }, side);
          (r.edge = r.edge || []).push(Object.assign({ name, side }, cam));
          r.shots.push(await shot(pg, `edge-${name}-${side < 0 ? 'sol' : 'sag'}`));
        }
        await pg.close();
      }
      results.push(Object.assign(r, { logs: logs.slice(), ms: Date.now() - t0 }));
      continue;
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
      // DBM üretimi tarayıcıda worker ile yapılmalı (file:// dahil); çökme yedeği ana iş parçacığına geçer.
      if (!(await page.evaluate(() => !!window.__firtina.storm.worker))) throw new Error('worker kullanılmıyor');
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

// Erişilebilirlik ve dayanıklılık denetimleri (gerçek başlangıç akışıyla)
async function a11yChecks() {
  const c = {};
  const fresh = async (vp, init) => {
    const pg = await browser.newPage({ viewport: vp || { width: W, height: H }, deviceScaleFactor: 1, hasTouch: !!(vp && vp.width < 500) });
    if (init) await pg.addInitScript(init);
    await pg.goto(pathToFileURL(path.join(ROOT, page0)).href);
    await pg.waitForFunction(() => window.__firtina && window.__firtina.ready, null, { timeout: 60000 });
    return pg;
  };
  let pg = await fresh();
  await pg.click('#baslat');
  await pg.waitForTimeout(400);
  // Ayarlar: açılınca odak kapatma düğmesinde, Esc ile kapanınca açma düğmesine döner
  await pg.click('#ayarlar-ac');
  c.panelFocusIn = await pg.evaluate(() => document.activeElement && document.activeElement.id === 'ayarlar-kapat');
  await pg.keyboard.press('Tab');
  await pg.keyboard.press('Escape');
  c.panelFocusBack = await pg.evaluate(() => document.getElementById('ayarlar').hidden && document.activeElement && document.activeElement.id === 'ayarlar-ac');
  // Zaman ölçeği kaydırıcısı ekran okuyucuya ham 0-1000 yerine anlamlı değer verir
  c.timeValueText = await pg.evaluate(() => {
    const el = document.getElementById('zaman-olcegi'), v0 = el.getAttribute('aria-valuetext');
    document.querySelector('.presets button[data-scale="100"]').click();
    const v1 = el.getAttribute('aria-valuetext');
    document.querySelector('.presets button[data-scale="1"]').click();
    return v0 === 'Gerçek zaman' && /100 kat yavaş/.test(v1 || '') ? true : [v0, v1];
  });
  // Basılı tutulan Boşluk: otomatik tekrar yeni çakış istemez
  await pg.evaluate(() => document.getElementById('ayarlar-ac').blur());
  await pg.waitForTimeout(500);
  c.keyRepeat = await pg.evaluate(() => {
    const s = window.__firtina.storm;
    const fire = (repeat) => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat, bubbles: true, cancelable: true }));
    fire(false);
    const t1 = s.lastUserStrike;
    s.lastUserStrike = -Infinity; // hız sınırını devre dışı bırak: yalnız tekrar süzgeci sınanır
    fire(true); fire(true);
    const ok = s.lastUserStrike === -Infinity && Number.isFinite(t1);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    return ok;
  });
  // Odaktaki "Yıldırım düşür" düğmesinde basılı tutulan Enter: 1 sn'de tek çakış
  await pg.evaluate(() => {
    const s = window.__firtina.storm, orig = s.strike.bind(s);
    s.lastUserStrike = -Infinity; window.__say = 0;
    s.strike = (t, k, o) => { const r = orig(t, k, o); if (o && o.user && r === 'ok') window.__say++; return r; };
  });
  await pg.focus('#dusur');
  for (let i = 0; i < 10; i++) { await pg.keyboard.down('Enter'); await pg.waitForTimeout(100); }
  await pg.keyboard.up('Enter');
  c.enterRepeat = await pg.evaluate(() => (window.__say === 1 ? true : window.__say));
  await pg.evaluate(() => document.activeElement.blur());
  // Pencere odağını kaybedince basılı ok tuşu bırakılmış sayılır
  c.blurClearsKeys = await pg.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const had = window.__firtina.ui.keysDown.size === 1;
    window.dispatchEvent(new Event('blur'));
    return had && window.__firtina.ui.keysDown.size === 0;
  });
  // η kaydırıcısı: art arda değişiklikler tek bir yeniden üretime dönüşür
  c.etaDebounce = await pg.evaluate(async () => {
    const s = window.__firtina.storm, el = document.getElementById('dallanma');
    const g0 = s.generation;
    for (const v of ['1.8', '1.9', '2.0']) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
    const mid = s.generation;
    await new Promise((r) => setTimeout(r, 600));
    return mid === g0 && s.generation === g0 + 1;
  });
  // Tekrar bitince önceki hıza dönülür; tekrar sırasında kullanıcı hız seçtiyse onun seçimi korunur
  await pg.waitForFunction(() => !!window.__firtina.storm.lastReplay, null, { timeout: 15000 }).catch(() => {});
  c.replayScale = await pg.evaluate(() => {
    const f = window.__firtina, ui = f.ui;
    if (!f.storm.lastReplay) return 'tekrar yok';
    ui.replay(); const during = f.clock.timeScale; ui.endReplay(); const back = f.clock.timeScale;
    ui.replay(); document.querySelector('.presets button[data-scale="1000"]').click(); ui.endReplay(); const kept = f.clock.timeScale;
    document.querySelector('.presets button[data-scale="1"]').click();
    return Math.abs(during - 1 / 200) < 1e-12 && back === 1 && Math.abs(kept - 1 / 1000) < 1e-12 ? true : [during, back, kept];
  });
  // Arayüz gizliyken "Arayüzü göster" düğmesi karanlık sahne üzerinde en az 4,5:1 kontrastlı okunur
  c.showUiContrast = await pg.evaluate(SHOW_UI_CONTRAST).then((v) => (v >= 4.5 ? true : v));
  // Grafik bağlamı kaybı: döngü durur, hata kartı ve yeniden yükleme düğmesi görünür
  c.contextLost = await pg.evaluate(async () => {
    const ext = window.__firtina.renderer.gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'uzantı yok';
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const el = document.getElementById('hata');
    return !el.hidden && el.querySelector('[data-hata-baslik]').textContent === 'Grafik bağlamı kaybedildi' &&
      document.activeElement === el.querySelector('[data-hata-yukle]');
  });
  await pg.close();
  // Web Audio yok: ses düğmesi devre dışı ve açıklamalı
  pg = await fresh(null, () => { delete window.AudioContext; delete window.webkitAudioContext; });
  await pg.click('#baslat');
  await pg.waitForTimeout(300);
  c.noAudio = await pg.evaluate(() => {
    const b = document.getElementById('ses');
    return b.disabled && b.getAttribute('aria-label') === 'Ses bu tarayıcıda kullanılamıyor' && !document.getElementById('bildirim').hidden;
  });
  await pg.close();
  // Dar ekran: açık ayarlar sayfası varken sahneye dokunmak sayfayı kapatır, yıldırım düşürmez
  pg = await fresh({ width: 390, height: 844 });
  await pg.click('#baslat');
  await pg.waitForTimeout(600);
  await pg.click('#ayarlar-ac');
  await pg.waitForTimeout(300);
  const before = await pg.evaluate(() => window.__firtina.storm.lastUserStrike);
  await pg.mouse.click(195, 150);
  await pg.waitForTimeout(200);
  c.sheetTapCloses = await pg.evaluate((before) => document.getElementById('ayarlar').hidden && window.__firtina.storm.lastUserStrike === before, before);
  await pg.close();
  return c;
}

fs.writeFileSync(path.join(outDir, `${browserName}-sonuc.json`), JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`${browserName} ${r.scenario}: ${r.errors.length ? 'HATA ' + r.errors.join(' | ') : 'tamam'} (${r.ms} ms) gl=${r.state && r.state.gl} float=${r.state && r.state.floatRT} glError=${r.glError}`);
  for (const l of r.logs) console.log('   ' + l.slice(0, 400));
  if (r.info) console.log('   bilgi: ' + JSON.stringify(r.info).slice(0, 400));
  if (r.times) console.log('   zamanlar: ' + r.times.map((t) => (t * 1000).toFixed(3) + ' ms').join(', '));
  if (r.perf) console.log('   performans: ' + JSON.stringify(r.perf));
  if (r.uiState) console.log('   arayüz: ' + JSON.stringify(r.uiState));
  if (r.kinds) console.log('   türler: ' + JSON.stringify(r.kinds));
  if (r.checks) console.log('   denetimler: ' + JSON.stringify(r.checks));
  if (r.edge) console.log('   kenar: ' + JSON.stringify(r.edge));
  if (r.landscape) console.log('   yatay: ' + JSON.stringify(r.landscape));
  if (r.fallback) console.log('   yedek: ' + JSON.stringify(r.fallback));
}
