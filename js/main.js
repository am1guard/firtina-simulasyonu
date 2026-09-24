/* Yıldırım Gözlemevi — önyükleme ve ana döngü.
 * URL parametreleri (yerel test için): ?test (elle saat, çizim tamponu korunur), ?nofloat (RGBA8 yedek yolu),
 * ?failfloat (kayan noktalı hedef reddedilmiş gibi davranır; yedeğe geçişi dener), ?noworker (DBM ana iş
 * parçacığında), ?q=0..3 (sabit kalite). */
(function () {
  'use strict';
  const F = window.FIRTINA;
  const qs = new URLSearchParams(location.search);
  const TEST = qs.has('test');
  const canvas = document.getElementById('sahne');

  function fatal(title, detail) {
    const el = document.getElementById('hata');
    if (el) {
      el.hidden = false;
      el.querySelector('[data-hata-baslik]').textContent = title;
      el.querySelector('[data-hata-ayrinti]').textContent = detail || '';
      const reload = el.querySelector('[data-hata-yukle]');
      if (reload) { reload.onclick = () => location.reload(); reload.focus(); }
    }
    console.error(title + (detail ? '\n' + detail : ''));
    window.__firtina = { ready: false, error: title + (detail ? '\n' + detail : '') };
  }

  let renderer;
  try {
    renderer = new F.Renderer(canvas, {
      preserve: TEST,
      noFloat: qs.has('nofloat'),
      failFloat: qs.has('failfloat'),
      quality: qs.has('q') ? Number(qs.get('q')) : undefined,
    });
  } catch (e) {
    if (e.code === 'WEBGL2') {
      fatal('Tarayıcın WebGL2 desteklemiyor', 'Güncel bir Chrome, Safari, Firefox ya da Edge sürümüyle yeniden dene ve donanım hızlandırmanın açık olduğundan emin ol.');
    } else {
      fatal('Görüntü hattı başlatılamadı', String((e && e.message) || e));
    }
    return;
  }

  // GPU sıfırlanırsa (sürücü çökmesi, bellek baskısı) döngü durur ve yeniden yükleme önerilir.
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    if (window.__firtina && window.__firtina.audio) window.__firtina.audio.setPaused(true);
    fatal('Grafik bağlamı kaybedildi', 'Tarayıcı ya da sürücü GPU\'yu sıfırladı. Simülasyonu sürdürmek için sayfayı yeniden yükle.');
  });

  const tWorld = performance.now();
  renderer.setWorld(F.Terrain.buildMesh(), F.Terrain.buildVillage());
  const worldMs = performance.now() - tWorld;

  const audio = new F.AudioEngine();
  const clock = new F.Lum.Clock();
  let ui = null;
  const storm = new F.Storm({
    renderer, audio,
    seed: TEST ? 12345 : undefined,
    noWorker: qs.has('noworker'),
    onEvent: (type, data) => { if (ui) ui.onStormEvent(type, data); },
  });
  if (F.UI) ui = new F.UI({ storm, renderer, audio, clock, canvas, test: TEST });

  // Uyarlamalı kalite: kare süresi uzun süre 24 ms'yi aşarsa kaliteyi düşürür.
  let emaMs = 16.7, qTimer = 0;
  const fixedQuality = TEST || qs.has('q');
  function adapt(dtWall) {
    if (fixedQuality || renderer.autoQuality === false || dtWall <= 0) return;
    emaMs = emaMs * 0.94 + dtWall * 1000 * 0.06;
    qTimer += dtWall;
    if (qTimer < 2.5) return;
    if (emaMs > 24 && renderer.quality > 0) { renderer.setQuality(renderer.quality - 1); qTimer = 0; emaMs = 16.7; }
    else if (emaMs < 12 && renderer.quality < 3 && qTimer > 8) { renderer.setQuality(renderer.quality + 1); qTimer = 0; }
  }

  let frames = 0;
  function frame(now) {
    const { dtWall, dtSim } = clock.tick(now);
    storm.update(clock.simT, clock.wallT, dtSim, dtWall, clock.timeScale);
    audio.update(dtWall);
    renderer.resize();
    const api = window.__firtina;
    renderer.render(storm.frame(dtWall, api && api.exposure != null ? api.exposure : (ui ? ui.exposure : 2.4)));
    if (ui) ui.update(dtWall);
    adapt(dtWall);
    frames++;
  }

  function loop(now) {
    if (lost) return;
    try {
      frame(now);
    } catch (e) {
      fatal('Beklenmeyen bir hata oluştu', String((e && e.stack) || e));
      return;
    }
    requestAnimationFrame(loop);
  }
  if (!TEST) requestAnimationFrame(loop);

  let manualNow = 0;
  window.__firtina = {
    ready: true, renderer, storm, audio, clock, ui, worldMs,
    get frames() { return frames; },
    step(ms, n) { for (let i = 0; i < (n || 1); i++) { manualNow += ms; frame(manualNow); } },
    strikeAt(x, z, kind) { return storm.strike(F.Terrain.targetAt(x, z), kind); },
    glError() { const gl = renderer.gl; return gl.getError(); },
  };
})();
