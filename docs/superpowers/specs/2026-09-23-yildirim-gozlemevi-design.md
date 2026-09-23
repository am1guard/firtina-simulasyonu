# Yıldırım Gözlemevi: Tasarım (Spec)

Tarih: 2026-09-23 · Durum: onaylandı (otonom ilerleme)

## 1. Amaç ve başarı ölçütü

"Yapabildiğin en iyi yıldırım simülasyonu" isteği için, tarayıcıda çalışan, fiziğe dayalı ve sinematik bir
gece fırtınası simülasyonu. Yan klasördeki `fırtına simulasyon/storm-lab` (sabit görsel + Canvas 2D rastgele
çizgi) kıyas tabanıdır.

Başarı ölçütleri:
- Yıldırım geometrisi el ile çizilmez; dielektrik kırılma modeliyle (DBM) üretilir, dallanma rekabeti gerçektir.
- Bir çakışın gerçek evreleri görülebilir: basamaklı öncü, yukarı bağlantı öncüleri, dönüş darbesi, ok öncü ve
  ardışık darbeler, sürekli akım. Yavaş çekimde (1/20.000'e kadar) izlenebilir.
- Sahne ışığı yıldırımdan gelir: bulutlar içeriden aydınlanır, göl yansıtır, yağmur parlar, tepeler siluet olur.
- Gök gürültüsü kanalın geometrisinden sentezlenir; gecikme mesafe / 343 m/s'dir.
- M4 sınıfı donanımda 1080p'de akıcı (hedef 60 kare/sn), zayıf cihazda uyarlamalı kaliteyle çalışır.
- `index.html` çift tıklamayla (file://) açılır; çalışma zamanı bağımlılığı yoktur. Arayüz Türkçedir.

Kapsam dışı: fotoğraf/video dışa aktarma, çok oyunculu durum, kalıcı veri, mobil için ayrı sahne.

## 2. Mimari

Klasik `<script>` dosyaları (ES modülü değil; file:// üzerinde CORS sorunu olmaması için), tek global ad alanı
`FIRTINA`. DBM hesabı bir Web Worker'da çalışır; worker kaynağı `Function.prototype.toString` ile Blob'dan kurulur.

```
index.html                 İşaretleme, script sırası
css/style.css              Tasarım belirteçleri ve arayüz
js/core/math.js            vec3/mat4, RNG (mulberry32), 2B değer gürültüsü, fbm
js/core/gl.js              WebGL2 yardımcıları: program, doku, FBO, tam ekran üçgen
js/sim/dbm.js              DBM üreteci + ağaç işleme (DOM yok; Node'da test edilir)
js/sim/luminosity.js       Kanal parlaklık zaman modeli (GLSL ile birebir eş)
js/sim/storm.js            Fırtına denetleyicisi: olay zamanlama, türler, ışık kaynakları
js/world/terrain.js        Yükseklik işlevi, arazi ağı, köy, kule, ışın-arazi kesişimi
js/audio/thunder.js        Gök gürültüsü sentezi (saf işlev, Node'da test edilir)
js/audio/audio.js          Web Audio motoru: yağmur ambiyansı, gök gürültüsü çalma
js/render/shaders.js       Tüm GLSL kaynakları
js/render/renderer.js      Geçişler, çerçeve tamponları, çizim
js/ui/ui.js                Arayüz bağları, HUD, ışık eğrisi, başlangıç kartı, klavye
js/main.js                 Önyükleme, ana döngü, test kancaları
tests/*.test.js            node:test birim testleri
tools/build.py             Tek dosyalık dağıtım ve Artifact sürümü üretir
tools/smoke.mjs            Playwright ile tarayıcı duman testi ve ekran görüntüsü
```

Veri akışı (her kare):
1. `simT += dtDuvar * zamanÖlçeği` (duraklatılmamışsa).
2. `storm.update`: otomatik olaylar, worker'dan gelen yıldırımlar, darbe zaman çizelgeleri, ışık listesi (<= 16).
3. `audio`: gerçek zamanlı yeni çakışlar için gök gürültüsü tamponu sentezlenir ve gecikmeli çalınır.
4. `renderer.render`: bulut (yarım çözünürlük) -> yansıma (yarım) -> ana HDR -> bloom -> iz -> ton eşleme.
5. `ui.update`: DOM metinleri ~15 Hz, ışık eğrisi her kare.

## 3. Fizik: DBM üreteci (`js/sim/dbm.js`)

- 3B ızgara, 26 komşuluk. Desen (kanal) hücreleri nokta yük olarak ele alınır (FSLG yaklaşımı):
  aday i için tarama toplamı `S_i = Σ_j R / r_ij` (R = 0,5 hücre), her yeni hücrede tüm adaylara artımlı eklenir.
- Potansiyel: arka plan alanı `B(y)` (başlangıçta 0, zeminde 1) ile tarama birleşir; yükler arka plan
  potansiyeliyle ağırlıklanır (uca yakın dallanma daha olası). Normalize edilmiş potansiyelden
  `p_i ∝ Φ_i^η` ile örnekleme. η kullanıcıya "Dallanma" olarak açılır (varsayılan ayar testle belirlenir).
- Sonlanma: bir hücre zemine bir hücre mesafeye indiğinde. Yukarı bağlantı öncüsü son ~40 m'yi yeniden zamanlar.
- Ağaç işleme: ana kanal (zemin -> kök yolu), dal seviyeleri, küçük dal budama, zincirlere ayırma, yumuşatma +
  kafes kırıcı titreşim, 3 düzey orta nokta sapmasıyla fraktal ayrıntı.
- Köşe öznitelikleri: konum, öncü varış zamanı (DBM adım sırası, 0..1), dönüş darbesi yol mesafesi `s`
  (dallarda kavşak + yavaşlatılmış dal mesafesi), parlaklık ağırlığı `w`, genişlik, bayraklar (ana, dal, bulut içi,
  başarısız akıntı), darbe maskesi (ardışık darbelerde hangi bulut içi dalların yanacağı).
- Türler: negatif bulut-yer (varsayılan), pozitif bulut-yer (daha yüksek başlangıç, az dal, tek güçlü darbe, uzun
  sürekli akım), örümcek (bulut tabanı altında ince yatay katman, radyal arka plan alanı, yavaş yayılım).
  Bulut içi (IC) olaylar kanal üretmez; bulut içinde titreşen ışık kaynaklarıdır.
- Çıktı, konumdan bağımsızdır (çarpma noktası orijine göre); yerleştirme bir öteleme ile yapılır. Worker her tür için
  1-2 hazır yıldırım kuyruğu tutar; tıklamaya anında yanıt verilir.

## 4. Parlaklık zaman modeli (`js/sim/luminosity.js` ve GLSL eşi)

Gerçek süreler (sim zamanı): basamaklı öncü 20-35 ms; dönüş darbesi hızı ~1e8 m/s; darbe arası 40-80 ms
(log-normal); ok öncü ~1,5e7 m/s; sürekli akım %30-50 olasılıkla 40-250 ms.

Köşe parlaklığı `L(v,t)`:
- Öncü: varıştan sonra zayıf kanal + uçta üstel sönen parlama (uçlar parlak, arka zayıf).
- Dönüş darbesi k: cephe `t_k + s_v / v_rs` anında gelir; `A_k * w_v * (0,8 e^{-Δ/60µs} + 0,2 e^{-Δ/1,5ms})`
  artı algısal kalıcılık terimi `0,35 A_k w_v e^{-Δ_duvar/70ms}` (Δ_duvar = Δ / zamanÖlçeği). İlk darbe dalları yakar,
  sonrakiler yalnızca ana kanalı ve maskedeki bulut içi dalları.
- Ok öncü: ana kanalda yukarıdan aşağı parlak uç.
- Sürekli akım: ana kanalda düşük düzey, M-bileşeni darbeleriyle.
Aynı işlev CPU'da ışık kaynakları ve ışık eğrisi için, GPU'da köşe başına kullanılır.

## 5. Görüntü (WebGL2, HDR)

- Birimler metre, y yukarı, göl yüzeyi y = 0, kamera ~(0, 18, 0) ve -Z'ye bakar. Sürükleyerek sınırlı bakış,
  tekerlekle FOV yakınlaştırma.
- Bulutlar: 3B gürültü dokusu (GPU'da katman katman üretilir), 1300-5500 m katmanında ışın yürütme (yarım
  çözünürlük, titreşimli başlangıç). Işık kaynaklarından difüzyon benzeri saçılma + tek örnekli gölge,
  şehir ışığı alt aydınlatması, ortam ışığı.
- Hava ışığı (airlight): ışık kaynakları için analitik tek saçılma integrali; yağmurda yıldırım çevresinde hale.
- Arazi: kutupsal ızgara ağı (kameraya yakın sık), göl, ormanlı tepeler (gölgelik tümsekleri), uzak dağlar;
  Lambert + gökyüzü parlaması (yukarı bakan yüzeyler) + ıslak parlaklık.
- Köy: ~70 ev (kutu + çatı), prosedürel pencereler (sıcak ışık), kilise kulesi, sokak lambaları.
- Radyo kulesi: 120 m, üç kat kırmızı ikaz lambası; 350 m yarıçap içindeki hedefleri kendine çeker.
- Göl: ayna kamerasıyla düzlemsel yansıma (yarım çözünürlük), yağmur halkası normalleri, rüzgâr dalgaları,
  mesafeyle artan dikey bulanıklık (ışık şeritleri), Fresnel.
- Yıldırım: örneklenmiş kapsül parçaları; ekran uzayında mesafe profiliyle çekirdek + hale; alt piksel genişlikte
  enerji korunumu; bulut tabanı üstünde sönümlenme; mesafeyle sönüm ve sıcak renk kayması.
- Yağmur: kamera etrafında örneklenmiş çizgiler; yavaş çekimde donar; yıldırımla aydınlanır.
- Son işlem: çok seviyeli bloom, retina izi (düşük çözünürlüklü kalıcılık tamponu), ACES ton eşleme, vinyet,
  hafif renk sapması, film grenı. Uyarlamalı çözünürlük ölçeği.

## 6. Ses (`js/audio/*`)

- Gök gürültüsü: kanal ~15 m akustik parçalara bölünür; her parça bir N-dalgası yayar. Varış = mesafe / 343 m/s.
  Yönelim etkisi: görüş hattına dik parçalar kısa ve güçlü "çatırtı", paralel olanlar uzamış ve zayıf.
  Mesafe bantlarına göre alçak geçiren süzgeç (atmosfer soğurması), yankı (sentetik darbe yanıtı), sıkıştırıcı.
  Her dönüş darbesi kendi katkısını ekler.
- Yağmur ambiyansı: süzülmüş pembe/kahverengi gürültü; yağmur ayarıyla ölçeklenir.
- Ses yalnızca kullanıcı etkileşimiyle açılır. Yavaş çekimde gök gürültüsü çalınmaz.

## 7. Arayüz

Tasarım kuralları: `design-system/yildirim-gozlemevi/pages/simulasyon.md`.
- Başlangıç kartı: kısa tanıtım, ışık hassasiyeti uyarısı, "Yumuşak parlama" anahtarı, "Ses açık" seçeneği,
  "Fırtınayı başlat". Arkasında sahne sakin haliyle canlıdır (yalnızca yavaş, düşük kontrastlı bulut içi ışımalar).
- HUD: evre çipi, zaman kodu (µs çözünürlük), zaman ölçeği ve eşdeğer kare hızı, ışık eğrisi (log ölçek, darbe
  etiketleri, imleç).
- Kontrol paneli: tür (Karışık, Negatif, Pozitif, Bulut içi, Örümcek), dallanma η, fırtına şiddeti (çakış/dk),
  yağmur, zaman ölçeği (1 ... 1/20.000, hazır ayarlar), ses düzeyi, otomatik fırtına, yumuşak parlama.
- Eylemler: "Yıldırım düşür" (Boşluk), "Yavaş çekim tekrar" (R), duraklat (P), ses (M), arayüzü gizle (H),
  tam ekran (F), tür kısayolları (1-5).
- Son çakış kartı: tür, çarpılan yer (kule/göl/tepe/köy), mesafe, tepe akımı, darbe sayısı, kanal uzunluğu,
  enerji tahmini, gök gürültüsü geri sayımı.

## 8. Hata durumları

- WebGL2 yok: açıklayıcı Türkçe mesaj ve öneri.
- Kayan nokta render hedefi yok: RGBA8 yedek yolu (daha düşük dinamik aralık).
- Shader derleme hatası: hangi shader ve satır olduğu konsola ve ekrana yazılır.
- Worker kurulamazsa: DBM ana iş parçacığında zaman dilimli çalışır.
- AudioContext yoksa veya reddedilirse: sessiz devam, ses düğmesi devre dışı.
- Sekme gizlenince: simülasyon ve ses duraklar; dönünce büyük dt sıçraması kırpılır.

## 9. Test

- Birim (node:test, bağımlılık yok): DBM (kanal zemine bağlı, ağaç bağlı, öznitelik monotonlukları, süre bütçesi),
  parlaklık modeli (varıştan önce sıfır, darbede tepe, sönüm), gök gürültüsü (sonlu değerler, ilk varış gecikmesi).
- DBM görsel düzeneği: Node'da 2B izdüşüm PNG'si üretip parametre ayarı.
- Tarayıcı duman testi (Playwright Chromium ve WebKit, başsız): konsol hatası yok, tüm shader'lar derlenir,
  elle saat modunda (`?manual=1`) sakin sahne ve dönüş darbesi tepesi ekran görüntüleri.
