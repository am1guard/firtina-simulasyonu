/* Yıldırım Gözlemevi — WebGL2 çizim hattı.
 * Geçişler: bulut ve gökyüzü (düşük çözünürlük) -> göl yansıması (ayna kamera) -> ana HDR sahne ->
 * bloom zinciri -> retina izi -> ton eşleme ve bileşim. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};
  const mat4 = F.math.mat4;

  // Frame bloğu (std140) float konumları; shaders.js FRAME ile eş.
  const FRAME_FLOATS = 236;
  const OFF = { view: 0, proj: 16, viewProj: 32, invViewProj: 48, mainViewProj: 64, camPos: 80, time: 84,
    atmos: 88, flash: 92, wind: 96, screen: 100, counts: 104, lightPos: 108, lightCol: 172 };
  const MAX_RAIN = 16000;
  const BLOOM_LEVELS = 6;

  const QUALITY = [
    { main: 0.7, cloud: 0.33, steps: 22, refl: 0.35 },
    { main: 0.85, cloud: 0.4, steps: 28, refl: 0.4 },
    { main: 1.0, cloud: 0.5, steps: 34, refl: 0.5 },
    { main: 1.0, cloud: 0.5, steps: 44, refl: 0.5 },
  ];

  class Renderer {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.opts = opts || {};
      const ctx = F.GL.createContext(canvas, { preserveDrawingBuffer: !!this.opts.preserve });
      if (!ctx) { const e = new Error('WebGL2 desteklenmiyor'); e.code = 'WEBGL2'; throw e; }
      const gl = this.gl = ctx.gl;
      this.floatRT = ctx.floatRT && !this.opts.noFloat;
      this.hdr = this.floatRT
        ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
        : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
      this.quality = this.opts.quality != null ? this.opts.quality : 2;
      this.maxDpr = this.opts.maxDpr || 2;
      this.frameData = new Float32Array(FRAME_FLOATS);
      this.reflData = new Float32Array(FRAME_FLOATS);
      this.ubo = this.makeUBO();
      this.uboRefl = this.makeUBO();
      this.emptyVAO = gl.createVertexArray();
      this.bolts = new Map();
      this.camera = { pos: F.Terrain.CAMERA_POS.slice(), yaw: 0, pitch: 0.075, fov: 50 * Math.PI / 180 };
      this.m = {
        view: mat4.create(), proj: mat4.create(), viewProj: mat4.create(), invViewProj: mat4.create(),
        viewR: mat4.create(), viewProjR: mat4.create(), invViewProjR: mat4.create(),
      };
      this.afterIndex = 0;
      this.grain = 0;
      this.compile();
      this.buildNoise();
      this.buildRain();
      this.targets = null;
      this.resize();
    }

    makeUBO() {
      const gl = this.gl, b = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, b);
      gl.bufferData(gl.UNIFORM_BUFFER, FRAME_FLOATS * 4, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.UNIFORM_BUFFER, null);
      return b;
    }

    compile() {
      const gl = this.gl, S = F.Shaders;
      // Kayan noktalı hedef yoksa HDR değerleri 8 bitte kodlanır (shaders.js: encodeHDR/decodeHDR).
      const def = (src) => (this.floatRT ? src : src.replace('#version 300 es\n', '#version 300 es\n#define LDR_TARGETS 1\n'));
      const P = (n, v, f) => F.GL.program(gl, n, def(v), def(f));
      this.prog = {
        noise: P('gürültü', S.FULLSCREEN_VS, S.NOISE_FS),
        cloud: P('bulut', S.FULLSCREEN_VS, S.CLOUD_FS),
        sky: P('gökyüzü', S.FULLSCREEN_VS, S.SKY_FS),
        skyRefl: P('gökyüzü yansıması', S.FULLSCREEN_VS, S.SKY_REFL_FS),
        terrain: P('arazi', S.TERRAIN_VS, S.TERRAIN_FS),
        village: P('köy', S.VILLAGE_VS, S.VILLAGE_FS),
        water: P('göl', S.WATER_VS, S.WATER_FS),
        bolt: P('yıldırım', S.BOLT_VS, S.BOLT_FS),
        rain: P('yağmur', S.RAIN_VS, S.RAIN_FS),
        lamp: P('lamba', S.LAMP_VS, S.LAMP_FS),
        down: P('bloom küçültme', S.FULLSCREEN_VS, S.DOWN_FS),
        up: P('bloom büyütme', S.FULLSCREEN_VS, S.UP_FS),
        after: P('retina izi', S.FULLSCREEN_VS, S.AFTER_FS),
        composite: P('bileşim', S.FULLSCREEN_VS, S.COMPOSITE_FS),
      };
    }

    // 128³ döşenebilir Perlin-Worley gürültüsü, GPU'da katman katman.
    buildNoise() {
      const gl = this.gl, N = 128;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, N, N, N);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, N, N);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      const pr = this.prog.noise;
      gl.useProgram(pr.p);
      gl.uniform1f(pr.u.uRes, N);
      gl.bindVertexArray(this.emptyVAO);
      for (let z = 0; z < N; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
        gl.uniform1f(pr.u.uZ, (z + 0.5) / N);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      this.noiseTex = tex;
    }

    buildRain() {
      const gl = this.gl;
      const seeds = new Float32Array(MAX_RAIN * 4);
      const rng = F.math.mulberry32(777);
      for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
      this.rainVAO = gl.createVertexArray();
      gl.bindVertexArray(this.rainVAO);
      F.GL.buffer(gl, gl.ARRAY_BUFFER, seeds);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.bindVertexArray(null);
    }

    // Arazi, köy ve lambalar (FIRTINA.Terrain çıktıları)
    setWorld(terrainMesh, village) {
      const gl = this.gl, B = (d, k) => F.GL.buffer(gl, k || gl.ARRAY_BUFFER, d);
      const attr = (loc, size, stride, offset, divisor) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
        if (divisor) gl.vertexAttribDivisor(loc, divisor);
      };
      this.terrainVAO = gl.createVertexArray();
      gl.bindVertexArray(this.terrainVAO);
      B(terrainMesh.positions); attr(0, 3, 0, 0);
      B(terrainMesh.normals); attr(1, 3, 0, 0);
      B(terrainMesh.forest); attr(2, 1, 0, 0);
      B(terrainMesh.indices, gl.ELEMENT_ARRAY_BUFFER);
      this.terrainCount = terrainMesh.indices.length;

      this.villageVAO = gl.createVertexArray();
      gl.bindVertexArray(this.villageVAO);
      B(village.positions); attr(0, 3, 0, 0);
      B(village.normals); attr(1, 3, 0, 0);
      B(village.info); attr(2, 4, 0, 0);
      B(village.indices, gl.ELEMENT_ARRAY_BUFFER);
      this.villageCount = village.indices.length;

      this.lampVAO = gl.createVertexArray();
      gl.bindVertexArray(this.lampVAO);
      B(village.lamps); attr(0, 4, 32, 0, 1); attr(1, 4, 32, 16, 1);
      this.lampCount = village.lamps.length / 8;

      this.waterVAO = gl.createVertexArray();
      gl.bindVertexArray(this.waterVAO);
      B(new Float32Array([-3200, 0, 80, 3400, 0, 80, -3200, 0, -2700, 3400, 0, -2700])); attr(0, 3, 0, 0);
      gl.bindVertexArray(null);
    }

    addBolt(id, data) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = F.GL.buffer(gl, gl.ARRAY_BUFFER, data.seg);
      const st = data.SEG_STRIDE * 4;
      const a = (loc, size, off) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * 4);
        gl.vertexAttribDivisor(loc, 1);
      };
      a(0, 3, 0); a(1, 3, 3); a(2, 2, 6); a(3, 2, 8); a(4, 2, 10); a(5, 4, 12);
      gl.bindVertexArray(null);
      this.bolts.set(id, { vao, vbo, count: data.segCount });
    }

    removeBolt(id) {
      const e = this.bolts.get(id);
      if (!e) return;
      this.gl.deleteVertexArray(e.vao);
      this.gl.deleteBuffer(e.vbo);
      this.bolts.delete(id);
    }

    setQuality(q) {
      const nq = Math.max(0, Math.min(QUALITY.length - 1, q));
      if (nq === this.quality) return;
      this.quality = nq;
      this.resize();
    }

    resize() {
      const gl = this.gl, q = QUALITY[this.quality];
      const dpr = Math.min(root.devicePixelRatio || 1, this.maxDpr);
      const cssW = Math.max(1, this.canvas.clientWidth || this.canvas.width), cssH = Math.max(1, this.canvas.clientHeight || this.canvas.height);
      let W = Math.round(cssW * dpr * q.main), H = Math.round(cssH * dpr * q.main);
      const maxPx = 3.4e6;
      if (W * H > maxPx) { const k = Math.sqrt(maxPx / (W * H)); W = Math.round(W * k); H = Math.round(H * k); }
      W = Math.max(64, W); H = Math.max(64, H);
      if (this.targets && this.targets.W === W && this.targets.H === H && this.targets.q === this.quality) return;
      this.canvas.width = W; this.canvas.height = H;
      const T = F.GL.target, old = this.targets;
      if (old) {
        for (const k of ['scene', 'cloud', 'refl', 'after0', 'after1']) F.GL.destroyTarget(gl, old[k]);
        old.bloom.forEach((t) => F.GL.destroyTarget(gl, t));
      }
      const cw = Math.max(32, Math.round(W * q.cloud)), ch = Math.max(32, Math.round(H * q.cloud));
      const rw = Math.max(32, Math.round(W * q.refl)), rh = Math.max(32, Math.round(H * q.refl));
      const bloom = [];
      let bw = Math.ceil(W / 2), bh = Math.ceil(H / 2);
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        bloom.push(T(gl, Math.max(1, bw), Math.max(1, bh), this.hdr, false));
        bw = Math.ceil(bw / 2); bh = Math.ceil(bh / 2);
      }
      const aw = bloom[2].w, ah = bloom[2].h;
      this.targets = {
        W, H, q: this.quality,
        scene: T(gl, W, H, this.hdr, true),
        cloud: T(gl, cw, ch, this.hdr, false),
        refl: T(gl, rw, rh, this.hdr, true),
        bloom,
        after0: T(gl, aw, ah, this.hdr, false),
        after1: T(gl, aw, ah, this.hdr, false),
      };
      for (const t of [this.targets.after0, this.targets.after1]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setCamera(c) { Object.assign(this.camera, c); }

    // Dikey ekranlarda yatay görüş açısı en az 46° kalsın diye dikey açı büyütülür.
    effectiveFov() {
      const t = this.targets, aspect = t.W / t.H;
      const minH = 46 * Math.PI / 180;
      return Math.max(this.camera.fov, 2 * Math.atan(Math.tan(minH / 2) / aspect));
    }

    cameraForward() {
      const c = this.camera, cp = Math.cos(c.pitch);
      return [Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp];
    }

    // Ekran noktasından (css piksel) dünya ışını; tıklama ile hedef seçimi için.
    screenRay(x, y) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const ndc = [(x / w) * 2 - 1, 1 - (y / h) * 2];
      const p = mat4.transform(this.m.invViewProj, [ndc[0], ndc[1], 1, 1]);
      const pt = [p[0] / p[3], p[1] / p[3], p[2] / p[3]];
      const o = this.camera.pos;
      const d = [pt[0] - o[0], pt[1] - o[1], pt[2] - o[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      return { origin: o.slice(), dir: [d[0] / l, d[1] / l, d[2] / l] };
    }

    // Dünya noktasını css piksele izdüşürür (arayüz etiketleri için).
    project(p) {
      const c = mat4.transform(this.m.viewProj, [p[0], p[1], p[2], 1]);
      if (c[3] <= 0) return null;
      return [(c[0] / c[3] * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - c[1] / c[3] * 0.5) * this.canvas.clientHeight];
    }

    updateMatrices() {
      const m = this.m, c = this.camera, t = this.targets;
      const f = this.cameraForward();
      const eye = c.pos;
      mat4.lookAt(m.view, eye, [eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]], [0, 1, 0]);
      mat4.perspective(m.proj, this.effectiveFov(), t.W / t.H, 2.0, 90000);
      mat4.multiply(m.viewProj, m.proj, m.view);
      mat4.invert(m.invViewProj, m.viewProj);
      const R = mat4.create(); R[5] = -1;
      mat4.multiply(m.viewR, m.view, R);
      mat4.multiply(m.viewProjR, m.proj, m.viewR);
      mat4.invert(m.invViewProjR, m.viewProjR);
    }

    writeFrame(d, f, refl) {
      const m = this.m, t = this.targets;
      d.set(refl ? m.viewR : m.view, OFF.view);
      d.set(m.proj, OFF.proj);
      d.set(refl ? m.viewProjR : m.viewProj, OFF.viewProj);
      d.set(refl ? m.invViewProjR : m.invViewProj, OFF.invViewProj);
      d.set(m.viewProj, OFF.mainViewProj);
      const p = this.camera.pos;
      d.set([p[0], refl ? -p[1] : p[1], p[2], refl ? 1 : 0], OFF.camPos);
      d.set([f.simT % 1000, f.wallT % 10000, f.timeScale, f.towerLamp], OFF.time);
      d.set([f.sigmaE, f.sigmaS, f.cloudBase, f.rain], OFF.atmos);
      d.set([f.flashSky[0], f.flashSky[1], f.flashSky[2], f.exposure], OFF.flash);
      d.set([f.wind[0], f.wind[1], f.cloudOffset[0], f.cloudOffset[1]], OFF.wind);
      const sw = refl ? t.refl.w : t.W, sh = refl ? t.refl.h : t.H;
      d.set([sw, sh, 1 / sw, 1 / sh], OFF.screen);
      d.set([f.lights.n, f.lights.nCloud, this.quality, f.soft ? 1 : 0], OFF.counts);
      d.set(f.lights.pos, OFF.lightPos);
      d.set(f.lights.col, OFF.lightCol);
    }

    uploadUBO(buf, data) {
      const gl = this.gl;
      gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data);
      gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    }

    fullscreen() { this.gl.bindVertexArray(this.emptyVAO); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

    bindTarget(t) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
      gl.viewport(0, 0, t ? t.w : this.targets.W, t ? t.h : this.targets.H);
    }

    tex(unit, target, tex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, tex);
    }

    drawOpaque() {
      const gl = this.gl;
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      gl.useProgram(this.prog.terrain.p);
      gl.bindVertexArray(this.terrainVAO);
      gl.drawElements(gl.TRIANGLES, this.terrainCount, gl.UNSIGNED_INT, 0);
      gl.useProgram(this.prog.village.p);
      gl.bindVertexArray(this.villageVAO);
      gl.drawElements(gl.TRIANGLES, this.villageCount, gl.UNSIGNED_INT, 0);
    }

    drawAdditive(f, withRain) {
      const gl = this.gl;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      this.drawBolts(f);
      const lp = this.prog.lamp;
      gl.useProgram(lp.p);
      gl.bindVertexArray(this.lampVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lampCount);
      // 8 bit yedek yolda toplamsal karışım kodlanmış uzayda yapılır; binlerce yağmur damlası sahneyi aşırı parlatır.
      if (withRain && f.rain > 0.01 && this.floatRT) {
        gl.useProgram(this.prog.rain.p);
        gl.bindVertexArray(this.rainVAO);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.floor(MAX_RAIN * Math.min(1, f.rain)));
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    drawBolts(f) {
      const gl = this.gl, pr = this.prog.bolt;
      if (!f.bolts.length) return;
      gl.useProgram(pr.p);
      this.tex(0, gl.TEXTURE_3D, this.noiseTex);
      gl.uniform1i(pr.u.uNoise, 0);
      const strokes = this._strokes || (this._strokes = new Float32Array(32));
      const mcs = this._mcs || (this._mcs = new Float32Array(32));
      for (const b of f.bolts) {
        const e = this.bolts.get(b.id);
        if (!e) continue;
        const tl = b.timeline;
        strokes.fill(0); mcs.fill(0);
        const n = Math.min(8, tl.strokes.length);
        for (let k = 0; k < n; k++) {
          const st = tl.strokes[k];
          strokes.set([st.t, st.amp, st.cc, st.ccAmp], k * 4);
          const mc = st.mc || [];
          if (mc[0]) { mcs[k * 4] = mc[0].t; mcs[k * 4 + 1] = mc[0].amp; }
          if (mc[1]) { mcs[k * 4 + 2] = mc[1].t; mcs[k * 4 + 3] = mc[1].amp; }
        }
        gl.uniform4fv(pr.u.uStroke, strokes);
        gl.uniform4fv(pr.u.uMC, mcs);
        gl.uniform4f(pr.u.uBoltA, tl.leaderDur, tl.vRS, tl.vDart, tl.kind === 'spider' ? 1 : 0);
        gl.uniform4f(pr.u.uBoltB, b.t, f.timeScale, tl.glowEnd || 0, n);
        gl.uniform4f(pr.u.uBoltC, b.offset[0], b.offset[1], b.offset[2], b.gain);
        gl.bindVertexArray(e.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, e.count);
      }
    }

    render(f) {
      const gl = this.gl, T = this.targets, P = this.prog;
      const q = QUALITY[this.quality];
      this.updateMatrices();
      this.writeFrame(this.frameData, f, false);
      this.writeFrame(this.reflData, f, true);
      this.uploadUBO(this.ubo, this.frameData);
      this.uploadUBO(this.uboRefl, this.reflData);
      gl.disable(gl.CULL_FACE);
      gl.depthFunc(gl.LEQUAL);

      // 1) Bulutlar ve gökyüzü
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
      this.bindTarget(T.cloud);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(P.cloud.p);
      this.tex(0, gl.TEXTURE_3D, this.noiseTex);
      gl.uniform1i(P.cloud.u.uNoise, 0);
      gl.uniform1f(P.cloud.u.uSteps, q.steps);
      this.fullscreen();

      // 2) Göl yansıması (ayna kamera)
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.uboRefl);
      this.bindTarget(T.refl);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(P.skyRefl.p);
      this.tex(1, gl.TEXTURE_2D, T.cloud.tex);
      gl.uniform1i(P.skyRefl.u.uCloud, 1);
      this.fullscreen();
      this.drawOpaque();
      this.drawAdditive(f, false);

      // 3) Ana sahne
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
      this.bindTarget(T.scene);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(P.sky.p);
      this.tex(1, gl.TEXTURE_2D, T.cloud.tex);
      gl.uniform1i(P.sky.u.uCloud, 1);
      this.fullscreen();
      this.drawOpaque();
      gl.useProgram(P.water.p);
      this.tex(2, gl.TEXTURE_2D, T.refl.tex);
      gl.uniform1i(P.water.u.uRefl, 2);
      gl.bindVertexArray(this.waterVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.drawAdditive(f, true);

      // 4) Bloom zinciri
      gl.disable(gl.DEPTH_TEST);
      let src = T.scene;
      gl.useProgram(P.down.p);
      gl.uniform1i(P.down.u.uSrc, 0);
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const dst = T.bloom[i];
        this.bindTarget(dst);
        this.tex(0, gl.TEXTURE_2D, src.tex);
        gl.uniform2f(P.down.u.uTexel, 1 / src.w, 1 / src.h);
        gl.uniform1f(P.down.u.uKaris, i === 0 ? 1 : 0);
        this.fullscreen();
        src = dst;
      }
      gl.useProgram(P.up.p);
      gl.uniform1i(P.up.u.uSrc, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      // 8 bit yedek yolda biriktirme yapılmaz; tek düzeyli bulanık bloom kullanılır.
      for (let i = BLOOM_LEVELS - 1; i > 0 && this.floatRT; i--) {
        const s = T.bloom[i], dst = T.bloom[i - 1];
        this.bindTarget(dst);
        this.tex(0, gl.TEXTURE_2D, s.tex);
        gl.uniform2f(P.up.u.uTexel, 1 / s.w, 1 / s.h);
        gl.uniform1f(P.up.u.uRadius, 1.0);
        this.fullscreen();
      }
      gl.disable(gl.BLEND);

      // 5) Retina izi: parlak görüntünün yavaş sönen kopyası
      const prev = this.afterIndex ? T.after1 : T.after0, next = this.afterIndex ? T.after0 : T.after1;
      this.afterIndex ^= 1;
      this.bindTarget(next);
      gl.useProgram(P.after.p);
      this.tex(0, gl.TEXTURE_2D, prev.tex); gl.uniform1i(P.after.u.uPrev, 0);
      this.tex(1, gl.TEXTURE_2D, T.bloom[2].tex); gl.uniform1i(P.after.u.uCur, 1);
      gl.uniform1f(P.after.u.uDecay, Math.exp(-(f.dtWall || 0.016) / 0.15));
      this.fullscreen();

      // 6) Bileşim
      this.bindTarget(null);
      gl.useProgram(P.composite.p);
      this.tex(0, gl.TEXTURE_2D, T.scene.tex); gl.uniform1i(P.composite.u.uScene, 0);
      this.tex(1, gl.TEXTURE_2D, (this.floatRT ? T.bloom[0] : T.bloom[2]).tex); gl.uniform1i(P.composite.u.uBloom, 1);
      this.tex(2, gl.TEXTURE_2D, next.tex); gl.uniform1i(P.composite.u.uAfter, 2);
      this.tex(3, gl.TEXTURE_2D, T.bloom[2].tex); gl.uniform1i(P.composite.u.uAfterRef, 3);
      gl.uniform1f(P.composite.u.uBloomStrength, f.soft ? 0.035 : 0.06);
      gl.uniform1f(P.composite.u.uAfterStrength, f.soft || !this.floatRT ? 0.0 : 0.01);
      this.grain = (this.grain + 17.31) % 1000;
      gl.uniform1f(P.composite.u.uGrain, this.grain);
      this.fullscreen();
    }
  }

  Renderer.QUALITY = QUALITY;
  Renderer.MAX_RAIN = MAX_RAIN;
  F.Renderer = Renderer;
})(typeof self !== 'undefined' ? self : globalThis);
