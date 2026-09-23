# Yıldırım Gözlemevi Uygulama Planı

> **Ajanlar için:** Bu plan yazarı tarafından bu oturumda yerel olarak (superpowers:executing-plans) uygulanır;
> kullanıcı otonom ilerlemeyi onayladı. Adımlar `- [ ]` ile izlenir. Proje git deposu değildir; commit adımı yoktur.

**Hedef:** Tarayıcıda çalışan, DBM tabanlı, sinematik ve etkileşimli bir gece fırtınası ve yıldırım simülasyonu.

**Mimari:** Klasik script dosyaları + `FIRTINA` ad alanı; DBM hesabı Blob tabanlı Web Worker'da; WebGL2 HDR
çok geçişli çizim (bulut, yansıma, ana sahne, bloom, iz, ton eşleme); Web Audio ile geometriye dayalı gök gürültüsü.

**Teknoloji:** HTML, CSS, JavaScript (ES2020, modül yok), WebGL2 / GLSL ES 3.00, Web Audio API, Web Worker,
node:test (birim test), Playwright (yalnızca geliştirme sırasında duman testi), Python 3 (derleme betiği).

**Spec:** `docs/superpowers/specs/2026-09-23-yildirim-gozlemevi-design.md`

## Genel kısıtlar

- Çalışma zamanı bağımlılığı yok; yalnızca Google Fonts bağlantısı (yedek yazı tipi yığınlarıyla).
- `index.html` file:// üzerinden çift tıklamayla çalışır (ES modülü yok, `fetch` yok, worker Blob'dan).
- Arayüz Türkçe, doğru Türkçe karakterler; sayılar `tr-TR` biçiminde; hiçbir yerde emoji yok.
- Tasarım belirteçleri yalnızca `css/style.css` `:root` içinde; bileşenlerde ham renk yok.
- Dokunma hedefleri >= 44px, görünür odak halkası, `prefers-reduced-motion` desteği.
- Ses yalnızca kullanıcı etkileşimiyle başlar.
- Birimler metre ve saniye; su yüzeyi y = 0; kamera -Z yönüne bakar.
- En fazla 16 ışık kaynağı GPU'ya gider; en fazla 6 etkin yıldırım.

## İnceleme odağı

1. file:// ile açma (Safari, Chrome, Firefox): worker ve scriptler sunucusuz çalışmalı. Duman testi file:// yükler.
2. Kayan nokta render hedefi olmayan tarayıcı: RGBA8 yedek yoluyla çalışmalı. Duman testi `?nofloat=1` ile dener.
3. Art arda hızlı tıklama / Boşluk tuşu: donma veya çökme olmamalı. Duman testi 30 hızlı çakış tetikler.
4. Gökyüzüne, ufka, çok yakına tıklama: hedef makul bir yere oturmalı. `terrain.test.js` pickTarget sınırlarını test eder.
5. Sekme gizlenip dönme ve çakış sırasında zaman ölçeği değişimi: dt sıçraması ve parlaklık patlaması olmamalı.
   `luminosity.test.js` saat kırpmasını ve yumuşak parlama sınırlayıcısını test eder.

---

### Görev 1: DBM üreteci ve ağaç işleme

**Dosyalar:** Oluştur `js/core/math.js`, `js/sim/dbm.js`, `tests/dbm.test.js`, `tools/dbm_preview.mjs`

**Arayüzler:**
- Üretir: `FIRTINA.DBM.generate(opts) -> BoltData`
  - `opts = { kind: 'cg'|'cgp'|'spider', seed: uint32, eta: number, cloudBase: number }`
  - `BoltData = { kind, seg: Float32Array (SEG_STRIDE float/parça), segCount, SEG_STRIDE,
     strike: [x,y,z], origin: [x,y,z], mainLength, visibleLength, leaderSteps,
     mainPath: Float32Array (xyz...), acoustic: Float32Array (x,y,z,dx,dy,dz,len,weight...),
     lights: Float32Array (x,y,z,s,tLeader,weight,flags...), lightCount, stats: {...} }`
  - Parça düzeni (SEG_STRIDE = 16): `p0.xyz, p1.xyz, tL0, tL1, s0, s1, w0, w1, width, flags, strokeMask, pad`
