# Simülasyon Sayfası: Tasarım Geçersiz Kılmaları

> **Proje:** Yıldırım Gözlemevi
> **Sayfa türü:** Tam ekran, etkileşimli WebGL simülasyonu
> Bu dosyadaki kurallar `design-system/yildirim-gozlemevi/MASTER.md` dosyasını **geçersiz kılar**.
> MASTER açık zemin, Inter ve gök mavisi önerir; gece fırtınası sahnesine uymadığı için aşağıdaki kararlar geçerlidir.

---

## Konsept

Arayüz, yüksek hızlı kamera ve laboratuvar ölçüm cihazı dilinde konuşur: ince çizgiler, tek aralıklı veri
okumaları, zaman kodu, osiloskop benzeri ışık eğrisi. Sahne kahramandır; arayüz sessiz, hassas ve ikincildir.
Tek görsel dünya: yalnızca koyu tema (bilinçli tercih). `color-scheme: dark`, tüm renkler açıkça boyanır.

## Renk belirteçleri (tek dosyada, `css/style.css` içinde `:root`)

| Belirteç | Değer | Kullanım |
|----------|-------|----------|
| `--ink` | `#05070D` | Sayfa zemini (mavi eğilimli siyah) |
| `--glass` | `rgba(10, 14, 26, 0.72)` | Panel yüzeyi (arka plan bulanıklığıyla) |
| `--glass-strong` | `rgba(8, 11, 21, 0.9)` | Başlangıç kartı, alt sayfa |
| `--line` | `rgba(168, 178, 222, 0.16)` | Ayraçlar, kenarlıklar |
| `--line-strong` | `rgba(168, 178, 222, 0.32)` | Etkin kenarlık, kaydırıcı rayı |
| `--text` | `#E8EBF5` | Birincil metin (zemin üzerinde ~16:1) |
| `--text-dim` | `#A3ABC4` | İkincil metin (panel üzerinde >= 7:1) |
| `--ion` | `#AEB8FF` | Vurgu: etkin durum, odak halkası, kaydırıcı dolgusu (azot iyon moru-mavisi) |
| `--plasma` | `#F5F3FF` | Parlak vurgu (dönüş darbesi) |
| `--sodium` | `#F4B860` | Ses ve gök gürültüsü bilgisi, uyarılar (sodyum lamba amberi) |
| `--danger` | `#FF7A7A` | Işık hassasiyeti uyarı simgesi |

Evre renkleri (renk tek başına anlam taşımaz; her evre metin etiketiyle birlikte gösterilir):
basamaklı öncü `#B9A4FF`, dönüş darbesi `#F5F3FF`, ok öncü `#8FDBFF`, sürekli akım `#FFA98A`, sakin `#A3ABC4`.

## Tipografi

- Başlık ve etiketler: **Barlow Condensed** (600, büyük harf etiketlerde +0.08em harf aralığı)
- Gövde: **Barlow** (400/500), taban 15-16px, satır yüksekliği 1.5
- Veri: **JetBrains Mono** (400/500), `font-variant-numeric: tabular-nums`
- Yedek yığınlar: `"Barlow Condensed", "Arial Narrow", system-ui, sans-serif`; `ui-monospace, "SF Mono", Menlo, monospace`
- Sayılar `tr-TR` biçiminde: ondalık virgül, binlik nokta (ör. `3,4 km`, `30.000 K`).

## Yerleşim

- Masaüstü: sol üstte marka bloğu, sağ üstte cihaz (HUD: evre, zaman kodu, ışık eğrisi), sağda açılır kontrol
  paneli, sol altta son çakış kartı, alt ortada birincil eylem.
- Mobil (< 720px): kontrol paneli alt sayfaya dönüşür (varsayılan kapalı), HUD sıkışık tek satır, kartlar daralır.
- Güvenli alan: sabit öğeler `env(safe-area-inset-*)` ekler. Sayfa yatay kaydırılmaz. Kenar boşluğu >= 16px.
- z-index ölçeği: sahne 0, HUD 10, paneller 20, alt sayfa 30, başlangıç kartı 40, bildirim 50.

## Bileşenler

- Birincil düğme ("Yıldırım düşür"): tek birincil eylem; `--ion` kenarlık ve iç parıltı, 48px yükseklik.
- İkincil düğmeler: cam zemin, `--line-strong` kenarlık, 44px min dokunma alanı.
- Kaydırıcılar: 44px dokunma yüksekliği, ince ray, `--ion` dolgu, değer etiketi her zaman görünür (tabular).
- Parçalı seçici (yıldırım türü): radyo grubu semantiği, etkin öğe dolgulu.
- Anahtarlar: `role="switch"` ve `aria-checked`.
- Simgeler: Lucide tarzı satır içi SVG, 1.5px çizgi, 20px; emoji kullanılmaz.

## Etkileşim ve erişilebilirlik

- Odak: 2px `--ion` halka, 2px ofset; klavye kısayolları: Boşluk, R, P, M, H, F, 1-5.
- Geçişler 160-240ms, `ease-out` giriş; `prefers-reduced-motion` ile UI animasyonları kapanır ve
  "Yumuşak parlama" varsayılan açılır.
- Işık hassasiyeti: başlangıç kartında uyarı; yumuşak parlama modu ani parlaklık değişimlerini süzer.
- Tüm simge düğmelerde `aria-label`; HUD evre bilgisi `aria-live="polite"`.
