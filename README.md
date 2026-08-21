# Buzsu Sosyal Medya Otomasyonu

Airtable'daki `Sosyal Medya Takvimi` tablosundan onaylı içerikleri okuyup Instagram/Facebook paylaşım sürecine hazırlayan uygulama. Bağımsız bir repo (`gumustasas/buzsu-social-publisher`); Vercel projesi doğrudan bu reponun kökünü izler.

## Güvenli çalışma mantığı

- `Taslak` kayıtlar paylaşılmaz.
- `Kontrol Edilecek` kayıtlar paylaşılmaz.
- Sadece `Durum = Onaylandı` ve `Yayın Zamanı` dolu, zamanı gelmiş kayıtlar işleme alınır.
- Eski metin türündeki `Yayın Tarihi` alanı yayın tetiklemez.
- İlk sürüm `dry-run` modundadır; sosyal medyada paylaşım yapmaz.
- Meta API bilgileri eklenene kadar Instagram/Facebook gönderimi kapalıdır.
- Canlı gönderim açıldığında varsayılan sınır tek kayıttır (`SOCIAL_POST_LIMIT=1`).
- Instagram gönderisi için Airtable'da herkese açık HTTPS `Görsel URL` alanı dolu olmalıdır.

## Kurulum

1. Repoyu klonlayıp klasöre girin:

```powershell
git clone https://github.com/gumustasas/buzsu-social-publisher
cd buzsu-social-publisher
```

2. Paketleri kurun:

```powershell
npm install
```

3. `.env.example` dosyasını `.env` olarak kopyalayın ve Airtable token değerini girin.

```powershell
Copy-Item .env.example .env
```

4. Test çalıştırın:

```powershell
npm run check
npm run dry-run
```

5. Paylaşım güvenlik kontrolünü çalıştırın:

```powershell
npm run publish:dry-run
```

Bu komut varsayılan olarak canlı paylaşım yapmaz. Sadece `ENABLE_LIVE_POSTING=true` yapılırsa ve Meta bilgileri eksiksiz girilirse canlı gönderim adımına geçilecek şekilde tasarlanmıştır.

Canlı API değişkenleri:

```text
META_ACCESS_TOKEN=
META_APP_SECRET=
META_FACEBOOK_PAGE_ACCESS_TOKEN=
META_INSTAGRAM_ACCOUNT_ID=
META_FACEBOOK_PAGE_ID=
META_GRAPH_VERSION=
SOCIAL_POST_LIMIT=1
ENABLE_LIVE_POSTING=false
```

Canlı gönderimden önce tek bir Airtable kaydı `Onaylandı` yapılmalı, `Görsel URL` herkese açık HTTPS adresi olmalı ve Meta bağlantısı test edilmelidir.

## Yayın kuyruğu ve onay paneli

`dashboard.html` dosyası önizleme ve onay ekranıdır. Vercel adresinin sonuna `/dashboard.html` ekleyerek açabilirsiniz. Ekranda `CRON_SECRET` girilmeden kayıtlar okunmaz; bu değer tarayıcıda kalıcı olarak saklanmaz.

- `Kontrol Edilecek` ve `Taslak` kayıtlar yayınlanmaz.
- `Onaylandı` kayıtlar zamanı geldiğinde kuyruğa alınır.
- Yayın öncesi kayıt `Yayınlanıyor` durumuna alınır ve 10 dakikalık kilit yazılır.
- İşlem yarıda kalırsa kilit süresi dolunca kayıt tekrar işlenebilir.
- Başarılı ve başarısız sonuçlar `Not` alanında son 30 olay olarak tutulur.
- Platformlardan biri yayınlanıp diğeri başarısız olursa yalnızca eksik platform tekrar denenir.
- `SOCIAL_POST_LIMIT` varsayılan olarak 1 kalır; aynı cron çalışmasında toplu yayın yapılmaz.

Meta bağlantı kontrolü:

```powershell
npm run check:meta
```

Facebook sayfa tokenını kullanıcı tokenından yerelde almak için:

```powershell
npm run bootstrap:page-token
```

Graph Explorer tokenını uzun süreli kullanıcı tokenına çevirmek için:

```powershell
npm run exchange:long-lived
```

## Token kontrolü

```powershell
npm run check
```

Bu komut gizli değerleri ekrana yazmaz. Sadece gerekli alanların dolu veya eksik olduğunu bildirir.

## Airtable alanları

Tablo: `Sosyal Medya Takvimi`

- `Başlık`
- `İçerik Türü`
- `Kaynak URL`
- `Görsel URL`
- `Instagram Metni`
- `Facebook Metni`
- `Hashtagler`
- `Platform`
- `Durum`
- `Yayın Tarihi`
- `Not`
- `Yayın Biçimi` (`Gönderi`, `Hikâye`, `Reel`)
- `Yayın Zamanı` (tarih-saat)
- `Instagram Yayın ID`
- `Facebook Yayın ID`
- `Hata Mesajı`
- `Deneme Sayısı`