- `FIRTINA.math`: `mulberry32(seed)`, `gauss(rng)`, `clamp`, `lerp`, `smoothstep`, `vec3`/`mat4` işlevleri,
  `noise2(x,y)`, `fbm2(x,y,oct)`.

- [ ] Test yaz: kanal zemine iner (`strike[1] <= 1e-3`), ağaç bağlı (her parçanın `p0`'ı kökte ya da önceki bir `p1`'de),
      ana kanalda `s` zeminden köke artar, `tL` kökten zemine azalmaz, η 1,5 ve 6 uçlarında 1,5 sn içinde biter,
      aynı tohum aynı sonucu verir.
- [ ] `node --test tests/dbm.test.js` başarısız olmalı (modül yok).
- [ ] `math.js` ve `dbm.js` yaz. Algoritma: 26 komşu adaylar, `S_i` artımlı, potansiyel `Φ = B(y) - κ Σ q_j R/r`,
      `q_j = B(y_j)`; normalizasyon, `Φ^η` örnekleme; zemine varınca dur; ağaç çıkar, budama, zincirler, yumuşatma,
      orta nokta sapması, öznitelikler, bulut içi ağ, başarısız akıntılar, ışık örnekleri, akustik parçalar.
- [ ] Testleri geçir. `tools/dbm_preview.mjs` ile PNG izdüşümü üretip η ve κ ayarını gözle yap.

### Görev 2: Parlaklık modeli ve saat

**Dosyalar:** Oluştur `js/sim/luminosity.js`, `tests/luminosity.test.js`

**Arayüzler:**
- `FIRTINA.Lum.makeTimeline(kind, rng) -> Timeline { leaderDur, strokes:[{t, amp, cc, ccAmp}], vRS, vDart, end }`
- `FIRTINA.Lum.vertex(timeline, attrs, t, timeScale) -> number` (GLSL `boltLum` ile eş)
- `FIRTINA.Lum.FlashLimiter` sınıfı: `apply(targetGain, dtWall) -> gain` (yumuşak parlama)
- `FIRTINA.Lum.Clock`: `tick(nowMs) -> {dtWall, dtSim}`; dt 0,1 sn ile kırpılır.

- [ ] Test yaz: öncü varışından önce 0; ilk darbede ana kanal tepe > 0,9; 200 ms sonra < 0,05 (gerçek zaman);
      ikinci darbe dalları yakmaz; yumuşak parlama kare başına değişimi sınırlar; saat 5 sn'lik boşluğu 0,1 sn'ye kırpar.
- [ ] Başarısızlığı gör, uygula, geçir.

### Görev 3: Arazi, köy, kule, hedef seçimi

**Dosyalar:** Oluştur `js/world/terrain.js`, `tests/terrain.test.js`

**Arayüzler:**
- `FIRTINA.Terrain.height(x, z) -> number` (su altı negatif)
- `FIRTINA.Terrain.buildMesh() -> { positions: Float32Array, normals: Float32Array, indices: Uint32Array }`
- `FIRTINA.Terrain.buildVillage() -> { positions, normals, attrs, indices, lamps: Float32Array }`
- `FIRTINA.Terrain.tower -> { base:[x,y,z], height, tip:[x,y,z], lights:[...] }`
- `FIRTINA.Terrain.pickTarget(origin, dir) -> { point:[x,y,z], surface:'kule'|'göl'|'tepe'|'köy'|'orman', dist }`

- [ ] Test yaz: gökyüzü ışını 1,5-14 km arasına oturur; suya bakan ışın y = 0'da; kuleye 350 m içindeki hedef kule
      ucuna yapışır; 150 m'den yakın hedef 150 m'ye itilir; `height` sonlu ve süreklidir.
