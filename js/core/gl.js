/* Yıldırım Gözlemevi — WebGL2 yardımcıları: program derleme (satırlı hata raporu), doku, çerçeve tamponu. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};

  function createContext(canvas, opts) {
    const gl = canvas.getContext('webgl2', Object.assign({
      antialias: false, alpha: false, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    }, opts || {}));
    if (!gl) return null;
    const floatRT = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.getExtension('OES_texture_float_linear');
    return { gl, floatRT };
  }

  function numbered(src, line) {
    const lines = src.split('\n');
    const from = Math.max(0, line - 4), to = Math.min(lines.length, line + 3);
    const out = [];
    for (let i = from; i < to; i++) out.push(`${String(i + 1).padStart(4)}${i + 1 === line ? ' >' : '  '} ${lines[i]}`);
    return out.join('\n');
  }

  function compileShader(gl, type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || '';
      const m = /ERROR:\s*\d+:(\d+)/.exec(log);
      const kind = type === gl.VERTEX_SHADER ? 'köşe' : 'parça';
      throw new Error(`Shader derlenemedi: ${name} (${kind})\n${log}\n${m ? numbered(src, +m[1]) : ''}`);
    }
    return sh;
  }

  // Program oluşturur; tüm etkin uniform konumlarını toplar ve Frame bloğunu 0 noktasına bağlar.
  function program(gl, name, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs, name));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Program bağlanamadı: ${name}\n${gl.getProgramInfoLog(p)}`);
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const base = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      if (loc) u[base] = loc;
    }
    const block = gl.getUniformBlockIndex(p, 'Frame');
    if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, 0);
    return { p, u, name };
  }

  function texture2D(gl, w, h, o) {
    o = o || {};
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, o.internal || gl.RGBA8, w, h, 0, o.format || gl.RGBA, o.type || gl.UNSIGNED_BYTE, o.data || null);
    const f = o.filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    const wr = o.wrap || gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    return t;
  }

  // Renk (+ isteğe bağlı derinlik) hedefi. fmt: { internal, format, type }
  function target(gl, w, h, fmt, withDepth) {
    const tex = texture2D(gl, w, h, fmt);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let depth = null;
    if (withDepth) {
      depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Çerçeve tamponu eksik (${w}x${h}): 0x${status.toString(16)}`);
    return { fbo, tex, depth, w, h };
  }

  function destroyTarget(gl, t) {
    if (!t) return;
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
    if (t.depth) gl.deleteRenderbuffer(t.depth);
  }

  function buffer(gl, kind, data, usage) {
    const b = gl.createBuffer();
    gl.bindBuffer(kind, b);
    gl.bufferData(kind, data, usage || gl.STATIC_DRAW);
    return b;
  }

  F.GL = { createContext, program, texture2D, target, destroyTarget, buffer };
})(typeof self !== 'undefined' ? self : globalThis);
