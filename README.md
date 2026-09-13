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
  Banana") ve **OpenAI** (`gpt-image-2`). Panelde ikisi de tanımlıysa Gemini
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
- **Üretim-sonrası otomatik kontrol (Faz 1 — yalnızca raporlama):** Her sahne
  görseli üretildiğinde (`api/scene-image.js` ve MCP `generate_scene_image`),
  sahneyi üreten AI'dan bağımsız bir vision çağrısıyla (`src/lib/scene-validation.js`,
  `validateSceneImage`) 4 sabit kritere karşı denetlenir: ürün kimliği, parça
  bütünlüğü, hedef bağlamla tutarlılık, uydurma tabela/yazı. Sonuç
  (`needsReview`, `failedChecks`, `reviewNotes`) yanıta eklenir — **hiçbir
  zaman otomatik yeniden üretim tetiklemez veya yayını engellemez**, yalnızca
  bilgi verir. Bilinçli olarak bu aşamada bırakıldı: önce bu kontrolün insan
  değerlendirmesiyle ne kadar örtüştüğü ölçülmeli, otomatik retry/onay
  mekanizması ancak ondan sonra eklenmelidir. `GEMINI_API_KEY` tanımlı
  değilse `checked:false` ile sessizce atlanır, hiçbir şeyi engellemez.

## AI gönderi metni (SEO/pazarlama)

"Yeni içerik oluştur" bölümünde **"Metin üret (AI)"** butonu, seçili ürüne göre
SEO/satış odaklı, emoji'li Instagram ve Facebook metinleri ile hashtag üretir
(`generateCaption`, `api/caption.js`). Sabit "Metin seçeneği 1/2/3" şablonları
hâlâ yedek olarak duruyor (AI anahtarı yoksa kullanılabilir); AI metni
üretildiğinde dropdown'daki seçim yok sayılır. Ürün bağlantısı ("Detaylar:" /
"Ürünü inceleyin:") her zaman kod tarafında otomatik eklenir — AI'nin linki
kendisi yazmasına güvenilmez. Aynı riskli iddia filtresi (sağlık/tedavi/kesin
sonuç) AI metnine de uygulanır.

## Tek cümleyle içerik isteği (deneysel)

