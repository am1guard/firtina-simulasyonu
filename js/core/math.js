/* Yıldırım Gözlemevi — ortak matematik: rastgelelik, gürültü, vektör ve 4x4 matris işlevleri.
 * Matrisler WebGL ile uyumlu sütun öncelikli Float32Array'dir. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // ---------- Rastgelelik ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = rng();
    while (u <= 1e-12) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * rng());
  }
  function lognormal(rng, median, sigma) { return median * Math.exp(gauss(rng) * sigma); }

  // ---------- 2B değer gürültüsü ----------
  function hash2(ix, iy) {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  // [0,1] aralığında fraktal gürültü
  function fbm2(x, y, oct, lac, gain) {
    oct = oct || 5; lac = lac || 2.0; gain = gain || 0.5;
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise2(x * f + i * 17.3, y * f - i * 9.1);
      norm += amp; amp *= gain; f *= lac;
    }
    return sum / norm;
  }
  // Sırt gürültüsü: keskin tepeler, [0,1]
  function ridged2(x, y, oct) {
    oct = oct || 5;
    let sum = 0, amp = 1, norm = 0, f = 1, w = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(2 * noise2(x * f + i * 31.7, y * f + i * 11.3) - 1);
      n = n * n * w;
      w = clamp(n * 1.6, 0, 1);
      sum += amp * n; norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
  }

  // ---------- Vektörler (dizi tabanlı) ----------
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  };

  // ---------- 4x4 matrisler ----------
  const mat4 = {
    create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    perspective(out, fovY, aspect, near, far) {
      const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
      out.fill(0);
      out[0] = f / aspect; out[5] = f;
      out[10] = (far + near) * nf; out[11] = -1;
      out[14] = 2 * far * near * nf;
      return out;
    },
    lookAt(out, eye, center, up) {
      let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      out[15] = 1;
      return out;
    },
    multiply(out, a, b) {
      const r = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let rI = 0; rI < 4; rI++) {
        r[c * 4 + rI] = a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
      }
      out.set(r);
      return out;
    },
    invert(out, a) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    },
    // Noktayı dönüştürür, [x, y, z, w] döndürür.
    transform(m, p) {
      const x = p[0], y = p[1], z = p[2], w = p.length > 3 ? p[3] : 1;
      return [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
      ];
    },
  };

  F.math = { clamp, lerp, smoothstep, mulberry32, gauss, lognormal, hash2, noise2, fbm2, ridged2, v3, mat4 };
})(typeof self !== 'undefined' ? self : globalThis);
