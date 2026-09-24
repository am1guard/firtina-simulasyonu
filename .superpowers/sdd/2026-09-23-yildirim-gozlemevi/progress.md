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
Final review: bağımsız inceleyici (opus) tamamladı — 2 kritik, 4 önemli, çok sayıda küçük bulgu.
Final: Ruling: git deposunu kullanıcı 2026-09-24 00:14'te oluşturup ilk commit'i yaptı (am1guard) — commit istenmediği için yine commit yapılmıyor — maliyet: yok.
Final: Ruling (yeniden derecelendirme): MASTER.md emojisi, bileşenlerde ham renk/px, .show-ui kontrastı, başlangıç kartındaki "açık tut" çelişkisi, ses yokken düğme (spec §8), worker çökmesinde üretimin durması, float hedef eksikse yedeğe geçmeme, mobil alt sayfada dışarı dokununca çakış, η klavye ayarında kuyruk taşması, pencere odağı kaybında takılı ok tuşları, geç kalan gök gürültüsünün düşürülmesi, sürekli akım olasılığı (%70 vs spec %30-50) Önemli'ye yükseltildi — kullanıcının açık kuralları, spec gereksinimleri ya da kullanıcıya doğrudan etki — maliyet: daha büyük düzeltme turu.
Final: fixed Kritik 1 (yavaş çekimden çıkınca sahne yeniden parlıyor, yumuşak kip aşılıyor) — tests/storm.test.js 'yavaş çekimden gerçek zamana dönüş sahneyi yeniden parlatmaz (normal ve yumuşak)' ve 'yumuşak kipte ışık çıkışı kare başına sınırlı hızla yükselir', tests/luminosity.test.js duvar yaşı ve RiseLimiter testleri RED→GREEN; GPU sondası (ekran ortalaması, yumuşak): eski 20,1→90,2, yeni 20,1→19,5; suite 65/65
Final: fixed Kritik 2 (basılı Boşluk ~12 Hz flaş) — 'kullanıcı çakışları hız sınırlıdır (normal 0,4 sn, yumuşak 3 sn)' RED→GREEN; duman a11y keyRepeat ve enterRepeat (odaktaki düğmede basılı Enter: eski 1 sn'de 3 çakış, yeni 1) RED→GREEN; suite 65/65
Final: fixed Önemli 3 (dikey ekran kuralı yakınlaştırmayı bozuyor) — tests/math.test.js effectiveFov testleri RED→GREEN; suite 65/65
Final: fixed Önemli 4 (dünyanın kenarı görünüyor) — tests/terrain.test.js ağ kapsama testi ve math yawLimit testi RED→GREEN; duman edge ekran görüntüleri (eski sağ altta kesik, yeni kesintisiz); suite 65/65
Final: fixed Önemli 5 (bulut içi gök gürültüsü geri sayımı sesle uyuşmuyor) — 'bulut içi olayda gök gürültüsü gecikmesi akustik kanaldan hesaplanır' RED→GREEN; suite 65/65
Final: fixed Önemli 6 (ayarlar kapanınca klavye odağı kayboluyor) — duman a11y panelFocusBack RED→GREEN (Chromium ve WebKit); suite 65/65
Final: fixed MASTER.md emojisi — tests/icerik.test.js 'proje dosyalarında emoji yoktur' RED→GREEN; suite 65/65
Final: fixed bileşenlerde ham renk ve px — 'bileşen stillerinde ham renk ve 2px üstü ham ölçü yoktur' ve 'arayüz betiğinde ham renk yoktur' RED→GREEN; suite 65/65
Final: fixed başlangıç kartında "açık tut" çelişkisi — 'başlangıç kartındaki ışığa duyarlılık metni anahtarın varsayılanıyla çelişmez' RED→GREEN; suite 65/65
Final: fixed .show-ui kontrastı — duman a11y showUiContrast 2,88:1 → 12,15:1 RED→GREEN; suite 65/65
Final: fixed ses yokken düğme (spec §8) — duman a11y noAudio RED→GREEN; suite 65/65
Final: fixed worker çökmesi ve hata iletisinde üretimin durması — 'worker çökerse üretim ana iş parçacığına geçer ve kuyruk dolar', 'worker hata iletisinden sonra kuyruk yeniden istenir' RED→GREEN; suite 65/65
Final: fixed kayan noktalı hedef eksikse yedeğe geçmeme — duman failfloat (floatFailed, 8 bit yolda çakış) RED→GREEN; suite 65/65
Final: fixed mobil alt sayfa açıkken dokunuşun çakış düşürmesi — duman a11y sheetTapCloses RED→GREEN; suite 65/65
Final: fixed η klavye ayarında kuyruk taşması — duman a11y etaDebounce RED→GREEN; suite 65/65
Final: fixed pencere odağı kaybında takılı ok tuşları — duman a11y blurClearsKeys RED→GREEN; suite 65/65
Final: fixed geç kalan gök gürültüsünün düşürülmesi — 'geç tamamlanan gök gürültüsü düşürülmez...' ve tests/audio.test.js ofset testleri RED→GREEN (ilk commit koduna karşı doğrulandı); suite 65/65
Final: fixed sürekli akım olasılığı (%70 → spec %30-50) — luminosity CC oranı testi RED→GREEN; suite 65/65
Final: fixed GPU bağlamı kaybında donma — duman a11y contextLost RED→GREEN; suite 65/65
Final: fixed tekrarın ön payı ve tekrar sonunda kullanıcı hızının ezilmesi — 'tekrar, yeni zaman ölçeğiyle kısa bir ön payla başlar' ve duman a11y replayScale (eski [0,005, 1, 1]) RED→GREEN; suite 65/65
Final: fixed zaman ölçeği kaydırıcısında aria-valuetext yokluğu — duman a11y timeValueText RED→GREEN; suite 65/65
Final: Ruling: yumuşak kip sınırlayıcısının tabanı 0,04 (I_REF'in %4'ü); altı serbest — 0,3 tabanı sönük düzeyden 4-8 kat sıçramaya izin veriyordu (test kare başına oranı ölçüyor) — maliyet: yumuşak kipte güçlü flaşın tepeye çıkması ~0,8 sn sürer, tepe daha sönük görünebilir.
Final: Ruling: normal kipte kullanıcı çakış aralığı 0,4 sn (inceleyicinin önerisi, otomatik fırtınayla aynı) — çok darbeli gerçek yıldırım doğası gereği titreşir, koruyucu kip yumuşak parlamadır — maliyet: normal kipte hızlı tıklayan kullanıcı saniyede ~2,5 çakış yapabilir.
Final: Ruling: 'hiz' durumu normal kipte sessiz, yumuşak kipte 10 sn'de bir açıklanır; 'dolu' bildirim verir — her tıklamada bildirim gürültü olurdu — maliyet: 0,4 sn içindeki ikinci tıklama geri bildirimsiz kalır.
Final: Ruling: animasyon süreleri kullanıcının 150-300 ms kuralına çekildi (hedef halkası 650→300 ms, ipucu sönmesi 600→300 ms, başlangıç kartı 320→300 ms) — kullanıcının genel arayüz kuralı — maliyet: tıklama halkası daha kısa görünür.
Final: Ruling: yardım metni 12,5→13 px, başlangıç metni 15,5→16 px (belirteç ölçeğine oturtuldu) — tek yazı ölçeği — maliyet: panel biraz uzar.
Final: Ruling: yatay dönüş için kullanıcı üst sınırı 0,75 rad korundu, geometrik sınır (yawLimit) eklendi ve arazi ağı ±1,75 rad'a (640 ışın) genişletildi — dönüş alanı daralmadan kenar kapanır — maliyet: arazi ağında ~%18 daha çok köşe.
Final: Ruling: uTime.x sarması 1000 sn'den 3600 sn'ye çıkarıldı (tamamen kaldırılmadı) — float32 hassasiyeti 3600 sn'de yeterli — maliyet: saatte bir, tek karelik dalga/yağmur sıçraması.
Final: Ruling: spec güncellendi (kule 150 m, öncü süreleri, kalıcılığın duvar süresi tanımı, ışığa duyarlılık kuralları, kayan nokta yedeği ve bağlam kaybı) — spec metni onaylanan davranışla çelişiyordu; kalıcılık tanımı Kritik 1'in kök nedeniydi — maliyet: spec ilk onaylanan metinden ayrışır.
Final: Ruling: RED doğrulaması git'teki kullanıcı commit'i (b94483f, düzeltme öncesi durum) geçici bir kopyaya açılıp yeni testler ona karşı çalıştırılarak yapıldı — düzeltmelerin bir kısmı test yazılırken zaten uygulanmıştı — maliyet: yok; tüm yeni testler eski kodda kırmızı, yenide yeşil.
Final: minor (deferred): worker'sız kipte eski η ayarının zamanlayıcıları yeni ayarın bekleyen sayacını azaltabilir.
Final: minor (deferred): worker yokken DBM ana iş parçacığında zaman dilimli çalışmıyor (spec §8); yıldırım başına 10-90 ms takılma.
Final: minor (deferred): gök gürültüsü sentezi yıldırım üretimiyle aynı worker kuyruğunu paylaşıyor (η gecikmesi yükü azaltır ama kuyruk önceliği yok).
Final: minor (deferred): yavaş çekime ya da tekrara geçince zamanlanmış gök gürültüsü iptal edilmiyor; tekrar sırasında yapılan çakışın kartı "Yavaş çekimde gök gürültüsü çalınmaz" demeye devam ediyor.
Final: minor (deferred): fare sağ/orta tıklaması çakış düşürüyor; iki parmakla dokunuş iki çakış düşürüyor; lostpointercapture temizliği yok (pencere odağı kaybı temizliği eklendi).
Final: minor (deferred): duraklat ve ses düğmeleri hem aria-label hem aria-pressed değiştiriyor; evre çipinde canlı bölge yok; bildirim ve son çakış canlı bölgeleri gizli başlıyor; bazı etiketler 11-12 px.
Final: minor (deferred): dönüş darbesi evreleri 350 ms tutma kuralına uymuyor (tek karelik görünebilir).
Final: minor (deferred): 8 bit yedek yolda yıldırım ve lambalar kodlanmış uzayda toplanıyor (sönük haleler fazla parlak).
Final: minor (deferred): ölü kod: AudioEngine.stopThunder; örümcek sönme sabiti 0,12 Lum.CONST dışında yineleniyor.
Final: minor (deferred): uyarlamalı kalite 30 Hz kısıtlamasını (Düşük Güç Kipi) GPU aşırı yükü sanıyor; "hareketi azalt" tercihi yalnız açılışta okunuyor.
Final: minor (deferred): duman testinde rapid senaryosu arayüz yolunu atlıyor (klavye yolu a11y ile kapsandı); Firefox bu ortamda başlatılamadığı için denenmedi.
Final: fixed (ön teslim kontrol listesi, ui-ux-pro-max) yatay küçük telefonda eylem çubuğu ekrandan taşıyor ve kartlar sahnenin %66'sını örtüyor — duman landscape 667x375 RED (actionsInside=false, cover=66) → GREEN (cover=22); suite 65/65
Final: fixed (ön teslim kontrol listesi) kısa ekranlarda ipucu hapı son çakış kartıyla çakışıyor — duman landscape hintClear 844x390 ve 932x430 RED → GREEN; suite 65/65
Final: Ruling: yatay küçük telefon (≤720x500) için ayrı sade düzen (marka + ölçüm cihazı üstte, kısa son çakış kartı solda, eylemler tek satır); daha geniş yatay telefonlar masaüstü düzeninde kalır, 560 px altı yükseklikte ipucu ve not gizlenir — ölçümle yeterli bulundu (örtme %24-27) — maliyet: yatay küçük telefonda son çakış ayrıntıları (uzaklık, akım) gizli, yalnız tür ve gök gürültüsü sayacı görünür.
Tests: node --test tests/ → 65/65 pass; duman testi Chromium ve WebKit (calm, strike, rapid, nofloat, failfloat, kinds, slowmo, ui, mobile, a11y, edge, landscape, perf) ve dist/artifact önizlemesi (calm, strike, a11y, landscape) hatasız, konsol hatası yok.
