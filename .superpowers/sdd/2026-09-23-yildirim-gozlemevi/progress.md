# SDD ledger — plan: docs/superpowers/plans/2026-09-23-yildirim-gozlemevi.md

Spec: docs/superpowers/specs/2026-09-23-yildirim-gozlemevi-design.md (okundu)

Ruling: Proje git deposu değil; git init ve commit yapılmıyor — sistem talimatı yalnızca istenince commit der, kullanıcı istemedi — maliyet: görev başına geçmiş yok, bu kayıt dosyası telafi eder.
Ruling: Görev başlatma/bitirme betikleri (task-start, task-done) git gerektirdiği için kullanılmıyor; testler elle çalıştırılıp sonuç bu dosyaya yazılıyor — maliyet: otomatik kayıt yok.

Pre-flight:
- G1 -> G4: BoltData.acoustic düzeni (x,y,z,dx,dy,dz,len,weight,main) = 9 float; Thunder.synth bunu tüketir. Ruling: dinleyici konumu yıldırımın yerel koordinatında verilir (storm, listener - offset hesaplar) — yerleştirme ötelemesi GPU'da uygulanır.
- G1 -> G5/G6: SEG_STRIDE = 16 düzeni renderer ve Lum.vertex tarafından aynı sırayla okunur.
- G2 -> G5: GLSL boltLum ile Lum.vertex aynı sabitleri kullanır; sabitler Lum.CONST içinde tek yerde.
- G3 -> G6/G7: pickTarget(origin, dir) dünya koordinatı döndürür; kule yapışması pickTarget içinde.
Task 1: Ruling: potansiyel yaklaşımı plandaki "q_j = B(y_j)" yerine öz tutarlı yük (q = seçildiği andaki Φ) oldu — B ağırlıklı yükler ya çok seyrek ya da tepede gür fırça üretti (önizleme PNG'leri), öz tutarlı yük uçta alan güçlenmesini doğal üretiyor — maliyet: tam Laplace çözümüne göre yaklaşık kalıyor, görsel olarak doğrulandı.
Task 1: Ruling: pozitif yıldırım dal testi mutlak sayı yerine km başına yoğunluğu karşılaştırıyor — pozitif kanal ~2 kat uzun, mutlak sayı niyeti ölçmüyordu — maliyet: yok.
Task 1: Ruling: varsayılan η 1,7 (kullanıcı ayarı), cgp +1,2, örümcek -0,4; bgPow 0,7, radialPow 0,45, budama 0,4 — önizlemeyle seçildi.
Task 1: complete (tests: node --test tests/dbm.test.js → 10/10 pass)
Task 2: Ruling: js/core/math.js Görev 1 yerine Görev 2'de yazılıyor — DBM kendi içinde bağımsız (worker için), math.js'i ilk tüketen Lum ve arazi — maliyet: yok.
Task 2: complete (tests: node --test tests/luminosity.test.js tests/dbm.test.js → 24/24 pass)
Task 2: Ruling: FlashLimiter kazanç değil yumuşatılmış sinyal döndürür; yumuşak parlama Lum.vertex(..., soft) içinde zarfla uygulanır — kaynak sönünce kazanç parlaklığı yumuşatamaz — maliyet: shader'da soft dalı.
Task 3: complete (tests: node --test tests/terrain.test.js → 8/8 pass; toplam 32/32)
Task 3: Ruling: kule yapışması hedef noktası 350 m ölçütüne ek olarak ışının kule eksenine 150 m'den yakın geçmesiyle de tetiklenir — ekranda kuleye yakın tıklamak sezgisel olarak kuleyi hedefler — maliyet: kule çevresinde biraz daha geniş yapışma alanı.
Task 4: complete (tests: node --test tests/thunder.test.js → 6/6 pass; toplam 38/38; audio.js tarayıcı duman testinde doğrulanacak)
Task 4: Ruling: gök gürültüsü sentezi worker'da çalışacak şekilde tek fonksiyon modülü (THUNDER_MODULE_SOURCE) — ana iş parçacığında 20-40 ms takılma olmasın diye — maliyet: yok.
Task 5: complete (duman testi: tools/smoke.mjs chromium calm/strike/bright/perf → konsol hatası yok, glError=0, 1600x900 @ 60 kare/sn; görsel kalibrasyon ekran görüntüleriyle yapıldı)
Task 5: Ruling: lamba verisi düzeni x,y,z,boyut,r,g,b,tür olarak değiştirildi — shader iki vec4 okuyor, eski düzen renkleri bozuyordu — maliyet: yok.
Task 5: Ruling: ışık ölçeği I_REF 1.2e7 -> 2.5e6, hava ışığı saçılması ~1/3, kanal kazancı 150 — ekran görüntülerinde sahne beyaza doyuyordu — maliyet: çok yakın çakışlarda daha az parlama (ayar gerektirebilir).
Task 5: Ruling: bulut tabanı ters Worley keseleriyle (mammatus) şekillendirildi, ortam ışığı düz tabana göre söner — düz tabanda doku görünmüyordu — maliyet: bulut geçişinde örnek başına 1 ek doku okuması.
Task 6: complete (storm.js + main.js; duman testi strike senaryosu olay başlatıyor, evreler ve istatistikler üretiliyor; tests 40/40)
Task 6: Ruling: bulut içi (IC) olaylar Lum.vertex içinde ayrı dal — öncü süresi 0 iken t=0'da NaN üretiyordu (test: 'bulut içi (IC) darbeleri...') — maliyet: yok.
Task 7: complete (arayüz: index.html, css/style.css, js/ui/ui.js; duman testi ui+mobile chromium ve webkit hatasız, yatay taşma yok)
Task 7: Ruling: dönüş darbesi evresi (~4 ms) kare aralarında atlanıyordu; storm.updatePhase bu karede geçilen darbeyi ayrıca bildiriyor — regresyon testi tests/storm.test.js (eski davranışta 0/2 darbe bildiriliyordu, doğrulandı) — maliyet: yok.
Task 7: Ruling: dikey ekranlarda yatay görüş en az 46° (renderer.effectiveFov) — 390px genişlikte yıldırım kadraj dışında kalıyordu — maliyet: dikey ekranda daha geniş açı.
Task 7: Ruling: retina izi yalnızca söndükten sonraki artık olarak ve zayıf eklenir; yakın flaşlarda pozlama uyumu (25 ms kısılma, 0,6 sn dönüş) — yakın çakışlar sahneyi beyaza boğuyor, iz bulanık hayalet bırakıyordu — maliyet: flaş anında sahne biraz daha koyu.
Tests: node --test tests/ → 45/45 pass
Task 8 (kısmi): build.py, AGENTS.md, README.md yazıldı; dist yeniden üretildi; tests 45/45
Task 8: Ruling: 8 bit yedek yolda HDR küp kök kodlanır, yağmur ve bloom biriktirmesi kapalı — toplamsal karışım kodlanmış uzayda aşırı parlatıyordu — maliyet: nadir cihazlarda daha sade görüntü.