"Yeni içerik oluştur" bölümünün en üstünde, altı ayrı alanı tek tek doldurmak
yerine doğal dille tek bir cümle yazılabilir (örn. *"UltraMag için apartman
tesisatına takılı, teknik oda sahnesi; yarın 10:00'da Instagram gönderisi"*).
**"Anla"** butonu bu cümleyi `POST /api/intent`'e gönderir; `parseIntent`
(`src/lib/intent-parser.js`) AI ile ürün adı, biçim, platform, yayın zamanı ve
sahne isteğini yapılandırılmış alanlara ayrıştırır. Ürün eşleştirmesi AI'ye
bırakılmaz — dönen `productQuery`, bilinen ürün listesiyle (`src/lib/products.js`,
Airtable + llms-full.txt kataloğu) JS tarafında deterministik olarak eşleştirilir,
böylece AI'nin var olmayan bir ürün uydurma riski olmaz. Sonuç, composer'daki
mevcut alanları (ürün, biçim, zaman, platform, sahne açıklaması) otomatik
doldurur; hiçbir şey bu adımda kaydedilmez — kullanıcı her zamanki gibi
önizleyip onaylamalıdır. OPENAI_API_KEY, ANTHROPIC_API_KEY veya GEMINI_API_KEY
üçünden biri yeterlidir.

## Etkileşim verisi (Insights)

"Genel Bakış" bölümündeki **Haftalık etkileşim** artık gerçek bir sayı —
`GET /api/insights` (`src/lib/insights.js`), son 7 günde `Paylaşıldı` durumundaki
kayıtların Instagram/Facebook yayın ID'lerini kullanıp Meta Graph API'den
`like_count`/`comments_count`/`shares` okur ve toplar. Bilinçli olarak yalnızca
bu temel, her zaman erişilebilir alanlar kullanılır — ayrıntılı
"impressions/reach" metrikleri ek izin gerektirir ve API sürümüne göre sık
değiştiği için dahil edilmedi. Tek bir gönderinin okunması başarısız olursa
diğerlerini etkilemez (`failures` sayacında görünür). META_ACCESS_TOKEN
tanımlı değilse kart "bağlı değil" der, hata vermez.

## Site Analitiği (GA4)

Genel Bakış'taki **Site Analitiği (GA4)** paneli, buzsu.com.tr'nin zaten
kurulu olan Google Analytics 4 mülkünden (Property ID `289526828`) okur:
şu an aktif ziyaretçi (Realtime API), son 7 günde en çok görüntülenen ürün
sayfaları, ve — kuruluysa — GA4'ün geliştirilmiş e-ticaret olaylarından
(`add_to_cart`) en çok sepete eklenen ürünler (`src/lib/ga4.js`,
`GET /api/analytics`).

Bu, siteye **hiçbir yeni script eklemeden** yapılır — mevcut GA4 kurulumunu
salt-okunur bir servis hesabıyla okur:

1. [Google Cloud Console](https://console.cloud.google.com) → proje seç/oluştur
   → "Google Analytics Data API"yi etkinleştir.
2. IAM ve Yönetim → Hizmet Hesapları → yeni bir hizmet hesabı oluştur (proje
   düzeyinde rol gerekmez) → Anahtarlar sekmesi → JSON anahtar oluştur/indir.
3. Google Analytics → Yönetici → ilgili GA4 mülkü → Mülk Erişim Yönetimi →
   hizmet hesabının e-postasını **Görüntüleyici** rolüyle ekle.
4. Vercel Production ortamına indirilen JSON'daki `client_email` ve
   `private_key` değerlerini `GA4_CLIENT_EMAIL` / `GA4_PRIVATE_KEY` olarak,
   mülk ID'sini `GA4_PROPERTY_ID` olarak ekle.

Üçü de tanımlı değilse panel sessizce "bağlı değil" gösterir, hata vermez.
`add_to_cart` olayı GA4'te kurulu değilse "en çok sepete eklenenler" bölümü
boş kalır (görüntüleme verisini etkilemez).

## Otomatik Pilot (deneysel)

Panelin "Hızlı ayarlar" bölümündeki **Otomatik Pilot** açık/kapalı düğmesi,
Airtable'daki ayrı bir `Ayarlar` tablosundaki tek satırı okur/yazar
(`src/lib/settings.js`, `api/settings.js`). Açıkken, `vercel.json`'daki
`/api/autopilot` cron'u günde bir kez (06:00 UTC) çalışır ve:

1. Ürün kataloğunda **en uzun süredir (hiç veya en eski) öne çıkarılmamış**,
   gerçek bir referans fotoğrafı olan ürünü seçer (`src/lib/autopilot.js`,
   `pickNextProduct` — ayrı bir "sıradaki ürün" alanı tutmak yerine mevcut
   kayıtların `Kaynak URL` + oluşturma zamanından çıkarım yapar).
2. O ürün için AI ile sahne planı, sahne görseli ve gönderi metni üretir
   (mevcut `generateScenePlan` / `generateSceneImage` / `generateCaption`
   ile aynı kod yolu).
3. Sonucu bir **Taslak** olarak Airtable'a yazar.

Otomatik Pilot **hiçbir zaman kendi kendine onaylamaz veya yayınlamaz** —
oluşan taslak, panelde her zamanki gibi incelenip "Onayla" ile onaylanmalı.
Kapalıyken cron hemen çıkar, hiçbir AI/Airtable çağrısı yapmaz.

## MCP: harici görsel yükleme (upload_media)

`api/mcp.js` (`GET/POST /api/mcp`), Claude/ChatGPT gibi MCP istemcilerinin
kuyruğu yönetmesini sağlar. `generate_scene_image` görseli kendisi (Gemini/
OpenAI ile) üretirken, **`upload_media`** aracı ChatGPT'de veya başka bir yerde
zaten oluşturulmuş hazır bir PNG/JPEG/WebP görselini sisteme alıp herkese açık
bir Vercel Blob URL'i döner — bu URL doğrudan `create_draft`'a verilebilir.

```jsonc
// 1) Hazır görseli yükle (imageUrl veya imageBase64'ten biri)
upload_media({
  imageUrl: "https://.../chatgpt-tarafindan-uretilen-gorsel.png",
  filename: "buzsu-ultramag-hikaye.png",
  confirmed: true
})
// -> { ok: true, imageUrl: "https://<blob>/manual-uploads/...png", mimeType: "image/png", size: 123456 }

// 2) Dönen URL'i SADECE bu taslak için kullan (ürünün ana kataloğ görseli değişmez)
create_draft({
  productId: "rec6hFtypa3dY78ei",
  format: "Hikâye",
  platforms: ["Instagram"],
  imageUrl: "https://<blob>/manual-uploads/...png",
  publishAt: "2026-09-06T12:00:00Z",
  instagramText: "Tüm evinizde kirece karşı akıllı koruma.",
  hashtags: "#Buzsu #UltraMag #KireçÖnleyici"
})
```

Güvenlik: `imageUrl` verilirse görsel sunucu tarafında indirilir — SSRF'e karşı
yalnızca HTTPS kabul edilir, hedef host çözümlenip özel/yerel IP aralıkları
(localhost, `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
`169.254.169.254` gibi bulut metadata adresleri dahil) ve her yönlendirme adımı
reddedilir (`src/lib/upload-media.js`). Yalnızca PNG/JPEG/WebP ve en fazla 15MB
kabul edilir. `confirmed:true` verilmeden ne Blob'a yükleme ne de Airtable
yazması yapılır — yalnızca doğrulama sonucu döner. `productId` +
`updateProductImage:true` verilmedikçe ürünün Airtable'daki ana `Görsel URL`
alanı hiçbir zaman değişmez.

## MCP: ürün görsellerinden ücretsiz Reels/Shorts videosu (compose_product_video)

**`compose_product_video`**, 2-10 ürün görselinden, ücretli bir video API'si
kullanmadan (yalnızca FFmpeg ile) 9:16 1080x1920 bir Reels/Shorts videosu
üretir: her ürün ~1.5-2sn gösterilir, hafif zoom/pan (Ken Burns) ve geçiş
efekti (fade/wipe) uygulanır, ürün adı alt kısımda güvenli alanda gösterilir,
sabit bir Buzsu kapanış sahnesiyle biter, isteğe bağlı bir royalty-free müzik
URL'i eklenebilir — `musicUrl` verilmezse video sessiz kalmaz: 30 parçalık
ücretsiz, ticari kullanıma açık bir Mixkit havuzundan (`src/lib/music-catalog.js`
— kurumsal_pozitif, modern_teknoloji, sakin_premium, enerjik_reklam, sinematik)
otomatik bir parça seçilir; `musicMood` ile tarz yönlendirilebilir.

Render işi birkaç dakika sürebileceğinden ve Vercel serverless fonksiyonlarının
süre/bellek sınırları (Fluid Compute olmadan klasik Pro planında 15sn) bu iş
için riskli olduğundan, gerçek FFmpeg render'ı **Vercel'de değil, GitHub
Actions'ın ücretsiz `workflow_dispatch` kuyruğunda** çalışır
(`.github/workflows/render-product-video.yml`, `scripts/render-product-video.mjs`).
`compose_product_video` işi başlatıp hemen bir `jobId` döner; sonucu
**`get_video_render_status`** ile sorgulayın (`status`: `queued` →
`rendering` → `completed`/`failed`). `workflow_dispatch` API'si bir run ID
vermediğinden, iş durumu GitHub yerine Vercel Blob'daki
`video-jobs/<jobId>.json` dosyasından okunur (`src/lib/video-jobs.js`).

```jsonc
// 1) Render işini başlat
compose_product_video({
  mediaItems: [
    { imageUrl: "https://.../urun1.jpg", title: "UltraMag Kireç Önleyici" },
    { imageUrl: "https://.../urun2.jpg", title: "1 İnç Manyetik Model" },
    { imageUrl: "https://.../urun3.jpg", title: "Apartman Tipi Model" }
  ],
  transition: "fade",
  musicUrl: "https://.../royalty-free-muzik.mp3"
})
// -> { ok: true, jobId: "b3f1...", status: "queued", message: "..." }

// 2) Birkaç dakika sonra durumu sorgula
get_video_render_status({ jobId: "b3f1..." })
// -> { ok: true, jobId: "b3f1...", status: "completed",
//      videoUrl: "https://<blob>/product-videos/b3f1....mp4",
//      durationSeconds: 8.4, width: 1080, height: 1920, fileSizeBytes: 4213000 }

// 3) Dönen videoUrl doğrudan create_draft'a verilebilir
create_draft({
  productId: "rec6hFtypa3dY78ei",
  format: "Reel",
  platforms: ["Instagram", "Facebook", "YouTube"],
  videoUrl: "https://<blob>/product-videos/b3f1....mp4",
  publishAt: "2026-09-15T10:00:00Z",
  instagramText: "Buzsu ürün ailesini keşfedin."
})
```

Kurulum: GitHub'da bu depoda **"Actions: write"** izni olan bir personal
access token oluşturup Vercel Production ortamına `GITHUB_DISPATCH_TOKEN`
olarak ekleyin; render worker'ın (GitHub Actions runner'ı) Vercel Blob'a
yazabilmesi için AYRICA bu depoda `BLOB_READ_WRITE_TOKEN` adında bir **GitHub
Actions repository secret** tanımlayın (Vercel'deki değerle aynı). Detaylar
için `.env.example`'a bakın.

**Opsiyonel, ÜCRETLİ görsel büyütme (`upscaleImages`)**: kaynak ürün
fotoğrafı düşük çözünürlüklü (ör. site thumbnail'ı) olduğunda, `contain`-fit
büyütmesi kaçınılmaz bir yumuşama getirir — ücretsiz `sharpen` filtresi
yalnızca kenar kontrastını artırır, kayıp detayı geri getirmez. `mediaItems`'a
`upscaleImages: true` ve `confirmed: true` eklenirse, her görsel Ken Burns
animasyonundan ÖNCE **Replicate/Real-ESRGAN** ile AI büyütülür
(`src/lib/image-upscale.js`). Bu adım **gerçek para harcar**;
`confirmed:true` olmadan hiçbir Replicate API çağrısı yapılmaz ve
`REPLICATE_API_TOKEN`'ın varlığı tek başına bu adımı tetiklemez — yalnızca
açıkça `upscaleImages:true` istendiğinde çalışır. Kurulum:
[replicate.com/account/api-tokens](https://replicate.com/account/api-tokens)
adresinden bir token alıp bu depoda `REPLICATE_API_TOKEN` adında bir
**GitHub Actions repository secret** olarak ekleyin (detaylar için
`.env.example`'a bakın).

Güvenlik: her `imageUrl`/`musicUrl` yalnızca HTTPS söz dizimi olarak
doğrulanır; gerçek indirme (ve dolayısıyla SSRF/DNS koruması, `src/lib/
upload-media.js`'deki `assertPublicHttpsUrl`) render worker'ında, görsel/müzik
fiilen indirilirken yapılır — Vercel bu URL'lere kendisi hiç istek atmaz.
Görsellerde PNG/JPEG/WebP + 15MB, müzikte MP3/MP4/WAV/OGG + 20MB sınırı
geçerlidir (aynı `fetchPublicImage`/`fetchPublicAudio` fonksiyonları
`upload_media` ile paylaşılır).

**Bilinen sınır**: bu depoyu geliştiren ortamda gerçek bir `ffmpeg` ikilisi
bulunmuyor, bu yüzden filtre grafiği/offset matematiği (`src/lib/
ffmpeg-command.js`) yalnızca saf argüman üretimi düzeyinde unit test
edilebildi — gerçek görsel/zamanlama doğruluğu ancak GitHub Actions'ta
çalışan gerçek bir render ile doğrulanabilir. İlk canlı denemede çıktı
videoyu mutlaka izleyip kontrol edin.

## Google Veo model seçimi (generate_video_clip / dashboard Reels)

Google Veo 3.1 ailesinin üç modeli, ucuzdan pahalıya:

| Tier | Model | Not |
| --- | --- | --- |
| `economy` | `veo-3.1-lite-generate-preview` | En ucuz — **varsayılan** |
| `fast` | `veo-3.1-fast-generate-preview` | Orta hız/maliyet |
| `quality` | `veo-3.1-generate-preview` | En yüksek kalite, en pahalı/yavaş |

**Neden varsayılan `economy`?** Google'ın her modelin kendi günlük istek
kotası (RPD) var; `fast` modelinin kotası tükendiğinde önceden hiçbir
allowlist/fallback olmadığı için araç tamamen çalışmaz hale geliyordu.
Model belirtilmeyen istekler artık otomatik olarak `economy`'ye düşüyor —
bu **kota sorgulaması değil**, sabit bir varsayılan zinciridir (Google
kalan kotayı üretim öncesi güvenilir şekilde bildirmiyor).

**Model nasıl seçilir** (öncelik sırasıyla):
1. Çağrı parametresi — MCP'de `generate_video_clip`'in `model` alanı, dashboard'da Reels/Video sekmesindeki "Veo model" seçici.
2. `VEO_VIDEO_MODEL` ortam değişkeni — Vercel Production'da tanımlanabilir.
3. `VEO_DEFAULT_TIER` ortam değişkeni.
4. Hiçbiri yoksa (veya `"auto"` ise) → `economy`.

Her katman ya bir tier adı (`economy`/`fast`/`quality`/`auto`) ya da
doğrudan ham bir model adı (ör. `veo-3.1-generate-preview`, geriye dönük
uyumluluk için) kabul eder. Tanınmayan bir değer, ilgili çağrı **hiçbir
ağ isteği atmadan** hemen reddedilir.

**429 (kota) hatası**: Google bir isteği reddettiğinde (`HTTP 429`) yanıt
artık düz bir hata mesajı değil, yapılandırılmış bir hata:
```jsonc
{
  "ok": false,
  "code": "RATE_LIMITED",
  "httpStatus": 429,
  "model": "veo-3.1-fast-generate-preview",
  "providerStatus": "RESOURCE_EXHAUSTED",   // Google'ın kendi durumu
  "retryAfter": 36,                          // saniye, bilinmiyorsa null
  "alternatives": [                          // maliyet sırasıyla, ASLA otomatik çağrılmaz
    { "tier": "economy", "model": "veo-3.1-lite-generate-preview", "label": "Veo Lite (ekonomik)" },
    { "tier": "quality", "model": "veo-3.1-generate-preview", "label": "Veo Generate (yüksek kalite)" }
  ],
  "details": { "quotaId": "...", "quotaMetric": "..." }  // yoksa {"quotaType":"unknown"}
}
```
Bu, aşırı kesin bir "günlük kota doldu" iddiası **yapmaz** — dakikalık
(RPM) veya günlük (RPD) kota ayrımı Google'ın yanıtından her zaman
anlaşılamaz. **Hiçbir zaman otomatik olarak daha pahalı bir modele
geçilmez**; kullanıcı `alternatives` listesinden yeni bir model seçip
`confirmed:true` ile açıkça tekrar çağırmalıdır. Bu yapı MCP yanıtında
(`content[].text`, `isError:true` korunarak) ve dashboard/HTTP
uçlarında (gerçek `HTTP 429` + aynı alanlar) aynı şekilde taşınır.

## Google Gemini Omni 1.1 Flash — mevcut video düzenleme (generate_omni_video_edit / dashboard Reels)

Omni, Veo'dan **tamamen ayrı** bir sağlayıcıdır. Google'ın modeli hem
sıfırdan video üretebiliyor hem de mevcut videoları düzenleyebiliyor; **bu
araç şu anda Omni'nin mevcut video düzenleme özelliğini kullanır — sıfırdan
üretim bu arayüzde henüz etkin değildir.** Zaten üretilmiş/render edilmiş bir
videoyu (örn. iyi çıkan bir aile sahnesi) alıp yalnızca belirtilen bölümü
(örn. yanlış ürün) düzenler. Google Gemini Developer API'nin bir parçasıdır,
aynı `GEMINI_API_KEY`'i kullanır — ayrı bir hesap/anahtar gerekmez.

- **Model**: tek ve sabit — `gemini-omni-1.1-flash`. Başka bir model kabul
  edilmez (Veo'daki tier seçimi kavramının burada karşılığı yoktur).
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/interactions`
  (Google'ın "Interactions API"si). Mevcut video VE referans ürün görseli
  (isteğe bağlı) önce Gemini **Files API** ile yüklenir (`upload/v1beta/files`,
  resumable protokol) ve `ACTIVE` duruma gelmesi beklenir; `input` dizisine
  dokümante edilen düz `{type:"video"|"image", uri, mime_type}` / `{type:"text",
  text}` öğeleri olarak eklenir (inline base64 kullanılmaz). Çıktı isteği
  `response_format: {type:"video", delivery:"uri", aspect_ratio, resolution}`
  şeklinde bir NESNE olarak gönderilir (doküman dizi biçimini de kabul ediyor;
  bu iki şekil de geçerli — burada tek-öğe nesne şekli kullanılıyor).
- **Çözünürlük**: `360p` (varsayılan, en ucuz — taslak/deneme için önerilir),
  `720p`, `1080p`, `4k`.
- **`confirmed:true` şart** — hem MCP aracında hem HTTP/dashboard katmanında;
  verilmezse **hiçbir ağ isteği** atılmadan reddedilir.
- **Bölgesel kısıt**: Google, yüklenen videoları düzenleme özelliğinin her
  bölgede/hesapta desteklenmediğini belirtiyor (EEA/İsviçre/Birleşik Krallık
  ve bazı ABD eyaletleri dokümante edilmiş kısıtlar — Türkiye için garanti
  yoktur). Desteklenmiyorsa yanıt `RATE_LIMITED`'e benzer şekilde
  yapılandırılmış bir hata döner:
  ```jsonc
  {
    "ok": false,
    "code": "REGION_UNAVAILABLE",
    "httpStatus": 403,           // Google'ın döndüğü gerçek HTTP kodu
    "model": "gemini-omni-1.1-flash",
    "providerStatus": "PERMISSION_DENIED",
    "details": { "message": "..." }
  }
  ```
  **Hiçbir otomatik tekrar deneme yapılmaz** — bu, RATE_LIMITED (429) için de
  aynı şekilde geçerlidir; ikisi de MCP yanıtında (`isError:true` korunarak,
  `content[].text` geçerli JSON olarak) ve dashboard/HTTP uçlarında (gerçek
  HTTP kodu + aynı alanlar) taşınır.
- **Yanıt ayrıştırma**: tamamlanmış çıktı, Interactions API yanıtında
  `steps[]` dizisindeki `type:"model_output"` adımının `content[]`'inde
  (`type:"video"`) bulunur. Google, `delivery:"uri"` istenmiş olsa bile
  **durum sorgusu (`GET /v1beta/interactions/{id}`) sırasında videoyu inline
  base64 döndürebiliyor** — bu yüzden `submitOmniVideoEdit`/
  `omniInteractionStatus` her ikisini de (`fileUri` veya `videoBase64`)
  tanır, biri "her zaman doğru şekil" diye varsayılmaz. `model_output` adımı
  var ama içinde video parçası yoksa (örn. metinle reddetme) bu **açık bir
  hata** olarak fırlatılır — sessizce `IN_PROGRESS`'e düşülmez.
- **Çıktı dosyası hazır olana kadar indirme yapılmaz**: `model_output`'ta bir
  `uri` gelmesi videonun HEMEN indirilebilir olduğu anlamına gelmez — çıktı
  da Files API'deki diğer dosyalar gibi `PROCESSING` → `ACTIVE`/`FAILED`
  durumundan geçer. URI'den dosya kimliği güvenli şekilde ayrıştırılır
  (Google'ın döndürdüğü tam URI metnine güvenmek yerine, indirme URL'i
  bilinen `GET /v1beta/files/{id}:download?alt=media` şekliyle yeniden
  kurulur); `ACTIVE` doğrulanana kadar iş `"OUTPUT_PROCESSING"` durumunda
  kalır, `FAILED` olursa açık bir hata fırlatılır. Dosya zaten `outputFileId`
  ile biliniyorsa sonraki durum sorguları `GET /v1beta/interactions/{id}`'ye
  DEĞİL doğrudan Files API'ye gider.
- **Bilinen sınırlama**: Interactions API çok yeni bir yüzey olduğu için
  (27 Ağustos 2026 itibarıyla genel kullanıma açıldı) bu ortamda
  `ai.google.dev`'e doğrudan ağ erişimi yok; şema, arama motoru üzerinden
  erişilen doküman özetleriyle (birden fazla bağımsız sorguda tekrarlanan
  sonuçlarla) çapraz doğrulanarak yazıldı — birebir sayfa okuması değildir.
  `src/omni-video.js:submitOmniVideoEdit` içindeki tek istek gövdesi izole
  tutulmuştur; gerçek şema küçük bir farklılık gösterirse düzeltme tek o
  fonksiyonda yapılır. **İlk gerçek (ücretli, 360p) deneme öncesinde bu alan
  adlarının resmi dokümandan teyit edilmesi önerilir.**

## Sonraki adım

Dry-run doğru çalıştıktan sonra Meta API için ayrı gönderim scripti eklenir. O aşamada da önce test modu, sonra tek kayıtla kontrollü canlı paylaşım yapılmalıdır.

## Otomatik çalışma

Canlı otomatik yayın **Vercel Cron** ile yapılır — ayrıca bir Windows makinesinin veya zamanlanmış bir görevin açık kalması gerekmez. `vercel.json`'da tanımlı üç cron görevi:

- `/api/publish` — her 2 saatte bir (`0 */2 * * *`). Her çalışmada yalnızca `Onaylandı` durumundaki, `Yayın Zamanı` alanı dolu ve zamanı gelmiş en eski tek kayıt yayınlanır.
- `/api/autopilot` — günde bir kez, 06:00 UTC.
- `/api/purge-trash` — günde bir kez, 04:00 UTC.

Vercel Pro kurulumu için proje kökü bu reponun kökü (Root Directory boş bırakılır), Build Command boş, Install Command `npm ci`, Output Directory boş ve Cron Secret `CRON_SECRET` olarak ayarlanır. Vercel Cron bu adresleri `Authorization: Bearer CRON_SECRET` ile çağırır.

`run-publisher.ps1` (`npm run publish` → `src/publish-approved.js`), Windows'ta **yalnızca yerel/manuel** tek seferlik tetikleme için bir seçenektir — production'da buna karşılık gelen, zamanlanmış (Görev Zamanlayıcı) bir görev **yoktur** (doğrulandı). Aynı anda hem bunu zamanlanmış olarak çalıştırıp hem Vercel Cron'u açık bırakmayın: ikisi de aynı Airtable kuyruğuna karşı `runPublisher()`'ı çalıştırır ve lease mekanizması atomik olmadığı için (özellikle saat başlarında, Vercel Cron'un tetiklendiği anlarda) aynı kaydın iki kez yayınlanma riski vardır.

GitHub Actions manuel doğrulama için kullanılabilir.
