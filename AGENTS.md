# Yıldırım Gözlemevi: Proje Yapısı

Tarayıcıda çalışan, fiziğe dayalı ve etkileşimli bir gece fırtınası ve yıldırım simülasyonu. Yıldırım geometrisi
dielektrik kırılma modeliyle (DBM) üretilir, sahne WebGL2 ile HDR olarak çizilir, gök gürültüsü kanalın
geometrisinden sentezlenir. Arayüz Türkçedir. Çalışma zamanı bağımlılığı yoktur; `index.html` çift tıklamayla
(file://) açılır.

Tasarım belgesi: `docs/superpowers/specs/2026-09-23-yildirim-gozlemevi-design.md`
Uygulama planı: `docs/superpowers/plans/2026-09-23-yildirim-gozlemevi.md`
Arayüz tasarım kuralları: `design-system/yildirim-gozlemevi/pages/simulasyon.md` (MASTER dosyasını geçersiz kılar)

## Dizin yapısı

```
index.html                  İşaretleme (Türkçe arayüz, SVG simge seti, başlangıç kartı) ve script sırası
css/style.css               Tasarım belirteçleri (:root) ve tüm arayüz stilleri; mobilde alt sayfa düzeni
js/core/math.js             Rastgelelik (mulberry32, gauss, lognormal), 2B gürültü (noise2, fbm2, ridged2),
                            vektör ve 4x4 matris işlevleri
js/core/gl.js               WebGL2 bağlamı, program derleme (satırlı hata raporu), doku ve çerçeve tamponu
js/sim/dbm.js               DBM yıldırım üreteci ve ağaç işleme (Worker ve Node'da da çalışır)
js/sim/luminosity.js        Kanal parlaklığının zaman modeli, zaman çizelgesi üretimi, saat, yumuşatıcı
js/sim/storm.js             Fırtına denetleyicisi: olay zamanlama, Worker iletişimi, ışık kaynakları, evreler
js/world/terrain.js         Arazi yükseklik işlevi, göl, orman, köy ve kule geometrisi, çakış hedefi seçimi
js/audio/thunder.js         Gök gürültüsü sentezi (N-dalgaları, uzaklık bantları; Worker ve Node'da çalışır)
js/audio/audio.js           Web Audio motoru: gök gürültüsü çalma, yankı, yağmur ambiyansı, damlalar
js/render/shaders.js        Tüm GLSL ES 3.00 kaynakları ve paylaşılan Frame uniform bloğu
js/render/renderer.js       Çizim hattı: bulut, yansıma, ana sahne, bloom, retina izi, bileşim
js/ui/ui.js                 Arayüz denetleyicisi: HUD, ışık eğrisi, son çakış kartı, ayarlar, klavye, kamera
js/main.js                  Önyükleme, ana döngü, uyarlamalı kalite, test arayüzü (window.__firtina)
tests/*.test.js             node:test birim testleri (DBM, parlaklık, arazi, gök gürültüsü, fırtına)
tools/build.py              Tek dosyalık dağıtım (dist/yildirim-gozlemevi.html) ve Artifact sürümü üretir
tools/smoke.mjs             Playwright ile tarayıcı duman testi ve ekran görüntüleri (geliştirme aracı)
tools/dbm_preview.mjs       DBM yıldırımlarını PNG izdüşümü olarak çizer (parametre ayarı için)
tools/terrain_preview.mjs   Arazinin kuşbakışı haritasını ve kameradan ufuk silüetini çizer
design-system/              ui-ux-pro-max tasarım sistemi (MASTER + sayfa geçersiz kılmaları)
docs/superpowers/           Tasarım belgesi ve uygulama planı
dist/                       Derleme çıktıları (tools/build.py üretir)
```

Tüm betikler klasik `<script>` dosyasıdır ve tek bir global ad alanına (`FIRTINA`) yazar. ES modülü kullanılmaz;
böylece sayfa sunucu olmadan açılır.

## Modüller

### js/sim/dbm.js (DBM üreteci)
- `FIRTINA.DBM.generate({ kind, seed, eta, cloudBase })` bir yıldırımın geometrisini üretir.
  Türler: `cg` (negatif bulut-yer), `cgp` (pozitif, daha yüksekten, az dallı), `spider` (bulut tabanında yatay).
- Büyüme: 3B ızgarada 26 komşulu Laplace büyümesi. Potansiyel, kanal hücrelerinin nokta yük olarak üst üste
  binmesiyle hesaplanır (FSLG yaklaşımı). Her yeni hücrenin yükü, seçildiği andaki potansiyelidir (öz tutarlı
  yük); bu, uçtaki alan güçlenmesini doğal olarak üretir. Seçim olasılığı Φ^η ile orantılıdır; η küçüldükçe
  dallanma artar. Arka plan alanı dikeyde `u^0.7` (buluta yakın alan güçlü), örümcekte radyaldir.
- Ağaç işleme: ana kanal (zemin-kök yolu), dal seviyeleri, küçük dalların budanması, kafes kırıcı titreşim,
  yumuşatma, 3 düzey orta nokta sapmasıyla fraktal ayrıntı. Zemine yakın kısım yukarı bağlantı öncüsü olarak
  yeniden zamanlanır (bağlantı anı tL = 1). Bulut içi yatay kanal ağı ve başarısız yukarı akıntılar eklenir.
- Çıktı: parça dizisi (SEG_STRIDE = 16: p0, p1, tL0, tL1, s0, s1, w0, w1, genişlik, bayraklar, darbe maskesi),
  ışık örnekleri (LIGHT_STRIDE = 8), akustik parçalar (ACOUSTIC_STRIDE = 9), ana yol, istatistikler.
- Modülün tamamı `dbmModule()` içindedir; Worker kaynağı `FIRTINA.DBM_MODULE_SOURCE` metninden kurulur.

### js/sim/luminosity.js (parlaklık modeli)
- `Lum.vertex(tl, tL, s, w, flags, mask, t, ts, out, soft)`: bir kanal noktasının parlaklığını üç bileşen
  olarak verir (`hot` dönüş darbesi, `leader` öncü/ok öncü, `cc` sürekli akım). Aynı işlev GLSL'de
  (`shaders.js: boltLum`) birebir yinelenir; sabitler yalnızca `Lum.CONST` içindedir ve shader'a enjekte edilir.
- Evreler: basamaklı öncü (zayıf kanal, parlak uçlar), dönüş darbesi (~1,1e8 m/s cephe), ok öncü, ardışık
  darbeler (en fazla 8), sürekli akım ve M-bileşenleri (darbe başına en fazla 2). Algısal kalıcılık duvar
  saatinde (Δ / zaman ölçeği) söner. Bulut içi olaylar (`ic`) ayrı bir daldır (öncü yok).
- `makeTimeline(kind, rng, opts)`: darbe sayısı, aralıkları (log-normal), tepe akımı, sürekli akım.
- `FlashLimiter`, `Clock` (kare aralığı 0,1 sn ile kırpılır; duraklatma ve zaman ölçeği).
- Yumuşak parlama kipi: darbeler yavaş yükselip yavaş sönen bir zarfla birleşir (ışığa duyarlılık).

### js/sim/storm.js (fırtına denetleyicisi)
- Worker'ı Blob'dan kurar; DBM ve gök gürültüsü sentezini orada çalıştırır. Worker yoksa ana iş parçacığında
  zamanlayıcıyla çalışır. Her tür için hazır yıldırım kuyruğu tutar; tıklamaya anında yanıt verilir.
- `strike(target, kind)`: hedef (`Terrain.pickTarget` ya da `targetAt`) üzerine olay başlatır.
- Otomatik fırtına: Poisson süreci; karışık kipte bulut içi, negatif, örümcek ve pozitif olayları karıştırır.
  Örümcek yıldırım yarı olasılıkla ileri tarihli bir pozitif çakışla biter.
- Her kare: en parlak 16 ışık kaynağı (bulut geçişinde ilk 10), gök parlaması, yakınlık ağırlıklı parlama
  düzeyi ve pozlama uyumu (yakın flaşta hızlı kısılma, yavaş dönüş).
- Evre bildirimi: kare arasında kalan dönüş darbeleri de bildirilir. Işık eğrisi: fiziksel parlaklık (kalıcılık
  yok) log ölçekte. Yavaş çekim tekrarı: son yıldırım yeniden başlatılır (gök gürültüsü çalınmaz).
- Olaylar: `strike`, `thunder`, `phase`, `replay`, `error`.

### js/world/terrain.js (dünya)
- `height(x, z)` (orman örtüsüyle), `groundHeight(x, z)`, `lakeField`, `forestMask`, `villageMask`, `isWater`.
- Sahne: kamera (0, 16, 0) göl kıyısında -Z'ye bakar; önde göl, solda yarımada ve adacık, uzak kıyıda köy,
  sağda tepede 150 m radyo kulesi, arkada dağ sırtı.
- `buildMesh()`: kameraya göre kutupsal ızgara (400 halka x 540 ışın). `buildVillage()`: ~70 köy evi, kilise,
  tepelerde çiftlik evleri, kule ağı ve lambalar (LAMP_STRIDE = 8: x, y, z, boyut, r, g, b, tür).
- `pickTarget(origin, dir)`: ekran ışınından çakış hedefi; gökyüzüne tıklamada bulut tabanı altına iner,
  150 m - 14 km aralığına kırpılır, kuleye yakın hedefler kule ucuna yapışır (paratoner).

### js/audio/thunder.js ve audio.js (ses)
- `Thunder.synth({ acoustic, strokes, listener, sampleRate, seed })`: her akustik parça bir N-dalgası yayar;
  varış = uzaklık / 343 m/s. Görüş hattına dik parçalar kısa ve güçlü çatırtı, paralel olanlar uzun gürleme
  verir. Parçalar 6 uzaklık bandına ayrılır; her bant atmosfer soğurmasını taklit eden alçak geçiren süzgeçten
  geçer. Sonuç normalleştirilir; uzaklığa bağlı kazanç ayrıca döner.
- `AudioEngine`: kullanıcı etkileşimiyle başlar; kuru yol + sentetik darbe yanıtlı yankı + sıkıştırıcı; pembe ve
  kahverengi gürültüyle yağmur, rastgele damla sesleri; stereo konum.

### js/render/renderer.js ve shaders.js (görüntü)
- Frame uniform bloğu (std140, 236 float): matrisler, kamera, zaman, atmosfer, gök parlaması, rüzgâr, ekran,
  16 ışık kaynağı. Ana ve ayna (yansıma) geçişleri için iki ayrı UBO.
- Geçişler: 3B gürültü dokusu (başlangıçta GPU'da, 128³ Perlin-Worley) -> bulut ve gökyüzü (yarım çözünürlük,
  üstel adımlı ışın yürütme, mammatus keseli taban, ışığa doğru öz gölgelenme, analitik hava ışığı) -> göl
  yansıması (ayna kamera) -> ana HDR sahne (gökyüzü, arazi, köy, göl, yıldırım, lambalar, yağmur) -> bloom
  (6 düzey) -> retina izi (artık) -> ACES ton eşleme, vinyet, hafif renk sapması, film greni.
- Yıldırım: örneklenmiş kapsül parçaları, parlaklık köşe shader'ında (`boltLum`) hesaplanır; bulut tabanı
  üstünde gizlenir, uzaklıkla söner ve ısınır, alt piksel genişlikte enerji korunur.
- Kayan noktalı hedef yoksa `LDR_TARGETS` tanımıyla HDR 8 bitte küp kök kodlanır; bu yolda yağmur ve bloom
  biriktirmesi kapalıdır.
- Uyarlamalı kalite (4 düzey), dikey ekranlarda en az 46° yatay görüş (`effectiveFov`).

### js/ui/ui.js (arayüz)
- Başlangıç kartı: ışığa duyarlılık uyarısı, yumuşak parlama ve ses seçimi (ses kullanıcı etkileşimiyle başlar),
  odak tuzağı. Başlatınca görüş alanında ilk yıldırım.
- Ölçüm cihazı: evre çipi (kısa evreler en az 350 ms görünür), zaman kodu (µs), zaman ölçeği, eşdeğer kare/sn,
  ışık eğrisi (olay başına bir kez çizilir, imleç her karede).
- Son çakış kartı: tür, çarpılan yer, uzaklık, tepe akımı, darbe sayısı, kanal, enerji, öncü süresi;
  gök gürültüsü geri sayımı ve "saniye ÷ 3 = km" notu.
- Ayarlar: tür, dallanma η, fırtına şiddeti, otomatik fırtına, yağmur, zaman ölçeği (1 ... 1/20.000), ses,
  pozlama, yumuşak parlama, kalite. Kamera: sürükle, tekerlek, iki parmak, ok tuşları; tıklanan yere çakış.
- Kısayollar: Boşluk, R, P, M, H, F, 1-5, oklar, Esc.

### js/main.js (önyükleme)
- WebGL2 yoksa ya da shader derlenemezse Türkçe hata ekranı. `?test` elle ilerleyen saat ve korunan çizim
  tamponu, `?nofloat` 8 bit yedek yol, `?noworker`, `?q=0..3` sabit kalite.
- `window.__firtina`: `step(ms, n)`, `strikeAt(x, z, kind)`, `exposure` (test için).

## Veri akışı (her kare)

1. `Clock.tick` -> duvar ve simülasyon adımı (zaman ölçeği, duraklatma).
2. `Storm.update` -> otomatik olaylar, bekleyen çakışlar, süresi biten olaylar, ışık kaynakları, evre.
3. `AudioEngine.update` -> yağmur damlaları. Gök gürültüsü, olay başında Worker'da sentezlenip zamanlanır.
4. `Renderer.render(storm.frame())` -> tüm geçişler.
5. `UI.update` -> kamera, evre, zaman kodu, ışık eğrisi imleci, geri sayım (DOM ~15 Hz).

## Test ve derleme

- Birim testleri: `node --test tests/` (45 test).
- Duman testi (geliştirme): `PW_CORE=/yol/node_modules/playwright-core node tools/smoke.mjs --browser chromium|webkit`
  senaryolar: calm, strike, rapid, nofloat, kinds, slowmo, ui, mobile, perf, bright.
- Derleme: `python3 tools/build.py` -> `dist/yildirim-gozlemevi.html` (tek dosya), `dist/artifact.html`.