Instagram ve Facebook hikâyeleri API ile yayınlanır; Instagram hikâyesindeki tıklanabilir bağlantı etiketi Meta API tarafından desteklenmediği için otomatik eklenmez.

## AI sahne görseli (Faz 1 - deneme)

Panelde "AI Sahne Görseli" bölümü, seçilen ürünün gerçek fotoğrafını referans alıp
sadece arka planı/sahneyi AI ile değiştirir (mutfak, aile, ofis gibi hazır sahneler
veya serbest metin).

- İki sağlayıcı desteklenir: **Gemini** (`gemini-3.1-flash-lite-image`, "Nano
  Banana") ve **OpenAI** (`gpt-image-1`). Panelde ikisi de tanımlıysa Gemini
  varsayılan seçilir. Gemini'de maskeleme API'si olmadığı için ürünün korunması
  yalnızca güçlü bir prompt talimatına dayanır (`geminiScenePrompt`); OpenAI'de
  ise `src/scene-image.js` beyaz/açık arka planı kenarlardan taşma (flood fill)
  ile tespit edip yalnızca o bölgeyi `images.edit` uç noktasına "değiştirilebilir"
  olarak işaretler, ürün alanı API'ye hiç gönderilmeden piksel düzeyinde korunur.
- `OPENAI_API_KEY` veya `GEMINI_API_KEY` (en az biri) Vercel Production'da
  tanımlı olmalı; hiçbiri yoksa panel bunu bildirir. İkisi de kendi
  platformunda ödeme/billing aktif olmadan (ücretsiz kota sıfır) görsel
  üretmez — anahtarın varlığı yeterli değildir.
- Üretilen görsel `BLOB_READ_WRITE_TOKEN` tanımlıysa (Vercel projesine bir
  Blob store bağlanınca otomatik eklenir) kalıcı bir public URL'e yüklenir;
  panelde "Bu sahneyi kullan" butonu bu URL'i "Yeni içerik oluştur" akışına
  aktarır (`api/content.js`'in `imageUrl` override'ı). Token tanımlı değilse
  görsel yalnızca tarayıcıda önizlenir, kuyruğa eklenemez. Çoklu format
  (gönderi/hikâye) türetme henüz eklenmedi.
- "Musluğu cihazın yanından kaldır" seçeneği **varsayılan olarak kapalı** —
  cihaz musluğuyla birlikte, olduğu gibi korunur. İşaretlenirse musluk bölgesi
  de maskeye eklenir (`FAUCET_REMOVE_BOX`, `src/scene-image.js`); bu kutu
  `assets/code-product.png` üzerinde elle ölçüldü ve musluk cihaz gövdesine
  değecek kadar yakın olduğundan gövdenin gerçek kenarından dar bir şerit de
  yeniden üretilecek alana giriyor (kenar çentiği riski). Bu yüzden deneysel
  işaretlenmiştir; onaylanmadan yayında kullanılmamalıdır.

## AI gönderi metni (SEO/pazarlama)

"Yeni içerik oluştur" bölümünde **"Metin üret (AI)"** butonu, seçili ürüne göre
SEO/satış odaklı, emoji'li Instagram ve Facebook metinleri ile hashtag üretir
(`generateCaption`, `api/caption.js`). Sabit "Metin seçeneği 1/2/3" şablonları
hâlâ yedek olarak duruyor (AI anahtarı yoksa kullanılabilir); AI metni
üretildiğinde dropdown'daki seçim yok sayılır. Ürün bağlantısı ("Detaylar:" /
"Ürünü inceleyin:") her zaman kod tarafında otomatik eklenir — AI'nin linki
kendisi yazmasına güvenilmez. Aynı riskli iddia filtresi (sağlık/tedavi/kesin
sonuç) AI metnine de uygulanır.

## Sonraki adım

Dry-run doğru çalıştıktan sonra Meta API için ayrı gönderim scripti eklenir. O aşamada da önce test modu, sonra tek kayıtla kontrollü canlı paylaşım yapılmalıdır.

## Otomatik çalışma

GitHub Actions manuel doğrulama için kullanılabilir. Canlı otomatik çalışma, Windows Görev Zamanlayıcı üzerinden `run-publisher.ps1` ile 5 dakikada bir yapılır. Her çalışmada yalnızca `Onaylandı` durumundaki, yeni `Yayın Zamanı` alanı dolu ve zamanı gelmiş en eski tek kayıt yayınlanır.

Vercel Pro kurulumu için proje kökü bu reponun kökü (Root Directory boş bırakılır), Build Command boş, Install Command `npm ci`, Output Directory boş ve Cron Secret `CRON_SECRET` olarak ayarlanır. Vercel Cron `/api/publish` adresini `Authorization: Bearer CRON_SECRET` ile çağırır.
