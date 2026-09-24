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
css/style.css               Tasarım belirteçleri (:root: renk, yazı, boşluk, yarıçap, ölçü, süre, katman) ve tüm
                            arayüz stilleri; bileşenlerde ham renk ve 2 px üstü ham ölçü yok; dar ekranda alt
                            sayfa, yatay küçük telefonda (≤720x500) sade iki sütun, kısa ekranda ipucu gizli
js/core/math.js             Rastgelelik (mulberry32, gauss, lognormal), 2B gürültü (noise2, fbm2, ridged2),
                            vektör ve 4x4 matris işlevleri, kamera sınırları (effectiveFov, yawLimit)
js/core/gl.js               WebGL2 bağlamı, program derleme (satırlı hata raporu), doku ve çerçeve tamponu
js/sim/dbm.js               DBM yıldırım üreteci ve ağaç işleme (Worker ve Node'da da çalışır)
js/sim/luminosity.js        Kanal parlaklığının zaman modeli, zaman çizelgesi üretimi, saat, yükselme sınırlayıcı
js/sim/storm.js             Fırtına denetleyicisi: olay zamanlama, Worker iletişimi, ışık kaynakları, evreler
js/world/terrain.js         Arazi yükseklik işlevi, göl, orman, köy ve kule geometrisi, çakış hedefi seçimi
js/audio/thunder.js         Gök gürültüsü sentezi (N-dalgaları, uzaklık bantları; Worker ve Node'da çalışır)
js/audio/audio.js           Web Audio motoru: gök gürültüsü çalma, yankı, yağmur ambiyansı, damlalar
js/render/shaders.js        Tüm GLSL ES 3.00 kaynakları ve paylaşılan Frame uniform bloğu
js/render/renderer.js       Çizim hattı: bulut, yansıma, ana sahne, bloom, retina izi, bileşim
js/ui/ui.js                 Arayüz denetleyicisi: HUD, ışık eğrisi, son çakış kartı, ayarlar, klavye, kamera
js/main.js                  Önyükleme, ana döngü, uyarlamalı kalite, test arayüzü (window.__firtina)
tests/*.test.js             node:test birim testleri (DBM, parlaklık, arazi, gök gürültüsü, ses, fırtına,
                            matematik, içerik kuralları)
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
- `Lum.vertex(tl, tL, s, w, flags, mask, t, ts, out, soft, wAge, wTs)`: bir kanal noktasının parlaklığını üç
  bileşen olarak verir (`hot` dönüş darbesi, `leader` öncü/ok öncü, `cc` sürekli akım). Aynı işlev GLSL'de
  (`shaders.js: boltLum`) birebir yinelenir; sabitler yalnızca `Lum.CONST` içindedir ve shader'a enjekte edilir.
- Evreler: basamaklı öncü (zayıf kanal, parlak uçlar; negatifte 15-40 ms, pozitifte 25-70 ms), dönüş darbesi
  (~1,1e8 m/s cephe), ok öncü, ardışık darbeler (en fazla 8), sürekli akım (son darbede %30, diğerlerinde %12
  olasılık; çakışların ~%30-50'si) ve M-bileşenleri (darbe başına en fazla 2). Bulut içi olaylar (`ic`) ayrı
  bir daldır (öncü yok).
- Algısal kalıcılık ve yumuşak zarf duvar saatinde işler: `wAge[k]` darbe k başından beri geçen duvar süresi,
  `wTs[k]` o sıradaki zaman ölçeği; köşenin duvar yaşı `wAge[k] - (s / v) / wTs[k]`. Zaman ölçeği değişse de
  süreklidir; yavaş çekimden çıkınca sönmüş kanal yeniden parlamaz. `wAge` verilmezse eski `Δ / ts` kullanılır.
- `makeTimeline(kind, rng, opts)`: darbe sayısı, aralıkları (log-normal), tepe akımı, sürekli akım.
- `RiseLimiter(rate, floor)`: durum tutan çıkış sınırlayıcısı; `apply(sinyal, dtDuvar, etkin)` kazanç döndürür,
  çıkış saniyede en fazla e^rate kat yükselir, düşüş serbesttir. `Clock` (kare aralığı 0,1 sn ile kırpılır;
  duraklatma ve zaman ölçeği).
- Yumuşak parlama kipi: darbeler yavaş yükselip yavaş sönen bir zarfla birleşir (ışığa duyarlılık).

### js/sim/storm.js (fırtına denetleyicisi)
- Worker'ı Blob'dan kurar (`attachWorker`); DBM ve gök gürültüsü sentezini orada çalıştırır. Worker yoksa ya da
  çökerse (`onWorkerCrash`: bekleyen işler bırakılır, sayaçlar sıfırlanır) ana iş parçacığında zamanlayıcıyla
  çalışır; worker hata iletisinden sonra kuyruk yeniden doldurulur. Her tür için hazır yıldırım kuyruğu tutar.
- `strike(target, kind, opts)`: hedef (`Terrain.pickTarget` ya da `targetAt`) üzerine olay başlatır ve durum
  döndürür: `'ok'`, `'hiz'` (kullanıcı çakışı hız sınırı: en az 0,4 sn, yumuşak parlamada 3 sn; `opts.user`),
  `'dolu'` (bekleyen kuyruk dolu). Otomatik çakışlar sınırlanmaz.
- Olay başına sim->duvar eşlemesi (`ev.wall`): zaman ölçeği değişince kırılma noktası eklenir; her kare darbe
  başına duvar yaşı (`ev.wAge`, `ev.wTs`) hesaplanır ve hem CPU ışık kaynaklarına hem shader'a (`uStrokeW`) gider.
- Yumuşak parlamada toplam ışık çıkışı `RiseLimiter(4, 0,04)` ile sınırlanır; kazanç ışık kaynaklarına, gök
  parlamasına, yakınlık düzeyine ve kanal kazancına uygulanır.
- Bulut içi olayda akustik kanallar istatistikten önce kurulur; gök gürültüsü gecikmesi en yakın akustik parçadan
  hesaplanır. Geç tamamlanan gök gürültüsü düşürülmez, negatif gecikmeyle ses motoruna verilir.
- Otomatik fırtına: Poisson süreci; karışık kipte bulut içi, negatif, örümcek ve pozitif olayları karıştırır.
  Örümcek yıldırım yarı olasılıkla ileri tarihli bir pozitif çakışla biter.
- Her kare: en parlak 16 ışık kaynağı (bulut geçişinde ilk 10), gök parlaması, yakınlık ağırlıklı parlama
  düzeyi ve pozlama uyumu (yakın flaşta hızlı kısılma, yavaş dönüş).
- Evre bildirimi: kare arasında kalan dönüş darbeleri de bildirilir. Işık eğrisi: fiziksel parlaklık (kalıcılık
  yok) log ölçekte. Yavaş çekim tekrarı `replay(ts)`: son yıldırım tekrarın zaman ölçeğiyle 2 ms (duvar) ön
  payla yeniden başlatılır (gök gürültüsü çalınmaz).
- Olaylar: `strike`, `thunder`, `phase`, `replay`, `error`.

### js/world/terrain.js (dünya)
- `height(x, z)` (orman örtüsüyle), `groundHeight(x, z)`, `lakeField`, `forestMask`, `villageMask`, `isWater`.
- Sahne: kamera (0, 16, 0) göl kıyısında -Z'ye bakar; önde göl, solda yarımada ve adacık, uzak kıyıda köy,
  sağda tepede 150 m radyo kulesi, arkada dağ sırtı.
- `buildMesh()`: kameraya göre kutupsal ızgara (400 halka x 640 ışın, ileri yönden ±`MESH_HALF` = 1,75 rad).
  `buildVillage()`: ~70 köy evi, kilise,
  tepelerde çiftlik evleri, kule ağı ve lambalar (LAMP_STRIDE = 8: x, y, z, boyut, r, g, b, tür).
- `pickTarget(origin, dir)`: ekran ışınından çakış hedefi; gökyüzüne tıklamada bulut tabanı altına iner,
  150 m - 14 km aralığına kırpılır, kuleye yakın hedefler kule ucuna yapışır (paratoner).

### js/audio/thunder.js ve audio.js (ses)
- `Thunder.synth({ acoustic, strokes, listener, sampleRate, seed })`: her akustik parça bir N-dalgası yayar;
  varış = uzaklık / 343 m/s. Görüş hattına dik parçalar kısa ve güçlü çatırtı, paralel olanlar uzun gürleme
  verir. Parçalar 6 uzaklık bandına ayrılır; her bant atmosfer soğurmasını taklit eden alçak geçiren süzgeçten
  geçer. Sonuç normalleştirilir; uzaklığa bağlı kazanç ayrıca döner.
- `AudioEngine`: kullanıcı etkileşimiyle başlar (`init()` Web Audio yoksa false döner); kuru yol + sentetik darbe
  yanıtlı yankı + sıkıştırıcı; pembe ve kahverengi gürültüyle yağmur, rastgele damla sesleri; stereo konum.
  `playThunder(res, gecikme, pan)`: negatif gecikmede ses ofsetle (olması gereken yerinden) başlar, tamamen
  geçmişse çalınmaz.

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
  biriktirmesi kapalıdır. Sürücü kayan noktalı hedefi tamamlayamazsa (`makeTargets` hata verir) programlar
  `LDR_TARGETS` ile yeniden derlenir ve 8 bit yola geçilir (`floatFailed`).
- Yıldırım shader'ı darbe başına duvar yaşını `uStrokeW[8]` (x: duvar yaşı, y: zaman ölçeği) ile alır. Retina izi
  geçişi NaN/sonsuz değerleri sıfırlar. `uTime.x` sim zamanını 3600 sn'de sarar.
- Uyarlamalı kalite (4 düzey). `effectiveFov()` = `math.effectiveFov(yakınlaştırma, en-boy)`: yatay ekranda
  yakınlaştırma açısı aynen, dikey ekranda yatay görüş en az 46° olacak biçimde ölçeklenir (üst sınır 100°);
  yakınlaştırma her ekranda çalışır. `aspect()` en-boy oranı.

### js/ui/ui.js (arayüz)
- Başlangıç kartı: ışığa duyarlılık uyarısı, yumuşak parlama ve ses seçimi (ses kullanıcı etkileşimiyle başlar),
  odak tuzağı. Başlatınca görüş alanında ilk yıldırım.
- Ölçüm cihazı: evre çipi (kısa evreler en az 350 ms görünür), zaman kodu (µs), zaman ölçeği, eşdeğer kare/sn,
  ışık eğrisi (olay başına bir kez çizilir, imleç her karede).
- Son çakış kartı: tür, çarpılan yer, uzaklık, tepe akımı, darbe sayısı, kanal, enerji, öncü süresi;
  gök gürültüsü geri sayımı ve "saniye ÷ 3 = km" notu.
- Ayarlar: tür, dallanma η (değişiklik 350 ms sonra uygulanır), fırtına şiddeti, otomatik fırtına, yağmur, zaman
  ölçeği (1 ... 1/20.000; ekran okuyucu için `aria-valuetext`), ses, pozlama, yumuşak parlama, kalite. Panel
  kapanınca odak panelin içindeyse "Ayarlar" düğmesine döner.
- Kamera: sürükle, tekerlek, iki parmak, ok tuşları; tıklanan yere çakış. Yatay dönüş `math.yawLimit` ile arazi
  ağının kenarı görünmeyecek biçimde sınırlanır. Dar ekranda (≤720 px) açık ayarlar sayfası varken sahneye dokunmak
  sayfayı kapatır. Pencere odağı kaybında basılı tuşlar ve işaretçiler temizlenir.
- Çakış durumu: `'dolu'` bildirim gösterir; `'hiz'` sessizdir, yumuşak parlamada 3 sn kuralı bir kez açıklanır.
- Web Audio yoksa ses düğmesi ve ses düzeyi devre dışı kalır, düğme durumu açıklar (`audioUnavailable`).
- Tekrar bitince önceki hıza dönülür; kullanıcı tekrar sırasında hızı değiştirdiyse onun seçimi korunur.
- Tuval çizimlerindeki renkler ve yazı boyutu CSS belirteçlerinden okunur (`--sodium-soft`, `--curve-fill-*`,
  `--fs-canvas`).
- Kısayollar: Boşluk, R, P, M, H, F, 1-5, oklar, Esc. Basılı tutulan tuşun otomatik tekrarı eylemleri yinelemez;
  odaktaki eylem düğmelerinde (düşür, tekrar, duraklat, ses) tekrar eden Enter/Boşluk yeniden tıklama üretmez.

### js/main.js (önyükleme)
- WebGL2 yoksa ya da shader derlenemezse Türkçe hata ekranı ("Sayfayı yeniden yükle" düğmesiyle). GPU bağlamı
  kaybedilirse (`webglcontextlost`) döngü ve ses durur, aynı hata ekranı gösterilir. `?test` elle ilerleyen saat
  ve korunan çizim tamponu, `?nofloat` 8 bit yedek yol, `?failfloat` kayan noktalı hedef reddini taklit eder,
  `?noworker`, `?q=0..3` sabit kalite.
- `window.__firtina`: `step(ms, n)`, `strikeAt(x, z, kind)`, `exposure` (test için).

## Veri akışı (her kare)

1. `Clock.tick` -> duvar ve simülasyon adımı (zaman ölçeği, duraklatma).
2. `Storm.update` -> otomatik olaylar, bekleyen çakışlar, süresi biten olaylar, ışık kaynakları, evre.
3. `AudioEngine.update` -> yağmur damlaları. Gök gürültüsü, olay başında Worker'da sentezlenip zamanlanır.
4. `Renderer.render(storm.frame())` -> tüm geçişler.
5. `UI.update` -> kamera, evre, zaman kodu, ışık eğrisi imleci, geri sayım (DOM ~15 Hz).

## Test ve derleme

- Birim testleri: `node --test tests/` (65 test). `tests/icerik.test.js` emoji yokluğunu, stil ve arayüz
  betiğinde ham renk/ölçü olmamasını ve başlangıç kartı metnini denetler.
- Duman testi (geliştirme): `PW_CORE=/yol/node_modules/playwright-core node tools/smoke.mjs --browser chromium|webkit`
  senaryolar: calm, strike (worker kullanımı denetlenir), rapid, nofloat ve failfloat (8 bit yolda çakış), kinds,
  slowmo, ui, mobile, perf, bright, a11y (odak dönüşü, Boşluk ve Enter tekrarı, odak kaybı, η gecikmesi,
  "Arayüzü göster" kontrastı, bağlam kaybı, ses yokluğu, alt sayfa dokunuşu, tekrar sonrası hız, kaydırıcı
  değer metni), edge (en geniş açı ve en uç dönüşte dünya kenarı), landscape (yatay telefon ve kısa ekran: eylem
  çubuğu ekranda, kartlar sahnenin %45'inden azını örter, ipucu kartlarla çakışmaz, panel ekran içinde).
- Derleme: `python3 tools/build.py` -> `dist/yildirim-gozlemevi.html` (tek dosya), `dist/artifact.html`.
