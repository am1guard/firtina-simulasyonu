/* Yıldırım Gözlemevi — GLSL ES 3.00 kaynakları.
 * Tüm programlar "Frame" uniform bloğunu paylaşır (std140; düzen renderer.js'deki FRAME_LAYOUT ile eş).
 * Yıldırım parlaklık sabitleri FIRTINA.Lum.CONST'tan enjekte edilir; JS modeliyle aynı kalır. */
(function (root) {
  'use strict';
  const F = root.FIRTINA = root.FIRTINA || {};
  const C = F.Lum.CONST;

  // GLSL kayan nokta sabiti
  function lit(v) {
    if (!Number.isFinite(v)) throw new Error('GLSL sabiti sonlu değil: ' + v);
    let s = (Math.abs(v) >= 1e-3 && Math.abs(v) < 1e6) || v === 0 ? String(v) : v.toExponential();
    if (!/[.eE]/.test(s)) s += '.0';
    return s;
  }

  // HDR kodlaması: kayan noktalı hedef yoksa (LDR_TARGETS) 8 bit hedefte küp kök ve titreşimle saklanır.
  const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
#ifdef LDR_TARGETS
vec4 encodeHDR(vec3 c) {
  vec3 e = pow(clamp(c / 12.0, 0.0, 1.0), vec3(1.0 / 3.0));
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4(e + n / 255.0, 1.0);
}
vec3 decodeHDR(vec4 s) { vec3 v = max(s.rgb, 0.0); return v * v * v * 12.0; }
#else
vec4 encodeHDR(vec3 c) { return vec4(c, 1.0); }
vec3 decodeHDR(vec4 s) { return s.rgb; }
#endif
`;

  const FRAME = `
layout(std140) uniform Frame {
  mat4 uView;
  mat4 uProj;
  mat4 uViewProj;
  mat4 uInvViewProj;
  mat4 uMainViewProj;
  vec4 uCamPos;       // xyz, w: yansıma geçişi (1)
  vec4 uTime;         // x: sim zamanı (sarılmış), y: duvar zamanı, z: zaman ölçeği, w: kule lambası
  vec4 uAtmos;        // x: sönüm, y: saçılma, z: bulut tabanı, w: yağmur
  vec4 uFlash;        // rgb: gök parlaması (ortam), w: pozlama
  vec4 uWind;         // xy: rüzgâr (m/s), zw: bulut kayması (m)
  vec4 uScreen;       // xy: çözünürlük, zw: 1/çözünürlük
  vec4 uCounts;       // x: ışık sayısı, y: bulut ışığı sayısı, z: kalite, w: yumuşak kip
  vec4 uLightPos[16]; // xyz, w: yumuşatma yarıçapı
  vec4 uLightCol[16]; // rgb, w: bulut içinde (1)
};
`;

  const COMMON = `
const float PI = 3.14159265;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float remap(float v, float a, float b, float c, float d) { return c + (v - a) * (d - c) / (b - a); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Gece sisi: koyu mavi-gri; solda uzak kasaba ışıklarının ufuk parıltısı; gök parlaması sisi aydınlatır.
vec3 hazeColor(vec3 rd) {
  float up = clamp(rd.y, -0.2, 1.0);
  vec3 c = vec3(0.0042, 0.0052, 0.0078) * (1.0 - 0.45 * clamp(up * 3.0, 0.0, 1.0));
  float az = atan(rd.x, -rd.z);
  float city = exp(-pow((az + 0.75) / 0.45, 2.0)) * exp(-max(up, 0.0) * 22.0);
  c += vec3(0.020, 0.011, 0.005) * city;
  c += uFlash.rgb * 0.05 * (1.0 - 0.5 * clamp(up * 4.0, 0.0, 1.0));
  return c;
}

// Işık kaynaklarından tek saçılma: ∫ dt / (h² + (t-b)²) analitik integrali.
vec3 airlight(vec3 ro, vec3 rd, float tMax) {
  vec3 sum = vec3(0.0);
  int n = int(uCounts.x);
  for (int k = 0; k < 16; k++) {
    if (k >= n) break;
    vec3 v = uLightPos[k].xyz - ro;
    float b = dot(v, rd);
    float d2 = dot(v, v);
    float r = uLightPos[k].w;
    float h = sqrt(max(d2 - b * b, 0.0) + r * r);
    float I = (atan((tMax - b) / h) + atan(b / h)) / h;
    float ext = exp(-uAtmos.x * sqrt(d2) * 0.5);
    sum += uLightCol[k].rgb * I * ext * mix(1.0, 0.35, uLightCol[k].w);
  }
  return sum * uAtmos.y * (1.0 / (4.0 * PI));
}

vec3 applyFog(vec3 col, vec3 ro, vec3 rd, float dist) {
  float T = exp(-uAtmos.x * dist);
  return col * T + hazeColor(rd) * (1.0 - T) + airlight(ro, rd, dist);
}

// Yüzeye düşen yıldırım ışığı: sarmalanmış Lambert + ıslak yüzey yansıması.
vec3 lightningLight(vec3 P, vec3 N, vec3 V, float wrap, float specK, float gloss, out vec3 spec) {
  vec3 diff = vec3(0.0);
  spec = vec3(0.0);
  int n = int(uCounts.x);
  for (int k = 0; k < 16; k++) {
    if (k >= n) break;
    vec3 L = uLightPos[k].xyz - P;
    float d2 = dot(L, L);
    float d = sqrt(d2);
    L /= d;
    float att = exp(-uAtmos.x * d) / (d2 + 40000.0) * mix(1.0, 0.35, uLightCol[k].w);
    float ndl = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
    diff += uLightCol[k].rgb * att * ndl;
    vec3 H = normalize(L + V);
    spec += uLightCol[k].rgb * att * pow(max(dot(N, H), 0.0), gloss) * specK * ndl;
  }
  return diff;
}

vec3 ambientLight(vec3 N) {
  return vec3(0.0022, 0.0027, 0.0040) * (0.4 + 0.6 * N.y) + uFlash.rgb * (0.45 + 0.55 * N.y);
}
`;

  // Bulut yoğunluğu (bulut geçişi ve yıldırımın bulutta gizlenmesi aynı işlevi kullanır)
  const CLOUD_FN = `
uniform sampler3D uNoise;
vec3 windOffset() { return vec3(uWind.z, 0.0, uWind.w); }
// Bulut tabanı: büyük ölçekli yükseklik değişimi + aşağı sarkan keseler (ters Worley hücreleri, mammatus).
float lumpyBase(vec3 q, float base0) {
  vec4 l = textureLod(uNoise, q * vec3(1.0 / 2400.0, 1.0 / 3200.0, 1.0 / 2400.0), 0.0);
  float lump = l.g * 0.75 + l.b * 0.25;
  return base0 - (lump - 0.45) * 700.0;
}
float cloudBaseAt(vec3 p) {
  vec3 q = p + windOffset();
  float n = textureLod(uNoise, q * vec3(1.0 / 9000.0, 1.0 / 5000.0, 1.0 / 9000.0), 0.0).a;
  return lumpyBase(q, uAtmos.z + (n - 0.5) * 560.0);
}
// hbSmooth: düz (keseler hariç) tabana göre yükseklik; aydınlatmada girinti/çıkıntı ayrımı için.
float cloudDensityH(vec3 p, out float hbSmooth) {
  vec3 q = p + windOffset();
  vec4 n1 = textureLod(uNoise, q * vec3(1.0 / 9000.0, 1.0 / 5000.0, 1.0 / 9000.0), 0.0);
  float base0 = uAtmos.z + (n1.a - 0.5) * 560.0;
  hbSmooth = p.y - base0;
  if (hbSmooth < -420.0) return 0.0;
  float hb = p.y - lumpyBase(q, base0);
  if (hb < -40.0) return 0.0;
  float bottom = smoothstep(-40.0, 140.0, hb);
  float top = 1.0 - smoothstep(4300.0, 5400.0, p.y);
  float cov = 0.62 + 0.3 * n1.a;
  float shape = clamp(remap(n1.r, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * bottom * top;
  if (shape <= 0.001) return 0.0;
  vec4 n3 = textureLod(uNoise, q * (1.0 / 900.0), 0.0);
  float det = n3.g * 0.6 + n3.b * 0.4;
  float erosion = mix(det, 1.0 - det, clamp(hb / 500.0, 0.0, 1.0)) * 0.3;
  return clamp(remap(shape, erosion, 1.0, 0.0, 1.0) * 1.4, 0.0, 1.0);
}
float cloudDensity(vec3 p) { float hb; return cloudDensityH(p, hb); }
`;

  const VHEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
`;

  const FULLSCREEN_VS = VHEADER + `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

  // ---------- 3B gürültü dokusu (katman katman) ----------
  const NOISE_FS = HEADER + `
uniform float uZ;
uniform float uRes;
out vec4 outColor;
float remap(float v, float a, float b, float c, float d) { return c + (v - a) * (d - c) / (b - a); }
vec3 hash33w(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gnoise(vec3 x, float per) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(hash33w(mod(i, per)) * 2.0 - 1.0, f);
  float n100 = dot(hash33w(mod(i + vec3(1.0, 0.0, 0.0), per)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(hash33w(mod(i + vec3(0.0, 1.0, 0.0), per)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(hash33w(mod(i + vec3(1.0, 1.0, 0.0), per)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(hash33w(mod(i + vec3(0.0, 0.0, 1.0), per)) * 2.0 - 1.0, f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(hash33w(mod(i + vec3(1.0, 0.0, 1.0), per)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(hash33w(mod(i + vec3(0.0, 1.0, 1.0), per)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(hash33w(mod(i + vec3(1.0, 1.0, 1.0), per)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float perlinFbm(vec3 p, float freq) {
  float sum = 0.0, amp = 1.0, norm = 0.0;
  for (int i = 0; i < 6; i++) { sum += gnoise(p * freq, freq) * amp; norm += amp; amp *= 0.5; freq *= 2.0; }
  return sum / norm;
}
float worley(vec3 x, float per) {
  vec3 i = floor(x), f = fract(x);
  float md = 9.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec3 o = vec3(float(xx), float(y), float(z));
    vec3 d = o + hash33w(mod(i + o, per)) - f;
    md = min(md, dot(d, d));
  }
  return clamp(sqrt(md), 0.0, 1.0);
}
float worleyFbm(vec3 p, float f) {
  return (1.0 - worley(p * f, f)) * 0.625 + (1.0 - worley(p * f * 2.0, f * 2.0)) * 0.25 + (1.0 - worley(p * f * 4.0, f * 4.0)) * 0.125;
}
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uRes, uZ);
  float pf = clamp(perlinFbm(p, 4.0) * 0.9 + 0.5, 0.0, 1.0);
  float w1 = worleyFbm(p, 4.0);
  float pw = clamp(remap(pf, w1 - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  outColor = vec4(pw, worleyFbm(p, 8.0), worleyFbm(p, 16.0), pf);
}
`;

  // ---------- Gökyüzü ve bulutlar (yarım çözünürlük) ----------
  const CLOUD_FS = HEADER + FRAME + COMMON + CLOUD_FN + `
uniform float uSteps;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 wp = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 ro = uCamPos.xyz;
  vec3 rd = normalize(wp.xyz / wp.w - ro);
  vec3 bg = hazeColor(rd);
  vec3 col = bg;
  float tBelow = 40000.0;
  if (rd.y > 0.003) {
    float tEnter = max((uAtmos.z - 620.0 - ro.y) / rd.y, 0.0);
    float tTop = (5400.0 - ro.y) / rd.y;
    tBelow = min(tEnter, 40000.0);
    if (tEnter < 40000.0) {
      float tEnd = min(tTop, tEnter + 16000.0);
      int N = int(uSteps);
      // Adımlar tabanda küçük başlar ve üstel büyür: yapının görüldüğü taban bölgesi sık örneklenir.
      float dt = max((tEnd - tEnter) * 0.006, 22.0);
      float t = tEnter + dt * hash12(gl_FragCoord.xy);
      vec3 L = vec3(0.0);
      float T = 1.0;
      int nl = int(uCounts.y);
      float firstHit = -1.0;
      for (int i = 0; i < 64; i++) {
        if (i >= N || t > tEnd) break;
        vec3 p = ro + rd * t;
        float hb;
        float d = cloudDensityH(p, hb);
        if (d > 0.002) {
          if (firstHit < 0.0) firstHit = t;
          float hf = clamp((p.y - uAtmos.z) / 3500.0, 0.0, 1.0);
          // Alttan gelen ışık (kasaba ışık kirliliği, gök parlaması) tabandaki çıkıntıları aydınlatır;
          // tabanın içine doğru girintiler kararır: dokuyu bu fark gösterir.
          float below = exp(-max(hb + 250.0, 0.0) / 300.0);
          vec3 amb = vec3(0.0010, 0.0012, 0.0019) * (0.5 + 0.5 * hf);
          vec3 pollution = vec3(0.0036, 0.0026, 0.0019)
            + vec3(0.03, 0.016, 0.007) * exp(-length(p.xz - vec2(-9000.0, -13000.0)) / 9000.0);
          amb += (pollution + uFlash.rgb * 0.1) * below;
          vec3 flash = vec3(0.0);
          if (nl > 0) {
            for (int k = 0; k < 16; k++) {
              if (k >= nl) break;
              vec3 dl = uLightPos[k].xyz - p;
              float r2 = dot(dl, dl);
              float r = sqrt(r2);
              float att = exp(-r * 0.00045) / (r2 + 90000.0);
              float ph = 0.3 * hg(dot(rd, dl) / r, 0.6) + 0.7 / (4.0 * PI);
              flash += uLightCol[k].rgb * att * ph;
            }
            // Baskın ışığa doğru öz gölgelenme: tümseklerin ışığa bakan yüzü parlar, girintiler kararır.
            vec3 Ld = normalize(uLightPos[0].xyz - p);
            float od = cloudDensity(p + Ld * 70.0) * 70.0 + cloudDensity(p + Ld * 240.0) * 170.0;
            flash *= exp(-od * 0.012) * 0.85 + 0.15;
          }
          float sig = d * 0.02;
          float Ts = exp(-sig * dt);
          L += T * (amb + flash * (0.6 + 0.8 * d)) * (1.0 - Ts);
          T *= Ts;
          if (T < 0.012) break;
        }
        t += dt;
        dt *= 1.085;
      }
      col = L + T * bg;
      if (firstHit > 0.0) tBelow = firstHit;
    }
  }
  float Tb = exp(-uAtmos.x * tBelow);
  col = col * Tb + bg * (1.0 - Tb) + airlight(ro, rd, tBelow);
  outColor = encodeHDR(col);
}
`;

  // Ana geçişte gökyüzü: bulut dokusu (yarım çözünürlük) büyütülür.
  const SKY_FS = HEADER + `
uniform sampler2D uCloud;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = encodeHDR(decodeHDR(texture(uCloud, vUv))); }
`;

  // Yansıma geçişinde gökyüzü: yansıyan ışın yönü ana kamera görüntüsündeki bulut dokusundan okunur.
  const SKY_REFL_FS = HEADER + FRAME + `
uniform sampler2D uCloud;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 wp = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(wp.xyz / wp.w - uCamPos.xyz);
  vec3 cam = vec3(uCamPos.x, -uCamPos.y, uCamPos.z);
  vec4 c = uMainViewProj * vec4(cam + dir * 10000.0, 1.0);
  vec2 uv = clamp(c.xy / max(c.w, 1e-3) * 0.5 + 0.5, vec2(0.001), vec2(0.999));
  outColor = encodeHDR(decodeHDR(texture(uCloud, uv)));
}
`;

  // ---------- Arazi ----------
  const TERRAIN_VS = VHEADER + FRAME + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aForest;
out vec3 vWorld;
out vec3 vNormal;
out float vForest;
void main() {
  vWorld = aPos; vNormal = aNormal; vForest = aForest;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;
  const TERRAIN_FS = HEADER + FRAME + COMMON + `
in vec3 vWorld;
in vec3 vNormal;
in float vForest;
out vec4 outColor;
void main() {
  if (uCamPos.w > 0.5 && vWorld.y < -0.3) discard;
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos.xyz - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float h = vWorld.y;
  float nz = vnoise(vWorld.xz * 0.045) * 0.6 + vnoise(vWorld.xz * 0.31) * 0.4;
  vec3 grass = vec3(0.030, 0.036, 0.024) * (0.75 + 0.5 * nz);
  vec3 rock = vec3(0.052, 0.050, 0.048) * (0.8 + 0.4 * nz);
  vec3 soil = vec3(0.036, 0.031, 0.026);
  vec3 forest = vec3(0.015, 0.021, 0.014) * (0.8 + 0.4 * nz);
  float slope = 1.0 - N.y;
  vec3 alb = mix(grass, rock, smoothstep(0.35, 0.6, slope));
  alb = mix(alb, soil, smoothstep(2.5, 0.4, h) * (1.0 - vForest));
  alb = mix(alb, forest, vForest);
  float wet = smoothstep(3.0, 0.3, h) * 0.6 + 0.25;
  vec3 spec;
  vec3 direct = lightningLight(vWorld, N, V, vForest * 0.5, 0.12 * wet, mix(10.0, 60.0, wet), spec);
  vec3 col = alb * (ambientLight(N) + direct) + spec;
  col = applyFog(col, uCamPos.xyz, -V, dist);
  outColor = encodeHDR(col);
}
`;

  // ---------- Köy, çiftlikler, kule ----------
  const VILLAGE_VS = VHEADER + FRAME + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aInfo;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vInfo;
void main() {
  vWorld = aPos; vNormal = aNormal; vInfo = aInfo;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;
  const VILLAGE_FS = HEADER + FRAME + COMMON + `
in vec3 vWorld;
in vec3 vNormal;
in vec4 vInfo;
out vec4 outColor;
// Prosedürel pencereler: pikselden küçük olduklarında ortalama parlaklığa geçer (kırpışma olmaz).
vec3 windows(float u, float v, float seed) {
  if (v < 0.85) return vec3(0.0);
  float fw = max(fwidth(u), fwidth(v));
  float cellU = u / 3.0, cellV = (v - 0.9) / 3.0;
  vec2 id = floor(vec2(cellU, cellV));
  float cu = fract(cellU), cv = fract(cellV);
  float rnd = hash12(id + seed * 137.0);
  float litFrac = 0.42;
  float lit = step(rnd, litFrac);
  float a = fw / 3.0;
  float inU = smoothstep(0.3 - a, 0.3 + a, cu) * (1.0 - smoothstep(0.68 - a, 0.68 + a, cu));
  float inV = smoothstep(0.02 - a, 0.02 + a, cv) * (1.0 - smoothstep(0.45 - a, 0.45 + a, cv));
  float blend = smoothstep(0.35, 1.2, fw);
  float w = mix(inU * inV * lit, 0.38 * 0.43 * litFrac, blend);
  vec3 warm = mix(vec3(1.0, 0.55, 0.24), vec3(1.0, 0.7, 0.42), hash12(id + 7.0 + seed));
  vec3 tv = vec3(0.45, 0.6, 1.0) * (0.6 + 0.4 * sin(uTime.y * 6.0 + rnd * 40.0));
  vec3 c = hash12(id + 3.0 + seed) < 0.08 ? tv : warm;
  return c * w * (2.2 + 2.5 * hash12(id + 11.0 + seed));
}
void main() {
  if (uCamPos.w > 0.5 && vWorld.y < -0.3) discard;
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos.xyz - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float kind = vInfo.w, seed = vInfo.z;
  vec3 alb;
  float gloss = 20.0, specK = 0.08;
  vec3 emit = vec3(0.0);
  if (kind < 0.5 || (kind > 2.5 && kind < 3.5)) {
    alb = mix(vec3(0.078, 0.072, 0.064), vec3(0.05, 0.046, 0.042), step(0.6, seed));
    if (kind < 0.5) emit = windows(vInfo.x, vInfo.y, seed);
  } else if (kind < 1.5) {
    alb = vec3(0.045, 0.021, 0.016) * (0.8 + 0.4 * seed); gloss = 40.0; specK = 0.35;
  } else if (kind < 2.5) {
    alb = vec3(0.03); gloss = 60.0; specK = 0.5;
  } else {
    alb = vec3(0.034, 0.034, 0.037); gloss = 80.0; specK = 0.6;
  }
  vec3 spec;
  vec3 direct = lightningLight(vWorld, N, V, 0.0, specK, gloss, spec);
  vec3 col = alb * (ambientLight(N) + direct) + spec + emit;
  col = applyFog(col, uCamPos.xyz, -V, dist);
  outColor = encodeHDR(col);
}
`;

  // ---------- Göl ----------
  const WATER_VS = VHEADER + FRAME + `
layout(location = 0) in vec3 aPos;
out vec3 vWorld;
void main() { vWorld = aPos; gl_Position = uViewProj * vec4(aPos, 1.0); }
`;
  const WATER_FS = HEADER + FRAME + COMMON + `
uniform sampler2D uRefl;
in vec3 vWorld;
out vec4 outColor;
vec2 waveGrad(vec2 p, float t, float fade) {
  vec2 g = vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.35 + t * 1.3) * 0.012;
  g += (vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 0.62 + t * 1.9) * 0.008) * fade;
  g += (vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 1.3 + t * 2.7) * 0.005) * fade;
  return g;
}
// Yağmur damlası halkaları: iki katman hücre, her hücrede döngüsel bir damla.
vec2 rippleGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float cell = layer == 0 ? 0.9 : 1.37;
    vec2 q = p / cell + float(layer) * 17.3;
    vec2 id = floor(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 cid = id + vec2(float(i), float(j));
      vec2 rnd = hash22(cid);
      float period = 0.9 + rnd.y * 0.8;
      float cyc = t / period + rnd.x;
      float ph = fract(cyc);
      vec2 center = cid + 0.2 + 0.6 * hash22(cid + floor(cyc) * 13.1);
      vec2 d = q - center;
      float r = length(d);
      float x = (r - ph * 1.2) * 9.0;
      float env = (1.0 - ph) * (1.0 - ph) * exp(-x * x * 0.5);
      g += (d / max(r, 1e-3)) * (-sin(x * 2.0) * env) * 0.2;
    }
  }
  return g;
}
void main() {
  vec3 toCam = uCamPos.xyz - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float t = uTime.x;
  float far = 1.0 - smoothstep(200.0, 900.0, dist);
  vec2 g = waveGrad(vWorld.xz, t, far);
  float rip = 1.0 - smoothstep(25.0, 120.0, dist);
  if (rip > 0.0 && uAtmos.w > 0.01) g += rippleGrad(vWorld.xz, t) * rip * uAtmos.w;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec2 uv = gl_FragCoord.xy * uScreen.zw;
  vec2 off = N.xz * vec2(0.6, 1.0) * 0.035 / (1.0 + dist * 0.004) * smoothstep(8.0, 60.0, dist);
  float rough = (0.0015 + 0.0045 * uAtmos.w) * (0.6 + min(dist, 1500.0) / 700.0);
  vec3 refl = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float wgt = exp(-fi * fi / 8.0);
    refl += decodeHDR(texture(uRefl, clamp(uv + off + vec2(0.0, fi * rough), vec2(0.0), vec2(1.0)))) * wgt;
    wsum += wgt;
  }
  refl /= wsum;
  vec3 body = vec3(0.002, 0.003, 0.004) + uFlash.rgb * 0.05;
  vec3 spec;
  vec3 direct = lightningLight(vWorld, N, V, 0.0, 1.0, 400.0, spec);
  vec3 col = mix(body, refl, fres) + spec * 0.4 + direct * 0.002;
  col = applyFog(col, uCamPos.xyz, -V, dist);
  outColor = encodeHDR(col);
}
`;

  // ---------- Yıldırım kanalı ----------
  const BOLT_LUM = `
const float A1 = ${lit(C.A1)}, TAU1 = ${lit(C.TAU1)}, A2 = ${lit(C.A2)}, TAU2 = ${lit(C.TAU2)};
const float PERSIST = ${lit(C.PERSIST)}, TAU_EYE = ${lit(C.TAU_EYE)};
const float LEADER_BASE = ${lit(C.LEADER_BASE)}, LEADER_TIP = ${lit(C.LEADER_TIP)}, TIP_FRAC = ${lit(C.TIP_FRAC)}, LEADER_FADE = ${lit(C.LEADER_FADE)};
const float DART_BASE = ${lit(C.DART_BASE)}, DART_TIP = ${lit(C.DART_TIP)}, TAU_DART = ${lit(C.TAU_DART)};
const float CC_RISE = ${lit(C.CC_RISE)}, CC_TAIL = ${lit(C.CC_TAIL)}, MC_TAU = ${lit(C.MC_TAU)};
const float SPIDER_V = ${lit(C.SPIDER_V)}, SPIDER_TAU = ${lit(C.SPIDER_TAU)}, SPIDER_BASE = ${lit(C.SPIDER_BASE)}, SPIDER_TIP = ${lit(C.SPIDER_TIP)};
const float SOFT_SCALE = ${lit(C.SOFT_SCALE)}, SOFT_RISE = ${lit(C.SOFT_RISE)}, SOFT_FALL = ${lit(C.SOFT_FALL)}, SOFT_NORM = ${lit(C.SOFT_NORM)};
uniform vec4 uStroke[8];  // t, genlik, sürekli akım süresi, sürekli akım genliği
uniform vec4 uStrokeW[8]; // x: darbe başından beri geçen duvar süresi (-1: başlamadı), y: o sıradaki zaman ölçeği
uniform vec4 uMC[8];      // iki M-bileşeni: (t1, a1, t2, a2)
uniform vec4 uBoltA;      // öncü süresi, dönüş darbesi hızı, ok öncü hızı, tür (1 = örümcek)
uniform vec4 uBoltB;      // t, zaman ölçeği (kullanılmıyor), ışıma sonu, darbe sayısı
uniform vec4 uBoltC;      // öteleme xyz, kazanç
float softEnv(float x) { return SOFT_SCALE * SOFT_NORM * (1.0 - exp(-x / SOFT_RISE)) * exp(-x / SOFT_FALL); }
// Göz kalıcılığı ve yumuşak zarf duvar saatinde işler (luminosity.js vertex ile eş): dW, cephe noktaya
// ulaştığından beri geçen duvar süresidir; zaman ölçeği değişse de süreklidir.
vec3 boltLum(float tLn, float s, float w, int flags, int mask) {
  float t = uBoltB.x;
  bool soft = uCounts.w > 0.5;
  bool spider = uBoltA.w > 0.5;
  float leaderDur = uBoltA.x;
  int nStrokes = int(uBoltB.w + 0.5);
  float hot = 0.0, leader = 0.0, cc = 0.0;
  float tArr = tLn * leaderDur;
  if (t >= tArr) {
    float dt = t - tArr;
    float tip = soft ? 0.0 : exp(-dt / (TIP_FRAC * leaderDur));
    if (spider) {
      float fade = t > uBoltB.z ? exp(-(t - uBoltB.z) / 0.12) : 1.0;
      leader = (SPIDER_BASE + SPIDER_TIP * tip) * (0.35 + 0.65 * w) * fade * (soft ? 0.6 : 1.0);
    } else {
      float l = LEADER_BASE + LEADER_TIP * tip;
      float firstRS = nStrokes > 0 ? uStroke[0].x : 1e9;
      if (t > firstRS) l *= exp(-(t - firstRS) / LEADER_FADE);
      leader = l * (0.55 + 0.45 * w) * ((flags & 4) != 0 ? 1.2 : 1.0) * (soft ? 0.5 : 1.0);
    }
  }
  for (int k = 0; k < 8; k++) {
    if (k >= nStrokes) break;
    if ((mask & (1 << k)) == 0) continue;
    vec4 st = uStroke[k];
    if (spider) {
      float tf = st.x + s / SPIDER_V;
      if (t >= tf && t >= tArr) {
        float d = t - tf;
        float dW = max(uStrokeW[k].x - (s / SPIDER_V) / uStrokeW[k].y, 0.0);
        if (soft) hot += st.y * w * softEnv(dW) * 0.5;
        else hot += st.y * w * (0.6 * exp(-d / SPIDER_TAU) + 0.5 * PERSIST * exp(-dW / TAU_EYE));
      }
      continue;
    }
    float tFront = st.x + s / uBoltA.y;
    if (!soft && k > 0 && s > 0.0) {
      float tD = st.x - s / uBoltA.z;
      if (t >= tD && t < tFront) leader += (DART_BASE + DART_TIP * exp(-(t - tD) / TAU_DART)) * sqrt(st.y) * w;
    }
    if (t >= tFront) {
      float d = t - tFront;
      float dW = max(uStrokeW[k].x - (s / uBoltA.y) / uStrokeW[k].y, 0.0);
      if (soft) hot += st.y * w * softEnv(dW);
      else hot += st.y * w * (A1 * exp(-d / TAU1) + A2 * exp(-d / TAU2) + PERSIST * exp(-dW / TAU_EYE));
      if (st.z > 0.0) {
        float env = d < st.z ? min(1.0, d / CC_RISE) : exp(-(d - st.z) / CC_TAIL);
        float m = 1.0;
        if (!soft) {
          vec4 mc = uMC[k];
          if (mc.y > 0.0 && d > mc.x) m += mc.y * exp(-(d - mc.x) / MC_TAU);
          if (mc.w > 0.0 && d > mc.z) m += mc.w * exp(-(d - mc.z) / MC_TAU);
        }
        cc += st.y * w * st.w * env * m * (soft ? 0.5 : 1.0);
      }
    }
  }
  return vec3(hot, leader, cc);
}
`;

  const BOLT_VS = VHEADER + FRAME + COMMON + CLOUD_FN + BOLT_LUM + `
// Parça düzeni (dbm.js): p0.xyz, p1.xyz, tL0, tL1, s0, s1, w0, w1, genişlik, bayraklar, maske, -
layout(location = 0) in vec3 aP0;
layout(location = 1) in vec3 aP1;
layout(location = 2) in vec2 aTL;
layout(location = 3) in vec2 aS;
layout(location = 4) in vec2 aW;
layout(location = 5) in vec4 aD;
out vec3 vCol;
flat out vec2 vS0;
flat out vec2 vS1;
flat out float vCoreW;
void main() {
  int corner = gl_VertexID;
  bool atEnd = corner >= 2;
  vec3 P0 = aP0 + uBoltC.xyz, P1 = aP1 + uBoltC.xyz;
  vec3 P = atEnd ? P1 : P0;
  float tL = atEnd ? aTL.y : aTL.x;
  float s = atEnd ? aS.y : aS.x;
  float w = atEnd ? aW.y : aW.x;
  vec3 lum = boltLum(tL, s, w, int(aD.y + 0.5), int(aD.z + 0.5));
  float total = lum.x + lum.y + lum.z;
  vec4 c0 = uViewProj * vec4(P0, 1.0), c1 = uViewProj * vec4(P1, 1.0);
  if (total * uBoltC.w < 0.002 || c0.w < 1.0 || c1.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  float baseH = cloudBaseAt(P);
  float inCloud = smoothstep(baseH - 60.0, baseH + 220.0, P.y);
  float dist = length(P - uCamPos.xyz);
  float ext = exp(-uAtmos.x * dist);
  vec3 cHot = mix(vec3(1.0, 0.96, 1.0), vec3(1.0, 0.8, 0.62), 1.0 - exp(-dist / 12000.0));
  vec3 color = lum.x * cHot + lum.y * vec3(0.55, 0.48, 1.0) + lum.z * vec3(1.0, 0.58, 0.48);
  vec2 halfRes = uScreen.xy * 0.5;
  vec2 s0 = c0.xy / c0.w * halfRes, s1 = c1.xy / c1.w * halfRes;
  vec2 dv = s1 - s0;
  float len = length(dv);
  vec2 dir = len > 1e-4 ? dv / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = atEnd ? c1 : c0;
  float wpx = aD.x * uProj[1][1] * halfRes.y / c.w;
  float coreW = max(wpx * 0.5, 0.6);
  float hw = coreW + 3.0;
  vec2 sp = (atEnd ? s1 : s0) + nrm * ((corner == 0 || corner == 2) ? -hw : hw) + dir * (atEnd ? hw : -hw);
  vS0 = s0; vS1 = s1; vCoreW = coreW;
  vCol = color * uBoltC.w * (1.0 - inCloud * 0.97) * ext * clamp(wpx, 0.2, 1.0);
  gl_Position = vec4(sp / halfRes * c.w, c.z, c.w);
}
`;
  const BOLT_FS = HEADER + FRAME + `
in vec3 vCol;
flat in vec2 vS0;
flat in vec2 vS1;
flat in float vCoreW;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy - uScreen.xy * 0.5;
  vec2 ab = vS1 - vS0;
  float hr = dot(p - vS0, ab) / max(dot(ab, ab), 1e-6);
  float h = clamp(hr, 0.0, 1.0);
  float d = length(p - vS0 - ab * h);
  float core = exp(-d * d / (2.0 * vCoreW * vCoreW));
  float halo = exp(-d / 1.6) * 0.18;
  float a = (core + halo) * ((hr < 0.0 || hr > 1.0) ? 0.5 : 1.0);
  if (a < 0.003) discard;
  outColor = encodeHDR(vCol * a);
}
`;

  // ---------- Yağmur ----------
  const RAIN_FS = HEADER + FRAME + `
in vec3 vCol;
flat in vec2 vS0;
flat in vec2 vS1;
flat in float vCoreW;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy - uScreen.xy * 0.5;
  vec2 ab = vS1 - vS0;
  float h = clamp(dot(p - vS0, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(p - vS0 - ab * h);
  float a = exp(-d * d / (2.0 * vCoreW * vCoreW)) * (0.35 + 0.65 * h);
  if (a < 0.004) discard;
  outColor = encodeHDR(vCol * a);
}
`;

  const RAIN_VS = VHEADER + FRAME + COMMON + `
layout(location = 0) in vec4 aSeed;
out vec3 vCol;
flat out vec2 vS0;
flat out vec2 vS1;
flat out float vCoreW;
void main() {
  int corner = gl_VertexID;
  bool atEnd = corner >= 2;
  vec3 box = vec3(58.0, 42.0, 70.0);
  vec3 fwd = -vec3(uView[0][2], uView[1][2], uView[2][2]);
  vec3 center = uCamPos.xyz + normalize(vec3(fwd.x, 0.0, fwd.z) + 1e-4) * 33.0;
  vec3 origin = center - box * 0.5;
  float speed = 7.5 + aSeed.w * 2.5;
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 p = aSeed.xyz * box + vel * uTime.x;
  p = origin + mod(p - origin, box);
  float expo = max(0.03 * uTime.z, 0.0025);
  vec3 head = p, tail = p - vel * expo;
  vec4 c0 = uViewProj * vec4(tail, 1.0), c1 = uViewProj * vec4(head, 1.0);
  if (c0.w < 2.0 || c1.w < 2.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  vec3 viewDir = normalize(p - uCamPos.xyz);
  vec3 L = vec3(0.0016, 0.0019, 0.0026) + uFlash.rgb * 0.08;
  int n = int(uCounts.x);
  for (int k = 0; k < 16; k++) {
    if (k >= n) break;
    vec3 dl = uLightPos[k].xyz - p;
    float r2 = dot(dl, dl);
    vec3 ld = dl * inversesqrt(r2);
    L += uLightCol[k].rgb / (r2 + 1.0e4) * (0.06 + 0.7 * hg(dot(viewDir, ld), 0.75)) * mix(1.0, 0.35, uLightCol[k].w);
  }
  vec2 halfRes = uScreen.xy * 0.5;
  vec2 s0 = c0.xy / c0.w * halfRes, s1 = c1.xy / c1.w * halfRes;
  vec2 dv = s1 - s0;
  float len = length(dv);
  vec2 dir = len > 1e-4 ? dv / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = atEnd ? c1 : c0;
  float wpx = 0.0025 * uProj[1][1] * halfRes.y / c.w;
  float coreW = max(wpx * 0.5, 0.42);
  float hw = coreW + 1.0;
  vec2 sp = (atEnd ? s1 : s0) + nrm * ((corner == 0 || corner == 2) ? -hw : hw) + dir * (atEnd ? hw : -hw);
  vS0 = s0; vS1 = s1; vCoreW = coreW;
  float nearFade = smoothstep(2.0, 5.0, c.w);
  vCol = L * 0.5 * nearFade * clamp(wpx * 2.0, 0.15, 1.0);
  gl_Position = vec4(sp / halfRes * c.w, c.z, c.w);
}
`;

  // ---------- Lambalar (sokak, kule ikazı, çiftlik) ----------
  const LAMP_VS = VHEADER + FRAME + `
layout(location = 0) in vec4 aL0; // x, y, z, boyut
layout(location = 1) in vec4 aL1; // r, g, b, tür
out vec3 vCol;
out vec2 vQ;
void main() {
  int corner = gl_VertexID;
  vec2 q = vec2((corner & 1) == 0 ? -1.0 : 1.0, corner < 2 ? -1.0 : 1.0);
  vec4 c = uViewProj * vec4(aL0.xyz, 1.0);
  if (c.w < 1.0 || (uCamPos.w > 0.5 && aL0.y < 0.0)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vQ = q; return; }
  vec2 halfRes = uScreen.xy * 0.5;
  float px = max(aL0.w * uProj[1][1] * halfRes.y / c.w, 1.1);
  float kind = aL1.w;
  float inten = kind < 0.5 ? 9.0 : (kind < 1.5 ? 26.0 * uTime.w : 6.0);
  float dist = length(aL0.xyz - uCamPos.xyz);
  vCol = aL1.rgb * inten * exp(-uAtmos.x * dist) * min(1.0, 1.1 / px + 0.35);
  vQ = q * 2.5;
  vec2 sp = c.xy / c.w * halfRes + q * px * 2.5;
  gl_Position = vec4(sp / halfRes * c.w, c.z, c.w);
}
`;
  const LAMP_FS = HEADER + `
in vec3 vCol;
in vec2 vQ;
out vec4 outColor;
void main() {
  float r2 = dot(vQ, vQ);
  float a = exp(-r2 * 1.6) + 0.04 * exp(-r2 * 0.25);
  if (a < 0.004) discard;
  outColor = encodeHDR(vCol * a);
}
`;

  // ---------- Son işlem ----------
  const DOWN_FS = HEADER + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uKaris;
in vec2 vUv;
out vec4 outColor;
vec3 s(vec2 o) { return decodeHDR(texture(uSrc, vUv + o * uTexel)); }
float kw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 res;
  if (uKaris > 0.5) {
    vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = kw(g0) * 0.5, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.125;
    res = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  outColor = encodeHDR(max(res, vec3(0.0)));
}
`;
  const UP_FS = HEADER + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 r = uTexel * uRadius;
  #define T(o) decodeHDR(texture(uSrc, vUv + (o)))
  vec3 c = T(vec2(-r.x, r.y)) + 2.0 * T(vec2(0.0, r.y)) + T(r)
    + 2.0 * T(vec2(-r.x, 0.0)) + 4.0 * T(vec2(0.0)) + 2.0 * T(vec2(r.x, 0.0))
    + T(-r) + 2.0 * T(vec2(0.0, -r.y)) + T(vec2(r.x, -r.y));
  #undef T
  outColor = encodeHDR(c / 16.0);
}
`;
  const AFTER_FS = HEADER + `
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform float uDecay;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = max(decodeHDR(texture(uPrev, vUv)) * uDecay, decodeHDR(texture(uCur, vUv)));
  // Bozuk bir kare (NaN/sonsuz) iz tamponunda kalıcı lekeye dönüşmesin.
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  outColor = encodeHDR(min(c, vec3(6.0e4)));
}
`;
  const COMPOSITE_FS = HEADER + FRAME + `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uAfter;
uniform sampler2D uAfterRef;
uniform float uBloomStrength;
uniform float uAfterStrength;
uniform float uGrain;
in vec2 vUv;
out vec4 outColor;
float hashc(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 dc = vUv - 0.5;
  float r2 = dot(dc, dc);
  vec3 col;
  col.r = decodeHDR(texture(uScene, vUv - dc * r2 * 0.006)).r;
  col.g = decodeHDR(texture(uScene, vUv)).g;
  col.b = decodeHDR(texture(uScene, vUv + dc * r2 * 0.006)).b;
  col += decodeHDR(texture(uBloom, vUv)) * uBloomStrength;
  // Retina izi: yalnızca flaş söndükten sonra kalan artık, zayıf ve sınırlı
  vec3 residual = max(decodeHDR(texture(uAfter, vUv)) - decodeHDR(texture(uAfterRef, vUv)), vec3(0.0));
  col += min(residual, vec3(1.5)) * uAfterStrength;
  col *= uFlash.w;
  col = aces(col);
  col *= 1.0 - smoothstep(0.08, 0.5, r2) * 0.42;
  col = pow(col, vec3(1.0 / 2.2));
  float n = hashc(gl_FragCoord.xy + uGrain) - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += n * (0.03 * (1.0 - lum) + 1.2 / 255.0);
  outColor = vec4(col, 1.0);
}
`;

  F.Shaders = {
    FULLSCREEN_VS, NOISE_FS, CLOUD_FS, SKY_FS, SKY_REFL_FS,
    TERRAIN_VS, TERRAIN_FS, VILLAGE_VS, VILLAGE_FS, WATER_VS, WATER_FS,
    BOLT_VS, BOLT_FS, RAIN_VS, RAIN_FS, LAMP_VS, LAMP_FS,
    DOWN_FS, UP_FS, AFTER_FS, COMPOSITE_FS, lit,
  };
})(typeof self !== 'undefined' ? self : globalThis);
