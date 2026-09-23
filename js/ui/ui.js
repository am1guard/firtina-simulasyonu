/* Yıldırım Gözlemevi — arayüz denetleyicisi.
 * Başlangıç kartı, ölçüm cihazı (evre, zaman kodu, ışık eğrisi), son çakış kartı ve gök gürültüsü geri sayımı,
 * ayarlar, klavye kısayolları ve kamera etkileşimi (sürükle, tekerlek, iki parmak, ok tuşları). */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};
  const T = F.Terrain, M = F.math;

  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf3 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const SURFACE = { 'kule': 'Radyo kulesi', 'göl': 'Göl yüzeyi', 'köy': 'Köy', 'orman': 'Orman', 'tepe': 'Tepe', 'dağ': 'Dağ', 'bulut': 'Bulut', 'bulut tabanı': 'Bulut tabanı' };
  const TYPE_KEYS = ['karisik', 'cg', 'cgp', 'ic', 'spider'];
  const TYPE_HELP = {
    karisik: 'Doğadaki karışım: çoğu bulut içi, bir kısmı buluttan yere.',
    cg: 'En yaygın buluttan yere yıldırım: dallanan basamaklı öncü ve genellikle 3-5 dönüş darbesi.',
    cgp: 'Örs bulutundan gelen, az dallı, tek güçlü darbeli ve uzun sürekli akımlı yıldırım.',
    ic: 'Bulutun içinde kalan boşalma: kanal görünmez, bulut içeriden titreşerek aydınlanır.',
    spider: 'Bulut tabanı boyunca kilometrelerce yatay yayılan, ağ gibi dallanan kanallar.',
  };
  const MAX_SLOW = 20000;
  const sliderToScale = (v) => Math.pow(MAX_SLOW, -v / 1000);
  const scaleToSlider = (s) => Math.round(-Math.log(Math.max(s, 1 / MAX_SLOW)) / Math.log(MAX_SLOW) * 1000);
  const REPLAY_SCALE = 1 / 200;

  function formatScale(s) {
    if (s >= 0.999) return '×1';
    const d = 1 / s;
    return '×1/' + (d < 10 ? nf1.format(d) : nf0.format(Math.round(d)));
  }
  function formatTime(t) {
    if (!Number.isFinite(t)) return '—';
    const a = Math.abs(t), sign = t < 0 ? '−' : '';
    if (a < 1) return `${sign}${nf3.format(a * 1000)} ms`;
    return `${sign}${nf3.format(a)} s`;
  }
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  class UI {
    constructor(o) {
      this.storm = o.storm;
      this.renderer = o.renderer;
      this.audio = o.audio;
      this.clock = o.clock;
      this.canvas = o.canvas;
      this.test = !!o.test;
      this.$ = (id) => document.getElementById(id);
      this.reduced = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
      this.exposureEV = 0;
      this.started = false;
      this.paused = false;
      this.muted = false;
      this.mode = 'karisik';
      this.cam = { yaw: 0, pitch: 0.075, fov: 50 * Math.PI / 180, vy: 0, vp: 0 };
      this.keysDown = new Set();
      this.pointers = new Map();
      this.curve = { id: -1, img: null, t0: -0.01, t1: 0.4, peak: 1 };
      this.thunder = null;
      this.phase = { shown: 'Sakin', key: 'sakin', shownAt: 0, pending: null };
      this.replaying = null;
      this.domTimer = 0;
      this.fpsEma = 60;
      this.hintTimer = 0;
      this.lastAnnounce = -10;
      this.colors = { plasma: cssVar('--plasma') || '#f5f3ff', ion: cssVar('--ion') || '#aeb8ff', sodium: cssVar('--sodium') || '#f4b860', line: 'rgba(168,178,222,0.16)', dim: cssVar('--text-dim') || '#a3abc4' };
      this.bind();
      this.prestart();
    }

    get exposure() { return 2.4 * Math.pow(2, this.exposureEV); }

    // ---------- Başlangıç ----------
    prestart() {
      const soft = this.reduced;
      this.setSwitch('gate-yumusak', soft);
      this.setSwitch('yumusak', soft);
      Object.assign(this.storm.params, { auto: true, mode: 'ic', rate: 5, soft: true });
      this.renderer.autoQuality = true;
      this.updateRangeFills();
      if (this.test) { this.$('baslangic').hidden = true; this.started = true; Object.assign(this.storm.params, { mode: 'karisik', rate: 7, soft: false }); return; }
      requestAnimationFrame(() => this.$('baslat').focus());
    }

    start() {
      if (this.started) return;
      this.started = true;
      const soft = this.$('gate-yumusak').getAttribute('aria-checked') === 'true';
      const sound = this.$('gate-ses').getAttribute('aria-checked') === 'true';
      this.setSwitch('yumusak', soft);
      if (sound) { this.audio.init(); this.audio.setRain(this.storm.params.rain); }
      this.setMuted(!sound);
      Object.assign(this.storm.params, { mode: this.mode, rate: Number(this.$('siddet').value), soft });
      this.storm.autoTimer = 6;
      const gate = this.$('baslangic');
      gate.classList.add('leaving');
      setTimeout(() => { gate.hidden = true; }, this.reduced ? 0 : 320);
      this.$('dusur').focus();
      // İlk izlenim: kısa bir sessizlikten sonra görüş alanında bir yıldırım.
      setTimeout(() => this.strikeRandom('cg', 2600, 5200, true), 1400);
    }

    // ---------- Olay bağları ----------
    bind() {
      const $ = this.$;
      $('baslat').addEventListener('click', () => this.start());
      for (const id of ['gate-yumusak', 'gate-ses']) $(id).addEventListener('click', () => this.setSwitch(id, $(id).getAttribute('aria-checked') !== 'true'));
      $('baslangic').addEventListener('keydown', (e) => this.trapFocus(e, $('baslangic')));

      $('dusur').addEventListener('click', () => this.strikeRandom());
      $('tekrar').addEventListener('click', () => this.replay());
      $('duraklat').addEventListener('click', () => this.togglePause());
      $('ses').addEventListener('click', () => this.setMuted(!this.muted));
      $('ayarlar-ac').addEventListener('click', () => this.togglePanel());
      $('ayarlar-kapat').addEventListener('click', () => this.togglePanel(false));
      $('gizle').addEventListener('click', () => this.toggleUI());
      $('goster').addEventListener('click', () => this.toggleUI());
      $('tam-ekran').addEventListener('click', () => this.toggleFullscreen());

      for (const r of document.querySelectorAll('input[name="tur"]')) r.addEventListener('change', () => { if (r.checked) this.setMode(r.value); });
      $('dallanma').addEventListener('input', () => { $('dallanma-deger').textContent = nf1.format(Number($('dallanma').value)); this.updateRangeFills(); });
      $('dallanma').addEventListener('change', () => this.storm.setParam('eta', Number($('dallanma').value)));
      $('siddet').addEventListener('input', () => {
        const v = Number($('siddet').value);
        $('siddet-deger').textContent = v ? `${v}/dk` : 'kapalı';
        if (this.started) this.storm.setParam('rate', v);
        this.updateRangeFills();
      });
      $('otomatik').addEventListener('click', () => {
        const on = $('otomatik').getAttribute('aria-checked') !== 'true';
        this.setSwitch('otomatik', on);
        this.storm.setParam('auto', on);
      });
      $('yagmur').addEventListener('input', () => {
        const v = Number($('yagmur').value);
        $('yagmur-deger').textContent = `%${v}`;
        this.storm.setParam('rain', v / 100);
        this.updateRangeFills();
      });
      $('zaman-olcegi').addEventListener('input', () => this.setTimeScale(sliderToScale(Number($('zaman-olcegi').value)), true));
      for (const b of document.querySelectorAll('.presets button')) b.addEventListener('click', () => this.setTimeScale(1 / Number(b.dataset.scale)));
      $('ses-duzeyi').addEventListener('input', () => {
        const v = Number($('ses-duzeyi').value);
        $('ses-deger').textContent = `%${v}`;
        this.audio.setVolume(v / 100);
        this.updateRangeFills();
      });
      $('parlaklik').addEventListener('input', () => {
        this.exposureEV = Number($('parlaklik').value);
        const s = this.exposureEV > 0 ? '+' : this.exposureEV < 0 ? '−' : '';
        $('parlaklik-deger').textContent = `${s}${nf1.format(Math.abs(this.exposureEV)).replace(',0', '')} EV`;
        this.updateRangeFills();
      });
      $('yumusak').addEventListener('click', () => {
        const on = $('yumusak').getAttribute('aria-checked') !== 'true';
        this.setSwitch('yumusak', on);
        this.storm.setParam('soft', on);
      });
      $('kalite').addEventListener('change', () => {
        const v = $('kalite').value;
        this.renderer.autoQuality = v === 'auto';
        if (v !== 'auto') this.renderer.setQuality(Number(v));
      });

      // Kamera ve tıklama
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      c.addEventListener('pointermove', (e) => this.onPointerMove(e));
      c.addEventListener('pointerup', (e) => this.onPointerUp(e));
      c.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); c.classList.remove('dragging'); });
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

      root.addEventListener('keydown', (e) => this.onKey(e, true));
      root.addEventListener('keyup', (e) => this.onKey(e, false));
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.audio.setPaused(true);
        else if (!this.paused) this.audio.setPaused(false);
      });
      root.addEventListener('resize', () => this.renderer.resize());
    }

    trapFocus(e, container) {
      if (e.key !== 'Tab') return;
      const f = [...container.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    setSwitch(id, on) { this.$(id).setAttribute('aria-checked', on ? 'true' : 'false'); }

    updateRangeFills() {
      for (const r of document.querySelectorAll('input[type="range"]')) {
        const p = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)) * 100;
        r.style.setProperty('--fill', `${p}%`);
      }
    }

    // ---------- Eylemler ----------
    kindForStrike() { return this.mode === 'karisik' ? 'cg' : this.mode; }

    strikeRandom(kind, minD, maxD, auto) {
      if (!this.started) return;
      const az = this.cam.yaw + (Math.random() - 0.5) * 0.75;
      const lo = minD || 1800, hi = maxD || 9000;
      const d = Math.exp(M.lerp(Math.log(lo), Math.log(hi), Math.random()));
      const cam = T.CAMERA_POS;
      const target = T.targetAt(cam[0] + Math.sin(az) * d, cam[2] - Math.cos(az) * d);
      this.fireStrike(target, kind || this.kindForStrike(), null, auto);
    }

    strikeAtScreen(x, y) {
      const ray = this.renderer.screenRay(x, y);
      const target = T.pickTarget(ray.origin, ray.dir);
      this.fireStrike(target, this.kindForStrike(), [x, y]);
    }

    fireStrike(target, kind, screen, auto) {
      const ok = this.storm.strike(target, kind, { user: !auto });
      if (!ok) { this.toast('Yıldırımlar hazırlanıyor, birazdan tekrar dene.'); return; }
      if (screen) this.reticle(screen[0], screen[1]);
      if (!auto) this.$('ipucu').classList.add('faded');
    }

    reticle(x, y) {
      const r = this.$('nisan');
      r.style.left = `${x}px`; r.style.top = `${y}px`;
      r.classList.remove('go');
      void r.offsetWidth;
      r.classList.add('go');
    }

    replay() {
      if (!this.storm.lastReplay) return;
      const prev = this.replaying ? this.replaying.prev : this.clock.timeScale;
      this.setTimeScale(Math.min(this.clock.timeScale, REPLAY_SCALE));
      if (this.storm.replay()) this.replaying = { id: this.storm.focus.id, prev: prev >= 0.999 ? 1 : prev };
    }

    endReplay() {
      if (!this.replaying) return;
      const prev = this.replaying.prev;
      this.replaying = null;
      this.$('tekrar-rozeti').hidden = true;
      this.setTimeScale(prev);
    }

    setTimeScale(s, fromSlider) {
      s = M.clamp(s, 1 / MAX_SLOW, 1);
      if (s > 0.985) s = 1;
      this.clock.timeScale = s;
      if (!fromSlider) this.$('zaman-olcegi').value = String(scaleToSlider(s));
      this.$('zaman-deger').textContent = formatScale(s);
      for (const b of document.querySelectorAll('.presets button')) b.setAttribute('aria-pressed', Math.abs(1 / Number(b.dataset.scale) - s) / s < 0.02 ? 'true' : 'false');
      this.updateRangeFills();
    }

    setMode(m) {
      this.mode = m;
      if (this.started) this.storm.setParam('mode', m);
      this.$('tur-aciklama').textContent = TYPE_HELP[m];
      const r = document.querySelector(`input[name="tur"][value="${m}"]`);
      if (r) r.checked = true;
    }

    togglePause() {
      this.paused = !this.paused;
      this.clock.paused = this.paused;
      this.audio.setPaused(this.paused);
      const b = this.$('duraklat');
      b.setAttribute('aria-pressed', this.paused ? 'true' : 'false');
      b.setAttribute('aria-label', this.paused ? 'Sürdür' : 'Duraklat');
      b.title = this.paused ? 'Sürdür (P)' : 'Duraklat (P)';
      b.querySelector('use').setAttribute('href', this.paused ? '#i-play' : '#i-pause');
    }

    setMuted(m) {
      if (!m && !this.audio.ok) { this.audio.init(); this.audio.setRain(this.storm.params.rain); }
      this.muted = m;
      this.audio.setMuted(m);
      const b = this.$('ses');
      b.setAttribute('aria-pressed', m ? 'true' : 'false');
      b.setAttribute('aria-label', m ? 'Sesi aç' : 'Sesi kapat');
      b.querySelector('use').setAttribute('href', m ? '#i-mute' : '#i-volume');
    }

    togglePanel(force) {
      const p = this.$('ayarlar'), b = this.$('ayarlar-ac');
      const open = force != null ? force : p.hidden;
      p.hidden = !open;
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) this.$('ayarlar-kapat').focus(); else if (force == null || document.activeElement === document.body) b.focus();
    }

    toggleUI() {
      const hidden = document.body.classList.toggle('ui-hidden');
      this.$('goster').hidden = !hidden;
      if (hidden) this.$('goster').focus(); else this.$('gizle').focus();
    }

    toggleFullscreen() {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => this.toast('Tam ekran bu görünümde kullanılamıyor.'));
        else this.toast('Tam ekran bu tarayıcıda desteklenmiyor.');
      } catch (e) { this.toast('Tam ekran bu görünümde kullanılamıyor.'); }
    }

    toast(msg) {
      const t = this.$('bildirim');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
    }

    // ---------- Kamera ----------
    onPointerDown(e) {
      if (!this.started) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
      if (this.pointers.size === 2) this.pinch = this.pinchDistance();
    }
    onPointerMove(e) {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) p.moved = true;
      if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        if (this.pinch) this.zoom(this.pinch / d);
        this.pinch = d;
        for (const q of this.pointers.values()) q.moved = true;
        return;
      }
      if (!p.moved) return;
      this.canvas.classList.add('dragging');
      const k = 1.4 * this.cam.fov / Math.max(200, this.canvas.clientHeight);
      this.cam.yaw -= dx * k;
      this.cam.pitch += dy * k;
      this.cam.vy = -dx * k * 30; this.cam.vp = dy * k * 30;
      this.clampCam();
    }
    onPointerUp(e) {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.canvas.classList.remove('dragging');
      if (this.pointers.size < 2) this.pinch = null;
      if (p && !p.moved && this.started) {
        const r = this.canvas.getBoundingClientRect();
        this.strikeAtScreen(e.clientX - r.left, e.clientY - r.top);
      }
    }
    pinchDistance() {
      const a = [...this.pointers.values()];
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
    }
    zoom(f) {
      this.cam.fov = M.clamp(this.cam.fov * f, 18 * Math.PI / 180, 68 * Math.PI / 180);
    }
    clampCam() {
      this.cam.yaw = M.clamp(this.cam.yaw, -0.75, 0.75);
      this.cam.pitch = M.clamp(this.cam.pitch, -0.12, 0.5);
    }

    // ---------- Klavye ----------
    onKey(e, down) {
      const tag = (e.target && e.target.tagName) || '';
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!down) { this.keysDown.delete(e.key); return; }
      if (!this.started) return;
      if (e.key === 'Escape') {
        if (!this.$('ayarlar').hidden) this.togglePanel(false);
        else if (document.body.classList.contains('ui-hidden')) this.toggleUI();
        else if (this.replaying) this.endReplay();
        return;
      }
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
      if (arrows.includes(e.key)) {
        if (tag === 'BUTTON' && e.target.closest('.segmented')) return;
        this.keysDown.add(e.key);
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === ' ' || e.code === 'Space') {
        if (tag === 'BUTTON') return; // odaktaki düğme kendi eylemini yapar
        e.preventDefault(); this.strikeRandom(); return;
      }
      if (k === 'r') this.replay();
      else if (k === 'p') this.togglePause();
      else if (k === 'm') this.setMuted(!this.muted);
      else if (k === 'h') this.toggleUI();
      else if (k === 'f') this.toggleFullscreen();
      else if (k >= '1' && k <= '5') this.setMode(TYPE_KEYS[Number(k) - 1]);
    }

    // ---------- Fırtına olayları ----------
    onStormEvent(type, d) {
      if (type === 'strike') this.showStrike(d);
      else if (type === 'replay') {
        this.$('tekrar-rozeti').hidden = false;
        this.showStrike(d);
      } else if (type === 'phase') {
        if (d.key === 'rs') { this.showPhase(d); this.phase.pending = null; }
        else this.phase.pending = d;
      } else if (type === 'thunder') {
        if (!this.storm.focus || d.id !== this.storm.focus.id) return;
        this.thunder = { id: d.id, arrival: d.arrivalWall, start: this.clock.wallT };
      } else if (type === 'error') {
        this.toast('Bir yıldırım üretilemedi: ' + d.message);
      }
    }

    showStrike(s) {
      if (!this.storm.focus || s.id !== this.storm.focus.id) return;
      if (!this.started && !this.test) return;
      const $ = this.$;
      $('son-cakis').hidden = false;
      $('cakis-turu').textContent = s.kindLabel + (s.replay ? ' · tekrar' : '');
      $('cakis-yeri').textContent = SURFACE[s.surface] || s.surface;
      const rows = [['Uzaklık', `${nf1.format(s.distanceKm)} km`]];
      if (s.kind === 'cg' || s.kind === 'cgp') {
        rows.push(['Tepe akımı', `${nf0.format(s.peakKA)} kA`], ['Dönüş darbesi', nf0.format(s.strokes)],
          ['Kanal', `${nf1.format(s.mainKm)} km`], ['Enerji', `≈ ${nf1.format(s.energyGJ)} GJ`], ['Öncü süresi', `${nf1.format(s.leaderMs)} ms`]);
      } else if (s.kind === 'spider') {
        rows.push(['Ana kanal', `${nf1.format(s.mainKm)} km`], ['Dal', nf0.format(s.branches)], ['Yayılım', `${nf0.format(s.leaderMs)} ms`]);
      } else {
        rows.push(['Işık darbesi', nf0.format(s.strokes)], ['Konum', 'Bulut içi']);
      }
      const dl = $('cakis-degerleri');
      dl.textContent = '';
      for (const [k, v] of rows) {
        const div = document.createElement('div');
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        div.append(dt, dd);
        dl.append(div);
      }
      $('tekrar').disabled = !this.storm.lastReplay;
      if (!s.replay) this.thunder = { id: s.id, arrival: null, start: this.clock.wallT, est: s.thunderDelay, slow: this.clock.timeScale < 0.999 };
      this.buildCurve();
    }

    // Işık eğrisi: olay başına bir kez çizilir; imleç her karede eklenir.
    buildCurve() {
      const ev = this.storm.focus;
      if (!ev) return;
      const tl = ev.tl;
      let t1;
      if (ev.kind === 'ic') t1 = tl.end - 0.9;
      else if (ev.kind === 'spider') t1 = tl.glowEnd + 0.15;
      else t1 = Math.max(0.12, tl.strokes[tl.strokes.length - 1].t + (tl.strokes[tl.strokes.length - 1].cc || 0) + 0.08);
      const t0 = ev.kind === 'ic' ? -0.005 : -0.005;
      const cv = this.$('isik-egrisi');
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const W = Math.round(cv.clientWidth * dpr) || 300, H = Math.round(cv.clientHeight * dpr) || 84;
      const n = Math.min(400, W);
      const data = this.storm.lightCurve(ev, t0, t1, n);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, v);
      const img = document.createElement('canvas');
      img.width = W; img.height = H;
      const g = img.getContext('2d');
      const lo = -3.3, hi = Math.log10(Math.max(peak, 1e-3) * 1.4);
      const yOf = (v) => H - 4 - (Math.log10(Math.max(v, 1e-4)) - lo) / (hi - lo) * (H - 18);
      g.strokeStyle = this.colors.line; g.lineWidth = 1;
      for (let d = Math.ceil(lo); d <= hi; d++) { const y = yOf(Math.pow(10, d)); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      const step = (t1 - t0) > 0.3 ? 0.1 : 0.05;
      g.fillStyle = this.colors.dim; g.font = `${10 * dpr}px ${cssVar('--font-mono') || 'monospace'}`;
      for (let t = 0; t <= t1; t += step) {
        const x = (t - t0) / (t1 - t0) * W;
        g.beginPath(); g.moveTo(x, H - 12 * dpr); g.lineTo(x, H); g.stroke();
      }
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(245,243,255,0.45)'); grad.addColorStop(1, 'rgba(174,184,255,0.02)');
      g.beginPath(); g.moveTo(0, H);
      for (let i = 0; i < n; i++) g.lineTo(i / (n - 1) * W, yOf(data[i]));
      g.lineTo(W, H); g.closePath(); g.fillStyle = grad; g.fill();
      g.beginPath();
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * W, y = yOf(data[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = this.colors.plasma; g.lineWidth = 1.2 * dpr; g.stroke();
      if (ev.kind === 'cg' || ev.kind === 'cgp') {
        g.fillStyle = this.colors.plasma;
        tl.strokes.forEach((st, k) => { const x = (st.t - t0) / (t1 - t0) * W; g.fillText(String(k + 1), Math.min(W - 8 * dpr, x + 2 * dpr), 11 * dpr); });
      }
      this.curve = { id: ev.id, img, t0, t1, W, H, dpr };
      this.$('egri-olcek').textContent = `${nf0.format(Math.max(0, t0) * 1000)}–${nf0.format(t1 * 1000)} ms · log`;
    }

    drawCurveCursor() {
      const c = this.curve, ev = this.storm.focus;
      const cv = this.$('isik-egrisi');
      if (!c.img || !ev || ev.id !== c.id || cv.offsetParent === null) return;
      if (cv.width !== c.W || cv.height !== c.H) { cv.width = c.W; cv.height = c.H; }
      const g = cv.getContext('2d');
      g.clearRect(0, 0, c.W, c.H);
      g.drawImage(c.img, 0, 0);
      const t = this.clock.simT - ev.tStart;
      if (t >= c.t0 && t <= c.t1) {
        const x = (t - c.t0) / (c.t1 - c.t0) * c.W;
        g.fillStyle = 'rgba(244,184,96,0.16)';
        g.fillRect(0, 0, x, c.H);
        g.strokeStyle = this.colors.sodium; g.lineWidth = 1.5 * c.dpr;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.H); g.stroke();
      }
    }

    showPhase(d) {
      this.$('evre').dataset.phase = d.key;
      this.$('evre-ad').textContent = d.label;
      Object.assign(this.phase, { shown: d.label, key: d.key, shownAt: this.clock.wallT });
    }

    // ---------- Kare güncellemesi ----------
    update(dtWall) {
      // Kamera: ok tuşları ve sürükleme ataleti
      const kd = this.keysDown;
      if (kd.size) {
        const s = 0.9 * dtWall * this.cam.fov;
        if (kd.has('ArrowLeft')) this.cam.yaw -= s;
        if (kd.has('ArrowRight')) this.cam.yaw += s;
        if (kd.has('ArrowUp')) this.cam.pitch += s;
        if (kd.has('ArrowDown')) this.cam.pitch -= s;
      }
      if (!this.pointers.size && !this.reduced) {
        this.cam.yaw += this.cam.vy * dtWall; this.cam.pitch += this.cam.vp * dtWall;
        const damp = Math.exp(-dtWall * 6);
        this.cam.vy *= damp; this.cam.vp *= damp;
      } else if (!this.pointers.size) { this.cam.vy = 0; this.cam.vp = 0; }
      this.clampCam();
      this.renderer.setCamera({ yaw: this.cam.yaw, pitch: this.cam.pitch, fov: this.cam.fov });

      if (dtWall > 0) this.fpsEma = this.fpsEma * 0.9 + (1 / dtWall) * 0.1;

      // Evre çipi: hızlı evreler en az 350 ms görünür kalır
      const now = this.clock.wallT;
      const ph = this.phase;
      if (ph.pending && now - ph.shownAt > 0.35) { this.showPhase(ph.pending); ph.pending = null; }

      // Yavaş çekim tekrarının sonu
      if (this.replaying) {
        const ev = this.storm.focus;
        if (!ev || ev.id !== this.replaying.id || this.clock.simT - ev.tStart > ev.tl.end - 0.5) this.endReplay();
      }

      this.drawCurveCursor();

      this.domTimer += dtWall;
      if (this.domTimer < 0.066) return;
      this.domTimer = 0;
      const ev = this.storm.focus;
      this.$('zaman-kodu').textContent = ev ? 't = ' + formatTime(this.clock.simT - ev.tStart) : '—';
      this.$('hiz-etiketi').textContent = formatScale(this.clock.timeScale);
      const fps = this.fpsEma / this.clock.timeScale;
      // Yüksek hızlı kamera karşılığı: ekran kare hızı / zaman ölçeği (üç anlamlı basamak)
      const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(fps, 1))) - 2));
      this.$('kare-hizi').textContent = nf0.format(Math.round(fps / mag) * mag);

      // Gök gürültüsü geri sayımı
      const th = this.thunder;
      if (th && ev && th.id === ev.id) {
        const txt = this.$('gg-metin'), sure = this.$('gg-sure'), bar = this.$('gg-cubuk'), note = this.$('gg-not');
        if (th.slow || this.clock.timeScale < 0.999 && !th.arrival) {
          txt.textContent = 'Yavaş çekimde gök gürültüsü çalınmaz';
          sure.textContent = ''; bar.style.width = '0'; note.textContent = `Gerçek zamanda ${nf1.format(th.est)} sn sonra duyulurdu.`;
        } else {
          const arrival = th.arrival != null ? th.arrival : th.start + th.est;
          const remain = arrival - now;
          const total = Math.max(0.1, arrival - th.start);
          if (remain > 0) {
            txt.textContent = this.muted || !this.audio.ok ? 'Gök gürültüsü (ses kapalı)' : 'Gök gürültüsü yolda';
            sure.textContent = `${nf1.format(remain)} sn`;
            bar.style.width = `${M.clamp(1 - remain / total, 0, 1) * 100}%`;
            note.textContent = 'Ses havada saniyede 343 m yol alır.';
          } else {
            txt.textContent = 'Gök gürültüsü ulaştı';
            sure.textContent = `${nf1.format(total)} sn`;
            bar.style.width = '100%';
            note.textContent = `Flaş ile gök gürültüsü arası ${nf1.format(total)} sn: uzaklık ≈ ${nf1.format(total / 3)} km (saniye ÷ 3).`;
          }
        }
      }

      // İpucu 9 sn sonra söner
      if (this.started) {
        this.hintTimer += 0.066;
        if (this.hintTimer > 9) this.$('ipucu').classList.add('faded');
      }
    }
  }

  F.UI = UI;
})(typeof self !== 'undefined' ? self : globalThis);