- [ ] Başarısızlığı gör, uygula, geçir.

### Görev 4: Gök gürültüsü sentezi ve ses motoru

**Dosyalar:** Oluştur `js/audio/thunder.js`, `js/audio/audio.js`, `tests/thunder.test.js`

**Arayüzler:**
- `FIRTINA.Thunder.synth({ acoustic, strokes, listener, sampleRate, seed }) -> { data: Float32Array, delay, duration }`
- `FIRTINA.Audio`: `init()`, `resume()`, `setVolume(v)`, `setMuted(b)`, `setRain(r)`, `playThunder(result, whenDelay)`,
  `playCrack(distance)`

- [ ] Test yaz: 3 km uzaktaki dikey kanal için `delay ≈ d_min/343` (±%2); veri sonlu, tepe 0 < p <= 1; uzak kanalın
      yüksek frekans enerjisi yakın kanaldan düşük.
- [ ] Başarısızlığı gör, uygula, geçir.

### Görev 5: WebGL çizim hattı

**Dosyalar:** Oluştur `js/core/gl.js`, `js/render/shaders.js`, `js/render/renderer.js`

**Arayüzler:**
- `new FIRTINA.Renderer(canvas, opts)`; `resize()`; `setCamera({pos, yaw, pitch, fov})`;
  `addBolt(id, boltData) / removeBolt(id)`; `render(frame)`;
  `frame = { simT, wallT, timeScale, bolts:[{id, offset, timeline, t}], lights:{pos:Float32Array, col:Float32Array, n},
  skyFlash, rain, wind, flashGain, towerBlink, quality }`
- Hata: `renderer.error` metni; derleme hatasında shader adı ve satır.

- [ ] Geçişler: gürültü dokusu, bulut, yansıma, ana (gökyüzü, arazi, köy, kule, su, yıldırım, yağmur, lambalar),
      bloom, iz, bileşim. Uyarlamalı ölçek.
- [ ] Duman testiyle sakin sahne ve darbe tepe görüntülerini al, gözle değerlendir, ayarla.

### Görev 6: Fırtına denetleyicisi, worker, ana döngü

**Dosyalar:** Oluştur `js/sim/storm.js`, `js/main.js`

**Arayüzler:**
- `new FIRTINA.Storm({ renderer, audio, onEvent })`; `strike(target?, kind?)`; `replaySlowMo()`; `setParam(k, v)`;
  `update(clock) -> frameState`; olaylar: `'bolt'`, `'stroke'`, `'phase'`, `'thunder'`.
- `window.__firtina`: `step(ms)`, `strikeAt(x, z, kind)`, `state()`, `setManual(b)` (test kancaları).

- [ ] Worker kuyruğu, yerleştirme ötelemesi, IC olayları, ışık birleştirme, zaman ölçeği, yavaş çekim tekrar.
- [ ] Duman testi: 30 hızlı çakış, konsol hatası yok.

### Görev 7: Arayüz

**Dosyalar:** Oluştur `index.html`, `css/style.css`, `js/ui/ui.js`

- [ ] Başlangıç kartı, HUD, ışık eğrisi, kontrol paneli, son çakış kartı, eylemler, klavye, mobil alt sayfa.
- [ ] 375px ve 1440px ekran görüntüsü; odak halkaları ve kontrast denetimi.

### Görev 8: Derleme, duman testi, belgeler, yayın

**Dosyalar:** Oluştur `tools/build.py`, `tools/smoke.mjs`, `AGENTS.md`, `README.md`

- [ ] `tools/build.py`: `dist/yildirim-gozlemevi.html` (tek dosya) ve `dist/artifact.html` (sarmalayıcısız).
- [ ] Duman testi Chromium ve WebKit'te: file://, `?nofloat=1`, hızlı çakışlar, ekran görüntüleri.
- [ ] `AGENTS.md` (Türkçe yapı belgesi), `README.md`; Artifact olarak yayınla.
