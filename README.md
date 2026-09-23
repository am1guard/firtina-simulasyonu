# Yıldırım Gözlemevi

Tarayıcıda çalışan, fiziğe dayalı bir gece fırtınası ve yıldırım simülasyonu.

- Her yıldırım **dielektrik kırılma modeliyle** (DBM) yeniden hesaplanır. Dallanma rekabeti gerçek bir Laplace
  büyümesinden gelir; η ayarı dallanmayı değiştirir.
- Bir çakışın evreleri izlenebilir: basamaklı öncü, yukarı bağlantı öncüleri, ışık hızının üçte biriyle yukarı
  ilerleyen dönüş darbesi, ok öncü ve ardışık darbeler, sürekli akım. Zaman ölçeği 1/20.000'e kadar düşer.
- Sahne ışığı yıldırımdan gelir: bulutlar içeriden aydınlanır, göl yansıtır, yağmur parlar, tepeler siluet olur.
- Gök gürültüsü kanalın geometrisinden sentezlenir ve sana 343 m/s ile ulaşır; flaşla ses arasındaki süre
  uzaklığı verir (saniye ÷ 3 = km).
- Türler: negatif ve pozitif bulut-yer, bulut içi, örümcek (yatay). Radyo kulesi yıldırımı kendine çeker.

## Çalıştırma

`index.html` dosyasını tarayıcıda aç (çift tıklama yeterli; sunucu gerekmez). Tek dosyalık sürüm:
`dist/yildirim-gozlemevi.html`. WebGL2 destekleyen güncel bir tarayıcı gerekir (Chrome, Safari, Firefox, Edge).

## Kullanım

| Eylem | Nasıl |
|---|---|
| Belirli bir noktaya yıldırım | Sahneye tıkla |
| Görüş alanına rastgele yıldırım | Boşluk ya da "Yıldırım düşür" |
| Son yıldırımı yavaş çekimde izle | R ya da "Yavaş çekim" |
| Etrafa bak / yakınlaştır | Sürükle, ok tuşları / tekerlek, iki parmak |
| Duraklat, ses, arayüzü gizle, tam ekran | P, M, H, F |
| Tür seç | 1 Karışık, 2 Negatif, 3 Pozitif, 4 Bulut içi, 5 Örümcek |

Işığa duyarlılık: simülasyon ani ve parlak ışıklar içerir. Ayarlardaki **Yumuşak parlama** modu ani parlaklık
değişimlerini süzer; işletim sisteminde "hareketi azalt" açıksa varsayılan olarak açılır.

## Geliştirme

- Birim testleri: `node --test tests/`
- Derleme: `python3 tools/build.py`
- Yapı ve modüller: `AGENTS.md`

Değerler görsel ve işitsel simülasyona aittir; meteorolojik ölçüm değildir.
