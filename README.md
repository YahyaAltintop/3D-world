# 🌍 3B Dünya Atlası

Vue 3 + Three.js ile yapılmış, serbestçe gezilebilen interaktif 3B dünya
küresi. Dünyadaki tüm ülkelerin (~177) sınırları küre üzerinde çizilir;
kameraya bakan ülkelerin isimleri kürenin üzerinde belirir. Küre boşta
yavaşça kendi etrafında döner. Arayüz Türkçe ve İngilizce'dir: ilk açılışta
tarayıcının dili esas alınır, sağ üstteki TR/EN düğmeleriyle değiştirilebilir.

## Kontroller

| Eylem | Nasıl |
| --- | --- |
| Küreyi döndür | Fareyle/parmakla sürükle (ok tuşları da çalışır) |
| Yakınlaş / uzaklaş | Fare tekerleği, kıstırma (pinch) veya ＋/－ butonları |
| Ülke bilgisi | Ülkeye tıkla → bayrak + isim + başkent + nüfus + yüzölçümü kartı; ülkenin içi bayrağının baskın rengiyle boyanır |
| İsim baloncuğu | Fareyle ülkenin üzerine gel |
| Seçimi kapat | Okyanusa tıkla ya da `ESC` |
| Görünümü sıfırla | ⟲ butonu |
| Dil değiştir | Sağ üstteki TR / EN düğmeleri |

## Çalıştırma

```bash
npm install
npm run dev
```

Ardından tarayıcıda `http://localhost:5173` adresini aç (port doluysa
Vite başka bir port seçer).

Üretim derlemesi için:

```bash
npm run build
npm run preview
```

## Yayınlama (Firebase Hosting)

Site Firebase Hosting üzerinde barınır. `main` dalına atılan her push,
[GitHub Actions iş akışıyla](.github/workflows/deploy.yml) otomatik olarak
canlıya alınır; pull request'lerde ise geçici bir önizleme kanalı oluşturulup
URL'si PR'a yorum olarak yazılır (fork'lardan gelen PR'larda secret'lar
bulunmadığından yalnızca build doğrulaması yapılır).

Kendi Firebase projenle yayınlamak için repoya iki secret eklemen yeterli
(**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Değer |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Firebase proje kimliği (ör. `benim-projem-1234`) |
| `FIREBASE_SERVICE_ACCOUNT` | Deploy yetkili servis hesabının JSON anahtarının içeriği (tamamı) |

Servis hesabı anahtarı almak için:

1. [Google Cloud Console → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   sayfasında Firebase projeni seçip yeni bir servis hesabı oluştur.
2. Hesaba **Firebase Hosting Admin** rolünü ver.
3. Hesabın **Keys** sekmesinden JSON anahtar üret ve dosyanın içeriğini
   olduğu gibi `FIREBASE_SERVICE_ACCOUNT` secret'ına yapıştır.

> Kestirme: `firebase init hosting:github` komutu servis hesabını ve secret'ı
> senin için oluşturur. Komutun ürettiği iş akışı dosyalarını silip bu
> repodakini kullanabilirsin; yalnızca oluşan secret'ın değerini
> `FIREBASE_SERVICE_ACCOUNT` adıyla yeniden eklemen gerekir (secret adında
> proje kimliği geçmesin diye).

### Elle (lokal) deploy

Proje kimliği repoda tutulmaz — `.firebaserc` gitignore'dadır.
[.firebaserc.example](.firebaserc.example) dosyasını `.firebaserc` adıyla
kopyalayıp kendi proje kimliğini yaz, sonra:

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Nasıl çalışıyor?

- **Harita verisi:** [`world-atlas`](https://www.npmjs.com/package/world-atlas)
  paketindeki Natural Earth ülke sınırları (TopoJSON), `topojson-client` ile
  GeoJSON'a çevrilip küre üzerine çizgi geometrisi olarak yerleştiriliyor.
- **Dil desteği (tr/en):** [`src/lib/i18n.js`](src/lib/i18n.js) — ilk
  açılışta tarayıcı dili (Türkçe değilse İngilizce), elle yapılan seçim
  `localStorage`'da saklanır; sekme başlığı ve `<html lang>` da dille birlikte
  güncellenir.
- **Ülke isimleri:** Tarayıcının `Intl.DisplayNames` API'siyle ISO ülke
  kodlarından aktif dile göre otomatik üretiliyor (`i18n-iso-countries` ile
  sayısal kod → alpha-2 dönüşümü yapılır); başkentler iki dilde
  [`src/data/capitals.js`](src/data/capitals.js), nüfuslar
  [`src/data/populations.js`](src/data/populations.js) dosyasında.
- **Bayraklar:** [flagcdn.com](https://flagcdn.com) üzerinden alpha-2 koduyla
  yüklenir (çevrimdışıysa kart bayraksız gösterilir). Seçili ülkenin sınır
  rengi, bayrak görselinden çıkarılan baskın canlı renktir
  ([`src/lib/flagColor.js`](src/lib/flagColor.js)); çıkarılamazsa altın kalır.
- **Nüfus ve yüzölçümü:** [`src/data/populations.js`](src/data/populations.js)
  ve [`src/data/areas.js`](src/data/areas.js) dosyalarında statik olarak durur.
- **Tıklama algılama:** Fare ışını (raycast) küreye çarptığı noktayı
  enlem/boylama çevirir, nokta-çokgen (even-odd) testiyle hangi ülkenin
  sınırları içinde olduğu bulunur.
- **Seçim dolgusu:** Seçilen ülkenin çokgenleri
  [`src/lib/fill.js`](src/lib/fill.js) içinde üçgenlenir (earcut; delikler
  korunur, antimeridyeni geçen halkalar sarmal açılır), üçgenler küre
  yüzeyine oturacak şekilde alt bölümlere ayrılır ve bayrağın baskın
  rengiyle boyanır.

## Özelleştirme

- Renkler `src/components/GlobeCanvas.vue` başındaki `BASE_LINE` / `HI_LINE`
  sabitlerinde; zum sınırları `ZOOM_MIN` / `ZOOM_MAX`, açılış görünümü `HOME`.
- Başkent eklemek/düzeltmek için `src/data/capitals.js` (ISO sayısal kod →
  Türkçe ad).
