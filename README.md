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

## Hikâye (Story) yayınlama — video öncelikli

`format: "Hikâye"` bir kayıtta hem `Görsel URL` hem `Video URL` doluysa
(ör. `create_draft`'a ikisi de verilmişse), yayın anında (`src/publish-
approved.js:publishInstagram`/`publishFacebook`) **`Video URL` her zaman
önceliklidir**: Instagram ve Facebook Story doğrudan bu videoyu kullanır —
`storyImageUrl()`'ün ürettiği otomatik bilgi kartı/bant/overlay
(`api/story-image.js`) bu durumda TAMAMEN atlanır, `Görsel URL` hiç
okunmaz. `Video URL` boşsa mevcut görsel-story yolu (kart/overlay dahil)
değişmeden çalışır. Bu, Reel/Gönderi/Carousel'in medya seçimini
ETKİLEMEZ — onlar zaten kendi format-özel mantıklarını kullanıyordu.

Facebook video story, mevcut Facebook Reel yayınlamasıyla (`video_reels`)
AYNI üç adımlı `upload_phase` desenini kullanır, yalnızca uç nokta
`video_stories`'e değişir; bu depodan canlı bir Meta hesabına karşı
DOĞRULANAMADI (sandbox'ta gerçek Meta erişimi yok) — ilk denemeden önce
kontrollü, tek kayıtlı bir test önerilir.

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
  şeklinde bir NESNE olarak gönderilir — en net doğrulanan örnekte görülen
  şekil budur.
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

## Google video sağlayıcıları — Omni sıfırdan üretim, Veo 3.1 model routing, capability endpoint

Bu bölüm yalnızca **Google** video sağlayıcılarını (Omni + Veo 3.1) kapsar;
OpenAI/fal.ai'ye dokunmaz.

**Omni ile sıfırdan (zero-shot) video üretimi** — `generate_gemini_video` /
`get_gemini_video_status` (MCP), dashboard'da "AI Reels" bölümünde "Google
Gemini Omni 1.1 Flash" sağlayıcısı olarak. `generate_omni_video_edit`
(mevcut bir videoyu düzeltme) ile **tamamen ayrı, birbirini kırmayan** bir
akıştır — ikisi de aynı Interactions API'yi (`src/omni-video.js`) paylaşır,
tek fark input dizisinde bir `{type:"video",...}` parçası olup olmaması.
Sıfırdan üretimde `existingVideoUrl` YOKTUR — yalnızca bir `prompt` (+
isteğe bağlı `referenceImageUrl`) gerekir. Durum sorgusu
(`get_gemini_video_status`) `get_omni_video_status` ile **aynı** mekanizmayı
(`omniInteractionStatus`) kullanır; iki ayrı MCP tool adı sadece hangi akıştan
başlatıldığını netleştirmek içindir. Dokümante edilmiş bir süre (duration)
parametresi yoktur — uydurulmadı, modelin varsayılanına bırakıldı.

### Veo 3 (GA) KAPANDI — tek aktif aile Veo 3.1 (Preview)

**Önemli düzeltme**: Google, Veo 3 (GA)'nın canonical ID'lerini
(`veo-3.0-generate-001`, `veo-3.0-fast-generate-001`) resmi Gemini API
deprecation dokümanına göre **30 Haziran 2026'da kapattı**. Bu depo bir ara
sürümde bu ID'leri "aktif Veo 3" diye entegre etmişti — bu YANLIŞ ve
düzeltildi. **Bu ID'ler artık hiçbir çağrıda kullanılmaz.**

Aktif/gerçekten çağrılabilir tek Google Veo ailesi **Veo 3.1 (Preview)**'dir:

| Alias | Gerçek canonical model ID |
| --- | --- |
| `veo-3.1-lite` / `economy` | `veo-3.1-lite-generate-preview` |
| `veo-3.1-fast` / `fast` | `veo-3.1-fast-generate-preview` |
| `veo-3.1-generate` / `quality` | `veo-3.1-generate-preview` |

`generate_video_clip`'in `model` alanı `veo-3-generate`/`veo-3-fast`/
`veo-3-lite` gibi eski, kapanmış-aileye ait isimleri (veya ham
`veo-3.0-generate-001`/`veo-3.0-fast-generate-001` ID'lerini) hâlâ TANIR
ama **hiçbir zaman aktif bir modele çözmez** — ne kapanmış ID'ye istek
atılır ne de sessizce Veo 3.1'e düşülür; hangi Veo 3.1 alias'ının
kullanılması gerektiğini açıkça söyleyen bir hata döner (bkz.
`src/veo-video.js:DEPRECATED_VEO_3_0_ALIASES`).

> **AI Studio'da "Veo 3 Generate/Fast/Lite" neden görünüyor?** Bu, AI
> Studio'nun kendi kullanıcı dostu UI etiketlemesidir (AI Studio, Veo 3.1'in
> model kartını `aistudio.google.com/models/veo-3` yolunda sunuyor). Arka
> planda AI Studio'nun fiilen çağırdığı gerçek API model ID'si Veo 3.1'dir
> — bu depo de aynı yaklaşımı izler: kullanıcı dostu etiket "Veo 3.1
> Generate/Fast/Lite" (isterseniz kısaca "Veo Generate/Fast/Lite" de
> gösterilebilir), ama backend'in gerçekten çağırdığı model ID her zaman
> `veo-3.1-*-generate-preview`'dir.

**429/kota hatası ve alternatives**: bir model 429 verdiğinde
`alternatives` listesi Veo 3.1'in diğer tier'larını önerir — bilgi
amaçlıdır, hiçbir zaman otomatik çağrılmaz. Öncelik zinciri (çağrı
parametresi > `VEO_VIDEO_MODEL` > `VEO_DEFAULT_TIER` > `economy`) değişmedi.

**Fallback politikası (tüm Google video sağlayıcıları için)**: bir provider/
model seçildiyse **başka birine ASLA sessizce geçilmez**. Omni 429/
`REGION_UNAVAILABLE` verirse Veo'ya, Veo 3.1 bir tier'de 429 verirse başka
bir tier'e, discovery'de olmayan bir tier seçilirse başka bir tier'e
otomatik geçilmez — kullanıcı/çağıran taraf açıkça yeni bir provider/model
seçip `confirmed:true` ile tekrar denemelidir.

**`confirmed:true` kuralı**: Omni'nin (`submitOmniVideoEdit` ve
`submitOmniVideoGeneration`) her ikisi de `confirmed:true` olmadan **hiçbir
ağ isteği atmadan** reddeder — bu kontrol fonksiyonun kendi içinde, çağıran
katmandan (MCP/dashboard) bağımsız bir savunma satırıdır. Veo'da bu kontrol
çağıran katmanda yapılır (MCP: `args.confirmed !== true` → hata; dashboard:
iki tıklamalı "Emin misin?" onayı) — `submitVeoVideo`'nun kendisi bir
`confirmed` parametresi almaz, ama üretim yolu paralı bir isteği asla
onaysız başlatmaz.

**Capability/discovery endpoint** — `GET /api/video-provider-capabilities`
(oturum açmış kullanıcı gerektirir, bkz. `src/auth.js:getSession`).
`GEMINI_API_KEY` varsa **gerçek** bir `GET /v1beta/models` discovery isteği
atılır (ücretsiz — bu bir üretim/generation çağrısı değildir); Google'ın o
hesap için listelediği modellerle Omni/Veo 3.1'in gerçekten erişilebilir
olup olmadığı karşılaştırılır. Kaynak model listesi
(`src/veo-video.js:VEO_MODEL_TIERS`) **yalnızca aktif Veo 3.1 ID'lerini**
içerir — kapanmış Veo 3.0 ID'leri bu listede hiç yoktur, dolayısıyla
discovery yanıtı ne dönerse dönsün "available:true" olarak
**raporlanamazlar** (hard-code edilmiş bir "deprecated ama yine de
available" durumu mümkün değildir). Discovery isteği herhangi bir sebeple
(ağ, geçici hata) başarısız olursa capability sessizce "unavailable"
göstermez — bu durumda yalnızca anahtar varlığına düşülür (bkz.
`src/lib/video-provider-capabilities.js`). Yanıt **hiçbir zaman** API key/
secret/token içermez — yalnızca `available`/`models` alanları döner:
```jsonc
{
  "ok": true,
  "google": {
    "omni": { "available": true, "models": ["gemini-omni-1.1-flash"], "label": "Gemini Omni 1.1 Flash" },
    "veo": {
      "available": true,
      "models": ["veo-3.1-lite-generate-preview", "veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"],
      "tiers": [
        { "tier": "economy", "model": "veo-3.1-lite-generate-preview", "label": "Veo 3.1 Lite", "available": true },
        { "tier": "fast", "model": "veo-3.1-fast-generate-preview", "label": "Veo 3.1 Fast", "available": true },
        { "tier": "quality", "model": "veo-3.1-generate-preview", "label": "Veo 3.1 Quality", "available": true }
      ]
    },
    "image": {
      "nanoBanana2": { "available": true, "model": "gemini-3.1-flash-image", "label": "Nano Banana 2" },
      "nanoBanana2Lite": { "available": true, "model": "gemini-3.1-flash-lite-image", "label": "Nano Banana 2 Lite" },
      "nanoBananaPro": { "available": false, "model": "gemini-3-pro-image", "label": "Nano Banana Pro" },
      "qualityTiers": {
        "economy": { "provider": "gemini", "model": "gemini-3.1-flash-lite-image", "available": true },
        "balanced": { "provider": "nano-banana-2", "model": "gemini-3.1-flash-image", "available": true },
        "quality": { "provider": "nano-banana-pro", "model": "gemini-3-pro-image", "available": false }
      }
    }
  },
  "fal": { "available": true }
}
```
Dashboard bu uç noktayı sayfa yüklenirken çağırır ve erişilemeyen seçenekleri
(`#reel-provider`'daki "omni", `#veo-model-tier`'daki üç Veo 3.1 tier'ı,
`#nb2-generate` butonu) devre dışı bırakıp " — kullanılamıyor" etiketiyle
işaretler; uç nokta henüz deploy edilmemişse veya hata dönerse sessizce yok
sayılır, seçenekler `availableProviders()`'ın (anahtar varlığına dayalı)
filtrelediği hâliyle kalır. `google.veo.tiers[].label` ve `google.omni.label`,
kullanıcıya gösterilen (Lite/Fast/Quality, "Gemini Omni 1.1 Flash") metinleri
taşır — **backend'de her zaman gerçek canonical model ID'si** (`model` alanı)
kullanılır, etiket yalnızca görüntüleme metnidir (bkz. `src/lib/video-model-labels.js`).

**Hangi model hangi kullanım için uygun**:

| Sağlayıcı/model | Ne için uygun |
| --- | --- |
| Omni (`gemini-omni-1.1-flash`, UI: "Gemini Omni 1.1 Flash") | Esnek video üretimi (sıfırdan veya mevcut videoyu düzeltme) — tier kavramı yok, tek model |
| Veo 3.1 Lite (`veo-3.1-lite`/`economy`, UI: "Veo 3.1 Lite") | En ekonomik seçenek, yüksek hacimli deneme |
| Veo 3.1 Fast (`veo-3.1-fast`/`fast`, UI: "Veo 3.1 Fast") | Hızlı denemeler, orta maliyet |
| Veo 3.1 Generate (`veo-3.1-generate`/`quality`, UI: "Veo 3.1 Quality") | Daha kaliteli final denemeleri, en pahalı/yavaş |

## Nano Banana 2 + Veo 3.1 — iki aşamalı sahne→video pipeline (generate_nano_banana_scene)

**Nano Banana 2 bir video modeli DEĞİLDİR** — Google'ın Gemini API'deki
canonical image modelidir (`gemini-3.1-flash-image`, bkz.
`src/scene-image.js:NANO_BANANA_2_MODEL`). Bu depoda üç ayrı Gemini image
modeli vardır ve birbirine ASLA karıştırılmamalı:

| Kullanıcıya gösterilen ad | Canonical model ID | Bu PR'daki rolü |
| --- | --- | --- |
| Nano Banana 2 | `gemini-3.1-flash-image` | Bu pipeline'ın ana image modeli |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | Mevcut `#scene-provider` → "gemini" akışının varsayılanı (`GEMINI_SCENE_MODEL`), değişmedi |
| Nano Banana Pro | `gemini-3-pro-image` | TASK-003: `generate_scene_image`'ın "quality" tier'ı (`provider:"nano-banana-pro"`) — GERÇEK discovery'de bu hesapta listelenmediği sürece SESSİZCE Nano Banana 2'ye düşülmez, açık bir hata döner (bkz. aşağıdaki "economy/balanced/quality kalite tier'ları" bölümü) |

**Neden iki aşamalı (image → onay → video)?** Nano Banana 2 sahneyi
hazırlar, Veo/Omni SADECE onaylanan sahneyi hareketlendirir. Bu hem
maliyeti (video üretimi, görsel üretiminden çok daha pahalıdır — yanlış bir
sahneyi videoya dönüştürüp o parayı boşa harcamak istemezsiniz) hem de
ürünün yanlış/bozuk oluşma riskini (mevcut `scene-validation.js` otomatik
kontrolü needsReview:true dönebilir) ciddi biçimde azaltır.

**Akış**:
1. `generate_nano_banana_scene` (MCP) veya `POST /api/nano-banana-scene`
   (dashboard) çağrılır — `productId` verilirse ürünün gerçek fotoğrafı
   referans alınır (mevcut maskeli-düzenleme mimarisi, bkz.
   `generateSceneImage(..., { provider: "nano-banana-2" })`), verilmezse
   tamamen sıfırdan/zero-shot bir görsel üretilir (`callGeminiTextToImage`).
   **Yalnızca görsel üretir; hiçbir koşulda Veo/Omni'yi kendiliğinden
   tetiklemez.**
2. Ürün-referanslı üretimde sonuç, mevcut otomatik inceleme sistemi
   (`src/lib/scene-validation.js`) ile aynen kontrol edilir —
   `needsReview`/`failedChecks`/`reviewNotes` döner. Zero-shot modda
   kontrol edilecek bir "ürün kimliği" olmadığı için bu kontrol atlanır.
3. Kullanıcı görseli inceler. Dashboard'da `needsReview:true` iken "Bu
   görseli kullan" butonu ayrı, açık bir ikinci onay ister (iki tıklamalı
   "Emin misin?" deseni — mevcut danger-button konvansiyonuyla aynı).
4. Onaylandıktan SONRA, kullanıcı AYRI ve AÇIK bir ikinci adımla video
   üretir: dashboard'da mevcut "AI Reels (video)" panelinden Veo/Omni
   seçip "Sahneyi baz alarak video üret" kutusunu işaretler (Nano Banana
   2'nin ürettiği görsel URL'i, mevcut `currentSceneImageUrl` akışına
   aynen enjekte edilir — **video için ayrı/yeni bir kod yolu YAZILMADI**,
   mevcut Veo/Omni mimarisi (`submitVeoVideo`/`submitOmniVideoGeneration`,
   `generate_video_clip`/`generate_omni_video_edit`) olduğu gibi tekrar
   kullanıldı); MCP tarafında ise Claude, dönen `imageUrl`'i ayrı bir
   `generate_video_clip`/`generate_omni_video_edit` çağrısına kendisi verir.

**confirmed:true zorunluluğu** — `generate_nano_banana_scene`/
`POST /api/nano-banana-scene`, `confirmed:true` gönderilmeden **hiçbir ağ
isteği** (Gemini görsel çağrısı dahil) yapmaz; bu, `generate_video_clip`/
`generate_omni_video_edit` ile aynı, bu depoda yerleşik konvansiyondur.
Görsel ve video aşamaları TAMAMEN ayrı `confirmed` onaylarına tabidir —
görsel onayı asla video için de geçerli sayılmaz.

**Fallback yok**: seçilen model (Nano Banana 2, veya sonraki adımda
seçilen Veo tier'ı/Omni) her zaman aynen çağrılır; başarısız olursa başka
bir modele sessizce geçilmez, açık bir hata döner (mevcut Veo/Omni
davranışıyla birebir tutarlı).

**Google'ın "Flow" uygulaması bu depoya entegre EDİLMEDİ** — yalnızca
Flow'un iki-aşamalı mantığı (görsel üret → onayla → hareketlendir) bu
depodaki mevcut mimari üzerinde yeniden uygulandı.

## generate_scene_image — economy/balanced/quality kalite tier'ları (TASK-003)

`generate_scene_image`'ın `provider` parametresi, Google ve OpenAI için
**birleştirilmiş, açık üç kalite tier'ına** karşılık gelir
(`src/scene-image.js:IMAGE_QUALITY_TIERS`/`IMAGE_TIER_PROVIDERS`) — **yeni
bir seçim mekanizması eklenmedi**, mevcut `provider` string'leri (geriye
dönük TAM uyumlu) tier isimlendirmesiyle eşlenmiş durumda:

| Tier | Google `provider` | OpenAI `provider` |
| --- | --- | --- |
| economy | `gemini` (Nano Banana 2 Lite, `GEMINI_SCENE_MODEL`) | `openai-low` (gpt-image-2, `quality:"low"`) |
| balanced | `nano-banana-2` (Nano Banana 2, `GEMINI_NANO_BANANA_2_MODEL`) | `openai` (gpt-image-2, varsayılan quality) |
| quality | `nano-banana-pro` (Nano Banana Pro, `GEMINI_NANO_BANANA_PRO_MODEL`) | `openai-high` (gpt-image-2, `quality:"high"`) |

**Nano Banana Pro capability/discovery-gated'dir**: `provider:"nano-banana-pro"`
çağrılmadan ÖNCE (ürün görseli indirilmeden/maske oluşturulmadan) gerçek bir
`GET /v1beta/models` discovery isteğiyle bu modelin GERÇEKTEN bu hesapta
erişilebilir olduğu doğrulanır (`src/scene-image.js:isNanoBananaProDiscoverable`,
`src/lib/gemini-model-discovery.js:listGeminiModels` — Veo/Omni/Nano Banana
2/Lite ile AYNI, `video-provider-capabilities.js`'in de reuse ettiği tek
discovery fonksiyonu, provider logic İKİ YERDE AYRI AYRI icat edilmedi).
Discovery isteği ağ hatasıyla başarısız olursa (bkz. Veo/Omni'nin mevcut
davranışı) sessizce "unavailable" denmez, yalnızca anahtar varlığına
düşülür; discovery GERÇEKTEN çalışıp modeli listelemiyorsa (hesapta erişim
yok) **SESSİZCE Nano Banana 2'ye düşülmez** — açık bir hata döner.
`GET /api/video-provider-capabilities`'in `google.image.qualityTiers` alanı
(yukarıdaki örnek) bu üç tier'ın anlık `available` durumunu dashboard'a
raporlar.

**Geriye dönük uyumluluk**: `gemini`/`nano-banana-2`/`openai`/`openai-low`/
`composite` değerleri ve davranışları BİREBİR eskisi gibi kalır;
`nano-banana-pro`/`openai-high` yalnızca EKLENEN yeni değerlerdir.
`generate_nano_banana_scene` (yukarıdaki ayrı MCP tool) bu tier
sisteminden etkilenmez — hâlâ her zaman Nano Banana 2'yi hedefler.

## AI Reels V2 — Creative Provider abstraction + model registry (src/creative-providers/)

AI Reels V2 mimarisinin ikinci aşaması (PR-B): `generate_reel_script` (henüz
eklenmedi) için OpenAI+Google model DISCOVERY ve tier registry katmanı.
**Hiçbir tahmini/uydurma model adı registry'ye eklenmez** — yalnızca gerçek
`GET /v1/models` (OpenAI) ve `GET /v1beta/models` (Google) uç noktalarından
(ikisi de ÜCRETSİZ envanter okuma, generation/inference DEĞİL) o an
erişilebilir modeller normalize edilir.

- **`src/creative-providers/openai.js`**: `listOpenAiModels()`. OpenAI'nin
  `/v1/models` yanıtı capability/tip alanı içermediğinden (Google'daki
  `supportedGenerationMethods`'ın eşdeğeri yok), görsel/TTS/embedding/
  moderation/transkripsiyon/gerçek-zamanlı-ses ailelerini bilinen ID
  kalıplarına göre bir DENYLIST ile eler — **doğrulanmış bir capability
  alanı değil, en iyi tahmin bir sezgiseldir** (kod içinde belgelenmiştir).
- **`src/creative-providers/google.js`**: `listGoogleModels()`. Google
  GERÇEK bir capability sinyali döner (`supportedGenerationMethods`
  içinde `generateContent`); buna ek olarak görsel/Veo/Lyria/TTS gibi
  generateContent destekleyen ama senaryo-metni modeli OLMAYAN aileler
  isim deny-list'iyle elenir. Sayfalama (`nextPageToken`) takip edilir.
- **`src/creative-providers/model-registry.js`**: tier eşlemesi (economy/
  balanced/quality/premium) **tamamen env override + gerçek discovery
  doğrulamasına** dayanır — hard-code edilmiş varsayılan model adı YOKTUR:
  - Override yok → `available:false, reason:"not_configured"` (tahmini model atanmaz).
  - Override var ama discovery'de yok → `available:false, reason:"model_not_found"` (sessizce başka modele geçilmez).
  - `OPENAI_CREATIVE_ECONOMY_MODEL` / `_BALANCED_MODEL` / `_QUALITY_MODEL` / `_PREMIUM_MODEL` ve `GOOGLE_CREATIVE_*_MODEL` env değişkenleriyle yapılandırılır.
  - `resolveAutoSelection(tier, ...)`: "auto" kendi tahmin ETMEZ, sabit öncelik sırasıyla (openai → google) hangi sağlayıcı bu tier için gerçekten yapılandırılmış+erişilebilirse onu seçer; hiçbiri uygun değilse `reason:"no_available_provider_for_tier"` — farklı bir tier'a veya daha pahalı bir modele ASLA sessizce düşülmez.
  - `isModelSelectable(provider, model, discovery)`: "Özel" mod için — kullanıcı serbest metinle model adı yazamaz, yalnızca discovery'de GERÇEKTEN listelenmiş bir çifti seçebilir (dashboard PR-D bunu kullanacak).
- API key yoksa (`OPENAI_API_KEY`/`OPENAI_IMAGE_API_KEY`, `GEMINI_API_KEY`)
  hiçbir fetch atılmadan `available:false, reason:"missing_api_key"` döner —
  hata fırlatılmaz, diğer sağlayıcıyı etkilemez.
- `generate_reel_script`'in (PR-C) provider/model seçimi bu registry
  üzerinden yapılır — bkz. aşağıdaki bölüm.

## AI Reels V2 — Product Intelligence (get_buzsu_product_context)

AI Reels V2 mimarisinin ilk aşaması (PR-A): senaryo yazımından ÖNCE GERÇEK Buzsu
ürün bilgisini buzsu.com.tr'den okuyup normalize eder. Sıfırdan bir fetch/cache
mimarisi icat ETMEZ — mevcut `src/lib/buzsu-url.js`, `product-context.js`
(llms-full.txt grounding), `products.js`/`product-catalog.js`/`feed-catalog.js`
(katalog+görsel), `product-installation-context.js` (deterministik kategori
sınıflandırması) modüllerini birleştirir; kalıcı önbellek için `video-jobs.js`
ile AYNI Vercel Blob deseni (`product-context-cache/<url>.json`) kullanılır.
ÜCRETSİZDİR — hiçbir AI/paid API çağrısı yapmaz.

- **Girdi**: `productId` (list_products'tan) veya `productUrl`'den en az biri;
  ikisi de verilirse `productUrl` önceliklidir. `refresh:true` önbelleği atlar.
- **Allowlist**: `productUrl` yalnızca `buzsu.com.tr`/`www.buzsu.com.tr` kabul
  eder (www'siz otomatik `www.buzsu.com.tr`'ye canonicalize edilir); başka
  hiçbir host — ve yönlendirme sonucu başka bir host'a çıkan zincirler de —
  kabul edilmez (her redirect adımı aynı allowlist'ten yeniden geçer).
  `productId` ile gelen istekte de kullanılan URL aynı kontrolden geçer.
- **verifiedFacts**: kaynak metinden (öncelik: llms-full.txt grounding;
  yalnızca eşleşme yoksa destekleyici olarak ürün sayfası meta description)
  alınan BİREBİR cümle alıntılarıdır — AI ile yeniden yazılmaz/uydurulmaz, her
  biri `sourceUrl` taşır. `technicalFeatures`/`sellingPoints`/`useCases`/
  `targetAudience`, AYNI birebir cümlelerin anahtar kelimeye göre (deterministik
  sezgisel) sınıflandırılmasıyla doldurulur — yeni metin üretilmez.
- **prohibitedClaims**: "sayfada geçmeyen her şeyi" listeleyen sonsuz bir alan
  DEĞİL; sabit 5 kategori (sağlık/sertifika/garanti/performans-tasarruf/menşe —
  `src/lib/product-claims.js`, health kategorisi mevcut `content-worker.js`
  `riskyClaims`'i reuse eder). Bir kategori kaynak metinde EN AZ bir kez
  doğrulanırsa listeden düşer.
- **Önbellek**: sonuç ~30 dakika Vercel Blob'da (`fetchedAt`/`contentHash` ile)
  tutulur; okuma bozuk/eksik JSON ise sessizce yok sayılıp yeniden üretilir,
  yazım başarısız olursa (ör. `BLOB_READ_WRITE_TOKEN` yok) tool FAIL OLMAZ —
  taze context döner, hata `warnings`'e eklenir.

## AI Reels V2 — generate_reel_script (senaryo motoru)

AI Reels V2'nin üçüncü aşaması (PR-C): Product Intelligence (PR-A) ile
Creative Provider katmanını (PR-B) birleştirip yapılandırılmış bir
**ReelScript** JSON'u üretir:

```
productId/productUrl → getBuzsuProductContext → verified product facts
→ seçilen OpenAI/Google provider → structured ReelScript
→ claims/sahne/narration doğrulaması → kullanıcıya sonuç
```

Bu araç **yalnızca senaryo üretir** — Veo, Türkçe TTS, Lyria, Omni veya
FFmpeg'i bu adımda hiç çalıştırmaz. **GERÇEK PARA HARCAR** (bir inference
çağrısıdır), `confirmed:true` olmadan hiçbir provider'a istek atılmaz.

- **`src/lib/reel-script-schema.js`**: `validateReelScript()` — provider'dan
  gelen ham JSON'un tek doğrulama katmanı:
  - **Claim policy (ÜRÜN KARARI — bilinçli olarak non-blocking)**: Product
    Intelligence AI üretimini YÖNLENDİRİR, fakat product-claim grounding
    ReelScript üretimini veya validasyonunu **BLOKLAMAZ**. Doğrulanamayan bir
    ürün iddiası artık senaryoyu reddetmez; **`UNVERIFIED_PRODUCT_CLAIM`
    hata sınıfı bu yoldan tamamen kaldırılmıştır**. Neden: fail-closed claim
    filtresi pratikte meşru reklam dilini bloklayarak acceptance'ı durdurdu
    (ör. "Yüksek Alman KRAFT membran teknolojisiyle saf su"). Bu karar
    iddiaların otomatik olarak DOĞRU kabul edildiği anlamına gelmez —
    doğruluk sorumluluğu, sahne onay ekranındaki insan incelemesine aittir.
    Whitelist/denylist/regex claim filtresi veya LLM claim-classifier
    eklenmemiştir ve eklenmemelidir.
  - **claimsUsed = kaynak ataması (görünürlük)**: her öğe
    `{claim, provenance, sourceUrl?}` biçiminde normalize edilir.
    `verifiedFacts` ile eşleşen claim `provenance:"verified"` ve fact'in
    GERÇEK `sourceUrl`'ü ile döner; eşleşmeyen claim `provenance:"unverified"`
    olarak işaretlenir ve dashboard'da "kaynak eşleşmesi bulunamadı" uyarısıyla
    gösterilir. Model veya client'ın gönderdiği `provenance`/`sourceUrl`
    değerine GÜVENİLMEZ: kaynak yalnız server'ın çözdüğü Product Intelligence
    verisinden atanır, uydurma URL geri yansıtılmaz.
  - **Sahne zamanlaması**: 0'dan başlama, çakışmama, negatif olmama, toplam
    süreyi aşmama — ihlalde **`INVALID_SCENE_TIMING`**.
  - **Narration bütçesi**: `video-narration.js`'teki
    `estimateNarrationDurationSeconds()` reuse edilir; tahmini süre
    `durationSeconds * 1.15`'i (turkish-tts.js'teki VOICEOVER_TOO_LONG
    toleransıyla AYNI) aşarsa **`NARRATION_TOO_LONG`** — otomatik kısaltma
    YAPILMAZ.
  - **Veo kısıtları**: her sahnenin `veoPrompt`'una İngilizce "NO spoken
    dialogue. NO narration. NO background music. NO generated captions."
    kısıtı DETERMİNİSTİK olarak eklenir (LLM'e güvenilmez — lyria-music.js'teki
    "instrumental" ekleme deseniyle AYNI mantık); `referenceImageRequired:true`
    olan sahnelere ayrıca Product Identity Lock metni eklenir.
  - **Lyria brief**: `musicBrief.lyriaPrompt`'a "Instrumental only. No
    vocals." zaten yoksa deterministik olarak eklenir.
- **`src/creative-providers/reel-script-prompt.js`**: OpenAI ve Google'ın
  **AYNI** talimatı alması için paylaşılan prompt inşası — buzsu.com.tr'den
  gelen metin ve kullanıcının `userBrief`'i VERİ bloğu olarak çerçevelenir
  (talimat olarak yorumlanmaz), `userBrief` `scenario-schema.js`'teki
  `sanitizeUserText()` ile temizlenir.
- **Provider/model seçimi**: PR-B'nin registry'sinden — `model` verilirse
  `provider` "auto" OLAMAZ (açıkça `openai`/`google`) ve model gerçek
  discovery'de listelenmiş olmalı ("Özel" mod, serbest yazım YOK);
  verilmezse `modelTier` registry'den çözülür. Başarısızlıkta (yapılandırılmamış/
  bulunamayan model/API key yok) **`MODEL_UNAVAILABLE`** — başka bir ücretli
  modele ASLA otomatik geçilmez.
- **`generate_reel_script` (MCP tool)**: `productId`/`productUrl`'den en az
  biri yeterli (PR-A ile aynı kural); `confirmed:true` şart.

## AI Reels V2 — research_web (TASK-001: provider-independent research katmanı)

`src/research/` — Google Search Grounding + URL Context ve OpenAI Web Search
için ortak, provider-independent bir güncel-web-araması katmanı. Amaç,
provider'ların eğitim verisi kesim tarihinden sonraki gelişmeleri (güncel
API/model durumu, rakip bilgisi, mevzuat vb.) gerektiren durumları
kapatmaktır.

- **`resolveResearchProvider`** (`src/research/provider.js`) —
  `creative-providers/model-registry.js`'teki `resolveAutoSelection` İLE AYNI
  sözleşme: `provider:"auto"` sabit bir öncelik sırasıyla (google, sonra
  openai) İLK GERÇEKTEN yapılandırılmış (API key mevcut) sağlayıcıyı seçer;
  hiçbir koşulda başarısız bir sağlayıcıdan diğerine SESSİZCE geçilmez —
  `available:false` + `reason` (`missing_api_key`/`no_available_provider`/
  `unsupported_provider`) döner, çağıran taraf (`researchWeb`) bunu açık bir
  hataya çevirir.
- **`src/research/google-search.js`**: Gemini'nin `googleSearch` tool'u
  (Search Grounding) ve — `urls` verildiğinde — `urlContext` tool'u AYNI
  `generateContent` çağrısında kullanılır (aynı `GEMINI_API_KEY`, aynı uç
  nokta — `creative-providers/google.js` ile aynı HTTP taşıması). Kaynaklar
  `groundingChunks` + `urlContextMetadata.urlMetadata`'dan gelir.
- **`src/research/openai-search.js`**: Responses API'nin `web_search`
  tool'u (aynı `OPENAI_API_KEY`/`OPENAI_IMAGE_API_KEY`, aynı `/v1/responses`
  uç noktası). Tool adı OpenAI tarafında değişirse `OPENAI_WEB_SEARCH_TOOL_TYPE`
  ile override edilebilir. Kaynaklar `url_citation` annotation'larından gelir.
- **`src/research/normalize.js`**: her kaynağı `{url, title, snippet,
  provider}` şekline indirger, aynı URL'i tekrar etmez (dedup), en fazla 20
  kaynak tutar.
- **`research_web` (MCP tool)**: `query` ve `confirmed:true` zorunlu;
  `provider` (`auto`/`google`/`openai`, varsayılan `auto`) ve `urls`
  (en fazla 5, URL Context) isteğe bağlı. **GERÇEK PARA HARCAR** (bir inference
  çağrısıdır); `confirmed:true` olmadan provider çağrısı yapılmaz.
- **`generate_reel_script` entegrasyonu**: isteğe bağlı `researchMode`
  (varsayılan **`"none"`** — verilmezse `research_web`'e HİÇ istek atılmaz,
  davranış eskisiyle AYNI kalır). `"auto"`/`"google"`/`"openai"` verilirse
  (AYNI `confirmed:true` onayı altında) `research_web` önce çağrılır;
  bulunan cevap + normalize edilmiş kaynaklar senaryo prompt'una ayrı bir
  VERİ bloğu olarak eklenir (`reel-script-prompt.js`) ve sonuçtaki
  `research` alanında raporlanır. `researchQuery` verilmezse ürünün adı
  (zaten çözülmüş `productContext`'ten) kullanılır — uydurma bir değer
  değildir.

## transcribe_media (TASK-002: provider-independent transkripsiyon katmanı)

`src/transcription/` — Google Gemini 3.5 Transcribe (Files API + Interactions
API) veya OpenAI Whisper/gpt-4o-transcribe-diarize (`/v1/audio/transcriptions`)
ile bir medya dosyasını birebir metne çeviren, provider-independent bir katman.
Model seçimi GERÇEK bir `/models` discovery çağrısıyla doğrulanır —
`creative-providers/model-registry.js`'teki `resolveTier` İLE AYNI ilke:
yapılandırılmış bir model discovery'de bulunamazsa SESSİZCE başka bir modele
düşülmez, `model_not_found` hatası döner.

- **`src/transcription/media-fetch.js`**: mediaUrl'den ham byte'ları indiren
  TEK ortak yardımcı — `src/lib/upload-media.js`'teki (upload_media/
  fetchPublicImage/fetchPublicAudio/fetchPublicVideo) GERÇEK SSRF-güvenli
  indirme çekirdeğini (`fetchPublicMediaFile`) reuse eder: yalnız HTTPS,
  hostname'in çözümlendiği IP'nin özel/yerel olmadığı (`assertPublicHttpsUrl`),
  HER yönlendirme adımının yeniden doğrulanması ve gövdenin akış hâlinde
  okunup limit aşılır aşılmaz durdurulması (Content-Length'e güvenmeden) —
  kendi SSRF/streaming mantığı İCAT EDİLMEMİŞTİR. **Ayrı bir FFmpeg
  ses-ayıklama adımı KASITLI olarak YOKTUR**: OpenAI `/v1/audio/
  transcriptions` mp4/webm video container'larını DOĞRUDAN kabul eder — MOV/
  M4V gibi diğer kapsayıcılar OpenAI'nin belgelenmiş format listesinde
  OLMADIĞI için `openai-transcribe.js`'te AÇIKÇA reddedilir (bu katmanın
  kendi MIME listesi kasıtlı olarak geniştir — sıkı, sağlayıcıya özgü
  reddetme adapter seviyesinde olur). **Google video KABUL ETMEZ** — Gemini
  3.5 Transcribe yalnız ses MIME türleriyle çalışır; video verilirse açık
  bir hatayla (OpenAI'yi seçin veya önce ses ayıklayın) reddedilir. Dosya
  ~24MB'ı (Vercel fonksiyon sınırları + Whisper'ın API limiti) aşarsa
  SESSİZCE küçültülmez — açık bir hata döner; bu durumda mevcut GitHub
  Actions FFmpeg render kuyruğu (`src/lib/ffmpeg-command.js`,
  `src/reel-audio-compose.js`) yeniden kullanılmalı, yeni bir senkron FFmpeg
  alt sistemi İCAT EDİLMEMİŞTİR.
- **`src/transcription/provider.js`**: `discoverTranscriptionModels` her iki
  sağlayıcının GERÇEK model listesini (`GET /v1beta/models` /
  `GET /v1/models`, `transcribe`/`whisper` adlı modellerle filtrelenmiş) çeker.
  `resolveTranscriptionProvider` bu discovery'ye karşı: (1) API key var mı,
  (2) yapılandırılmış model (`GOOGLE_TRANSCRIBE_MODEL`/`OPENAI_TRANSCRIBE_MODEL`
  veya varsayılan) discovery'de GERÇEKTEN listeleniyor mu, (3) istenen
  capability'yi (diarization/customVocabulary) o model destekliyor mu —
  üçünü de doğrular; herhangi biri tutmazsa SESSİZCE başka bir modele/
  sağlayıcıya geçmez, açık bir `reason` ile `available:false` döner.
  `transcriptionCapabilities(provider, model)` MODEL BAZLI bir matristir
  (aynı provider'ın farklı modelleri farklı yeteneklere sahip olabilir):
  Google `gemini-3.5-transcribe` → native diarization + kelime düzeyinde
  `"exact_word"` zaman damgası + custom vocabulary (diarization ile BİRLİKTE
  değil); OpenAI `whisper-1` → segment düzeyinde `"exact_segment"` zaman
  damgası + custom vocabulary, diarization YOK; OpenAI
  `gpt-4o-transcribe-diarize` → native diarization + `"exact_segment"` zaman
  damgası, custom vocabulary YOK (prompt alanı desteklenmez).
  `diarization:true` + `vocabularyHints` AYNI istekte birlikte verilemez
  (`index.js` bunu discovery'ye gitmeden erkenden reddeder) — ikisi karşılıklı
  dışlar.
- **`src/transcription/google-transcribe.js`**: Gemini Files API'ye (resumable
  upload) yükler, sonra Interactions API'ye (`transcription_config`:
  `language_codes`/`custom_vocabulary`/`mode.diarization_mode`/
  `mode.timestamp_granularities`) transkript ister; kelime düzeyinde
  zaman damgası + konuşmacı etiketleri `word_info` annotation'larından
  (`start_offset`/`end_offset` "0.500s" formatı) çıkarılır.
- **`src/transcription/openai-transcribe.js`**: `whisper-1` →
  `response_format:"verbose_json"` + `timestamp_granularities[]:"segment"` +
  `prompt` (vocabulary ipucu); `gpt-4o-transcribe-diarize` →
  `response_format:"diarized_json"` + `chunking_strategy:"auto"`, `prompt`
  YOK (model bunu desteklemez). Aynı `OPENAI_API_KEY`/`OPENAI_IMAGE_API_KEY`
  reuse edilir.
- **`src/transcription/normalize.js`**: her segmenti `{startSeconds,
  endSeconds,text,speaker}` şekline indirger; `endSeconds <= startSeconds`
  olan bozuk segmentler sessizce ATLANIR (uydurma zaman damgası üretilmez).
- **`transcribe_media` (MCP tool)**: `mediaUrl` ve `confirmed:true` zorunlu;
  `provider` (`auto`/`google`/`openai`), `languageHint`, `vocabularyHints`
  (en fazla 20) ve `diarization` isteğe bağlı. Sonuçta `modelUsed` (gerçekte
  discovery'den doğrulanmış/seçilmiş model) ve `capabilities` de raporlanır.
  **GERÇEK PARA HARCAR.**

## validate_product_visual (TASK-004: referans fotoğrafına karşı görsel doğrulama)

`src/visual-validation/` — AI ile üretilmiş bir sahne görselini, ürünün
GERÇEK referans fotoğrafıyla (Google Gemini vision) DOĞRUDAN karşılaştıran,
ayrı ve isteğe bağlı bir kontrol katmanı. Bu, `generate_scene_image`/
`generate_nano_banana_scene`'in kendi otomatik incelemesinden
(`src/lib/scene-validation.js`, yalnızca metin bağlamına karşı, referans
görsel YOK) **farklıdır** — o mevcut akışın varsayılan davranışı bu tool
tarafından HİÇ DEĞİŞTİRİLMEZ; `validate_product_visual` tamamen ayrı,
açıkça çağrılan bir MCP tool'dur.

- **Karar mekanizması `scene-validation.js` ile AYNI ilke**: tek bir
  arbitrary güven puanı/confidence skoru KULLANILMAZ. Karar, 7 sabit kontrol
  kategorisine (`identity`, `logo`, `label`, `proportions`,
  `component_count`, `installation`, `fabricated_text`) karşı normalize
  edilmiş bir `failedChecks` listesinden türetilir — model bir sayısal puan
  döndürse bile bu OKUNMAZ/KULLANILMAZ (`src/visual-validation/prompt.js`
  modele bunu ÜRETMEMESİNİ de açıkça söyler). `checks` alanı her zaman TAM
  listedir; `passed = failedChecks.length === 0`; `needsReview =
  failedChecks.length > 0`.
- **`src/visual-validation/checks.js`**: `VISUAL_VALIDATION_CHECKS` sabit
  listesi + `normalizeFailedChecks` — modelin uydurma/bilinmeyen bir kontrol
  kodu döndürmesi SESSİZCE elenir (halüsinasyona karşı savunma), bilinen
  kodlar tekilleştirilir.
- **`src/visual-validation/gemini-compare.js`**: Gemini'ye TEK bir
  `generateContent` çağrısında referans görseli ÖNCE, üretilen görsel SONRA
  (iki `inlineData` parçası) gönderir. Model
  `GEMINI_VISUAL_VALIDATION_MODEL` ile override edilebilir (varsayılan
  `gemini-3.5-flash`). `scene-validation.js`'in soft-fail (hiç
  throw etmeyen) davranışından FARKLI OLARAK burada hata SESSİZCE
  yutulmaz — API key yoksa veya karşılaştırma başarısız olursa açıkça
  throw eder, çünkü bu birincil, açıkça çağrılan bir tool'dur (ikincil bir
  otomatik inceleme değil). `generationConfig.responseSchema` ile modelin
  çıktısı sabit `VISUAL_VALIDATION_CHECKS` enum'ına ve `notes:string`'e
  ZORLANIR (Gemini structured output) — ama bu şema GÜVENİLİP atlanan bir
  kısayol DEĞİLDİR: yanıt (boş/eksik metin, bozuk JSON, `failedChecks`'in
  dizi OLMAMASI) yine de KARARDAN ÖNCE ayrıca doğrulanır. **FAIL-CLOSED**
  (ROOT review, PR #103): bu üç durumdan HİÇBİRİ sessizce
  `failedChecks:[]`'e (yani `passed:true`'ya) çevrilmez — açık bir hata
  fırlatılır, çünkü bozuk/anlaşılamayan bir model yanıtı bir ürün görselini
  ASLA sessizce onaylayamaz. Yalnızca gerçekten geçerli, dizi tipinde bir
  `failedChecks` (boş dizi dahil) normal `passed`/`needsReview` kararına
  girer.
- **`src/visual-validation/index.js`** (`validateProductVisual`): referans
  görseli ve üretilen görseli (URL veya base64, `upload_media` ile aynı
  ikili giriş deseni) `src/lib/upload-media.js`'teki GERÇEK SSRF-güvenli
  `fetchPublicImage`/`decodeImageBase64` çekirdeğini reuse ederek indirir —
  kendi indirme/doğrulama mantığı İCAT EDİLMEMİŞTİR.
- **`validate_product_visual` (MCP tool)**: `referenceImageUrl` ve
  `confirmed:true` zorunlu; `generatedImageUrl` VEYA
  (`generatedImageBase64`+`generatedImageMimeType`) TAM OLARAK biri
  zorunlu, `productTitle`/`sceneDescription` isteğe bağlı. Çıktı:
  `{passed, needsReview, checks, failedChecks, notes}`. **GERÇEK PARA
  HARCAR** (bir Gemini vision çağrısıdır).

## generate_image_from_video (TASK-005: Video → Image Creative)

`src/video-to-image/` ayrı bir video-to-image yaratıcı akışıdır; mevcut
`generate_scene_image` akışını genişletmez veya overload etmez. Amaç bir
videonun bağlamından thumbnail, poster, carousel kartı veya Story kapağı gibi
yeni bir görsel sentezlemektir.

**Resmi destek doğrulaması (Google Gemini API, 2026-09-03 güncel dokümanı):**
video girdisi ile image generation yalnız `gemini-3.1-flash-image` ve
`gemini-3.1-flash-lite-image` modellerinde desteklenir. Public YouTube URL
doğrudan `fileData.fileUri` olarak verilebilir; diğer/local video dosyaları
Files API'ye yüklenip oluşan file URI ile `generateContent` çağrısına
eklenir. Kaynak: Google AI Developers → Nano Banana image generation →
“Video-to-image generation (3.1 Flash and 3.1 Flash Lite)”.

Bu repo iki yolu şöyle uygular:
- **Public YouTube URL** → indirme/yükleme yapmadan doğrudan Gemini
  `fileData`; `videoMetadata.fps=0.5`.
- **Diğer public HTTPS video URL** → mevcut `fetchPublicVideo` ile
  HTTPS/SSRF/redirect/MIME/boyut doğrulaması → Gemini resumable Files API →
  video `ACTIVE` olana kadar durum kontrolü → `fileData`.
- Model varsayılanı `gemini-3.1-flash-image`; opsiyonel
  `GEMINI_VIDEO_TO_IMAGE_MODEL` yalnız desteklenen iki modelden biri olabilir.
  Seçilen model gerçek model discovery sonucunda yoksa **sessiz fallback yok**.
- `confirmed:true` olmadan hiçbir ücretli çağrı yapılmaz.
- Çıktı BLOB token varsa Vercel Blob'a yazılır; yoksa data URL döner.

MCP:
`generate_image_from_video({videoUrl,prompt,aspectRatio?,model?,confirmed:true})`.

## search_product_knowledge (TASK-006: Product Knowledge / File Search)

`src/knowledge/` Google Gemini File Search ve OpenAI File Search/Vector
Store altyapısını aynı MCP sözleşmesinin arkasında birleştirir. Bu katman,
Airtable ve resmi Buzsu kaynaklarının yerine geçmez.

**Kaynak önceliği:**
1. `airtable` — mevcutsa ürün kimliği/operasyonel kayıt.
2. `buzsu_official` — exact XML feed + canonical Buzsu ürün sayfasından
   `getBuzsuProductContext` ile çıkarılan doğrulanmış gerçekler.
3. `file_search` — Google/OpenAI deposundaki ek dokümanlar.

File Search belgesi daha yüksek öncelikli kaynakla çelişirse sistem düşük
öncelikli bilgiyi sessizce gerçek kabul etmez. Sonuçta `conflicts` ve
`hasConflicts` alanları döner; hangi resmi gerçekle hangi doküman bilgisinin
çeliştiği açıkça gösterilir.

**Provider davranışı**
- `provider:"auto"`: key + store birlikte yapılandırılmışsa önce Google,
  sonra OpenAI seçilir. Seçilen provider çağrı sırasında başarısız olursa
  diğer ücretli providera **sessiz fallback yapılmaz**.
- Google: `GOOGLE_PRODUCT_KNOWLEDGE_STORE=fileSearchStores/...`,
  `GEMINI_API_KEY`; Gemini Interactions API `file_search` tool'u kullanılır.
- OpenAI: `OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID=vs_...`,
  `OPENAI_API_KEY`/mevcut text key; Responses API `file_search` tool'u
  `vector_store_ids` ile kullanılır.
- Her iki provider'da model çıktısı yapılandırılmış JSON olarak istenir.
- `confirmed:true` olmadan provider/model çağrısı başlamaz.

Google'ın File Search API'si dosyaları store'a import edip semantik olarak
arar; Interactions API'de `tools:[{type:"file_search",
file_search_store_names:[...]}]` kullanılır. OpenAI tarafında vector store,
Responses `file_search` aracına `vector_store_ids` ile verilir.

MCP örneği:
`search_product_knowledge({productId,query,provider:"auto",confirmed:true})`

## run_agent_orchestration (TASK-007: Controlled Agent Orchestrator)

`src/orchestrator/` — TASK-001..006'nın MEVCUT READ/GENERATE
capability'lerini (kendi provider mantıklarını TEKRARLAMADAN, doğrudan
çekirdek fonksiyonlarını çağırarak) sabit, sıralı bir adım listesi olarak
yürüten **deterministik, sınırlı (bounded) bir state machine**.
`generate_scene_image`/`research_web`/`transcribe_media`/
`validate_product_visual`/`generate_image_from_video`/
`search_product_knowledge`'in kendi MCP tool'ları BİREBİR aynı çalışır —
bu orkestratör onların ÜZERİNE, isteğe bağlı bir koordinasyon katmanıdır.

**Durum modeli** (`src/orchestrator/states.js`) — run VE her adım için AYNI
6 sabit durum:

| Durum | Anlamı |
|---|---|
| `pending` | Run henüz doğrulanmadı/başlamadı (geçiş anı, senkron yanıtta hiç gözlemlenmez). |
| `running` | Adımlar sırayla yürütülüyor (geçiş anı). |
| `waiting_for_confirmation` | Bir adım ücretli ve `confirmed:true` almadı — run burada GÜVENLE durur. |
| `completed` | Tüm adımlar başarıyla tamamlandı. |
| `failed` | Bir adım (tüm retry'ları tükettikten sonra) başarısız oldu. |
| `blocked` | Plan yürütülmeye BAŞLAMADAN reddedildi (malformed/bilinmeyen capability/sınır aşımı). |

Geçişler `assertValidTransition` ile SABİT bir tabloya karşı doğrulanır —
`pending->running`, `pending->blocked`, `running->completed`,
`running->failed`, `running->waiting_for_confirmation`; hiçbir terminal
durumdan (completed/failed/blocked/waiting_for_confirmation) başka bir
duruma geçiş YOKTUR (bu sürüm bir run'ı devam ettirmez/resume etmez — her
çağrı sıfırdan `pending`te başlar).

Yanıt alanları (manifest'in `required_run_metadata`'sıyla AYNI semantik,
bu depodaki HER mevcut MCP yanıtıyla tutarlı olacak şekilde camelCase'e
çevrilmiş — `run_id`→`runId`, `current_step`→`currentStep`,
`completed_steps`→`completedSteps`, `pending_steps`→`pendingSteps`,
`blocked_or_confirmation_reason`→`blockedOrConfirmationReason`,
`failure_reason`→`failureReason`,
`capability_or_tool_used`→`capabilityOrToolUsed`):
`{runId, status, currentStep, completedSteps, pendingSteps,
blockedOrConfirmationReason, failureReason, capabilityOrToolUsed}`.
`completedSteps` önceki BAŞARILI adımların `{stepId, capability, output}`
kayıtlarıdır — bir adım başarısız/onay-bekliyor olduğunda bunlar yanıtta
KORUNUR, hiçbir zaman silinmez.

**Capability registry** (`src/orchestrator/capabilities.js`) — sabit bir
allowlist, sadece 8 isim: `list_products`, `get_buzsu_product_context`
(READ, onay gerektirmez) ve `research_web`, `transcribe_media`,
`generate_scene_image`, `validate_product_visual`,
`generate_image_from_video`, `search_product_knowledge` (GENERATE, HEPSİ
`requiresConfirmation:true`). `publish_now`/`create_draft`/
`update_draft`/`update_status`/`set_autopilot`/`upload_media` veya
herhangi bir silme/env/deployment işlemi registry'de **hiç yoktur** —
bilinmeyen/izin verilmeyen bir capability adı PLANIN TAMAMINI (hiçbir adım
çalışmadan) `blocked` olarak reddeder.

**Onay (confirmation) davranışı** — `research_web`/`transcribe_media`/
`validate_product_visual`/`generate_scene_image`'ın ÇEKİRDEK
fonksiyonlarında (kendi MCP case handler'larının AKSİNE) hiçbir dahili
`confirmed` kontrolü YOKTUR — bu kontrol normalde SADECE `api/mcp.js`'in
case handler'ında yaşar. Orkestratör bu çekirdek fonksiyonları case
handler'ı ATLAYARAK çağırdığı için, AYNI onay kapısını
`capabilities.js`'te (ağ çağrısından ÖNCE) YENİDEN uygular — hiçbir adım
için `confirmed` kendiliğinden ÜRETİLMEZ/VARSAYILMAZ; çağıran HER ücretli
adım için `confirmed:true`'yu O ADIMIN KENDİ `args`'ında AÇIKÇA
göndermelidir. `generate_image_from_video`/`search_product_knowledge`
KENDİ İÇLERİNDE de ayrıca bir confirmed kontrolü yapar (savunma katmanı).

**Güvenlik kararları:**
- `generate_scene_image` orkestratör içinde `api/mcp.js`'in case
  handler'ı DEĞİL, ÇEKİRDEK `generateSceneImage`/
  `generateCompositeSceneImage` fonksiyonları üzerinden çalışır — case
  handler'ın ürettiği Vercel Blob upload + Airtable "Görsel URL" PATCH
  (kalıcı ürün kaydı güncellemesi) BİLEREK dahil EDİLMEZ, çünkü bu
  manifest'in `forbidden_capabilities` listesindeki "arbitrary
  external-state updates"e girer. Orkestratörden gelen bu adımın çıktısı
  SADECE `dataUrl`/`prompt`/`provider`/`model` içerir, hiçbir Airtable
  kaydı DEĞİŞMEZ.
- **`generate_scene_image` provider yönlendirmesi (ROOT review, PR #106)**:
  `args.provider === "composite"` ÖZEL bir yürütme rotasıdır — normal
  provider doğrulamasından ÖNCE ele alınır ve `availableSceneProviders(env)`
  hiç sorulmadan doğrudan `generateCompositeSceneImage`'a yönlendirilir;
  "composite" o listede GÖRÜNMESE bile (örn. `GEMINI_API_KEY` tanımsız,
  sadece `OPENAI_API_KEY` varken) bu adım REDDEDİLMEZ — composite'in
  GERÇEK ön koşulu (`GEMINI_API_KEY`) zaten `generateCompositeSceneImage`'ın
  KENDİSİ tarafından uygulanır, orkestratör bunu bypass ETMEZ/tekrar
  KONTROL ETMEZ. Normal (composite dışı) bir provider caller tarafından
  AÇIKÇA istenirse, gerçekten kullanılabilir `availableSceneProviders(env)`
  listesine karşı doğrulanır — kullanılamıyorsa **FAIL CLOSED** bir hata
  döner (`providers[0]`'a SESSİZCE düşülmez, hiçbir üretim çağrısı
  YAPILMAZ). `provider` hiç verilmemişse (caller açıkça başka bir şey
  istemediği için) mevcut "ilk kullanılabilir provider" varsayılanı
  KORUNUR — bu bir silent fallback değildir, dokümante edilmiş bir
  varsayılan seçimdir.
- Ürün çözümleme (`productId`→ürün) `api/mcp.js`'in özel (export
  edilmemiş) `resolveProduct`'ından KOPYALANMAZ/import EDİLMEZ (bir `src/`
  modülünün bir `api/` route dosyasına bağımlı olması ters bir katman
  ilişkisi olurdu); onun yerine ZATEN paylaşılan `src/lib/products.js`
  (`listRawRecords`) ve `src/lib/product-catalog.js`
  (`isCatalogProductId`/`findCatalogProduct`) birincilleri kullanılarak
  AYNI çözümleme AYRI bir fonksiyonda yeniden inşa edilir — Airtable
  HTTP+pagination mantığı yine TEK bir yerde (`listRawRecords` içinde)
  kalır.
- Hata mesajları (`failureReason`/`blockedOrConfirmationReason`) daima
  bilinen tüm secret env değişkenlerine (AIRTABLE_TOKEN, GEMINI_API_KEY,
  OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN, ... — bkz.
  `src/orchestrator/redact.js`) karşı redakte edilir; bir capability'nin
  hata metnine kazara sızmış ham bir anahtar/token ASLA olduğu gibi
  caller'a dönmez.
- Adım girdileri (`args`) her capability için SABİT bir `allowedArgs`
  kümesine karşı doğrulanır — tanımlı olmayan bir alan gönderilirse PLANIN
  TAMAMI reddedilir; yürütme yetkisi doğrulanmış şema + state + policy'den
  gelir, serbest biçimli bir girdi hiçbir zaman doğrudan bir capability'ye
  ulaşmaz.

**Sınırlar (bounded):** en fazla 20 adım (`MAX_STEPS`), adım başına en
fazla 3 deneme (`MAX_RETRY_ATTEMPTS`, `maxAttempts:1` varsayılan) — ne
adım sayısında ne retry'da sınırsız/örtük bir davranış yoktur (bkz.
`src/orchestrator/validate.js`).

**Bilinen sınırlamalar:** bu sürüm SENKRON ve TEK ÇAĞRILIKTIR — bir run
`waiting_for_confirmation` durumunda durduğunda, caller aynı planı
(eksik adım için `confirmed:true` eklenmiş şekilde) YENİDEN göndermelidir;
orkestratör kendi başına bir run'ı "resume" etmez/beklemede bırakmaz,
kalıcı bir run deposu (Airtable/DB) YOKTUR. Adımlar arasında veri
aktarımı (bir adımın çıktısını sonraki adımın girdisine bağlama) da bu
sürümde YOKTUR — her adımın `args`'ı çağıran tarafından SABİT olarak
verilir.

MCP örneği:
`run_agent_orchestration({steps:[{stepId:"s1",capability:"research_web",args:{query:"...",confirmed:true}}]})`

## run_deep_research (TASK-008: Read-Only Deep Research Layer)

`src/deep-research/` — SEO fırsatları, rakip analizi ve haftalık içerik
fırsatları için **salt-okunur**, provider-independent bir derin araştırma
akışı. `research_web` (TASK-001) ve `search_product_knowledge`/
`get_buzsu_product_context` (TASK-006) capability'lerini REUSE eder —
kendi bir provider mantığı İCAT ETMEZ. `src/orchestrator/`'a (TASK-007)
bağımlı DEĞİLDİR — TASK-008'in `depends_on`'u yalnız TASK-001/TASK-006'dır,
bu modül kendi bağımsız, sabit allowlist'ini tutar.

**Araştırma modları** (`RESEARCH_MODES`): `seo`, `competitor`,
`weekly_content_opportunities`. `seo`/`competitor` için `objective`
ZORUNLUDUR (uydurma bir hedef İCAT EDİLMEZ); `weekly_content_opportunities`
için `objective` isteğe bağlıdır — sensible bir varsayılanı vardır ("Bu
hafta Buzsu su arıtma ürünleri için güncel içerik ve trend fırsatları.").
Bilinmeyen/desteklenmeyen bir mode veya eksik `objective`, hiçbir ağ
çağrısı yapılmadan reddedilir.

**Salt-okunur allowlist** (`DEEP_RESEARCH_ALLOWED_CAPABILITIES`): sabit,
yalnızca 3 isim — `research_web`, `search_product_knowledge`,
`get_buzsu_product_context`. `publish_now`/`create_draft`/`update_draft`/
`update_status`/`set_autopilot`/`upload_media` veya herhangi bir silme/
env/deployment işlemi bu modülde **hiç import edilmez/çağrılmaz** — bu
sadece bir dokümantasyon iddiası değildir, `src/deep-research/index.js`
başka hiçbir yazma/mutasyon fonksiyonunu import ETMEZ.

**Çıktı sözleşmesi** — alan adları manifest'in `required_output`'uyla
BİREBİR aynı (bu tek MCP yanıtı, depodaki diğerlerinin AKSİNE camelCase
DEĞİL, snake_case'tir — bu görev için TASK-007'nin `state_model`'indeki
gibi bir "equivalent names" izni verilmediğinden BİLEREK literal tutuldu):

```
{
  query_or_objective,        // orijinal objective (veya mode'un varsayılanı)
  findings,                  // [{capability, provider, answer}, ...] — HER kapasitenin kendi cevabı, TEK bir anlatıya birleştirilmez
  sources,                   // normalize edilmiş {url,title,snippet,provider,capability}[] — research_web'in KENDİ normalizasyonu REUSE edilir
  uncertainty,                // deterministik notlar dizisi (örn. "research_web yalnızca 1 kaynağa dayanıyor") — bir AI güven puanı DEĞİLDİR
  conflicts,                  // search_product_knowledge kullanıldıysa TASK-006'nın KENDİ tespit ettiği çelişkiler, OLDUĞU GİBİ (sessizce çözülmeden)
  providers_or_capabilities_used // örn. ["get_buzsu_product_context","research_web:google","search_product_knowledge:openai"]
}
```

**Kaynak/uncertainty/conflict semantiği:**
- `sources`, `research_web`'in KENDİ `normalizeSources`'ından (TASK-001) ve
  (kullanılıyorsa) `search_product_knowledge`'ın `citations`'ından
  (TASK-006) gelir — burada AYRICA bir normalizasyon İCAT EDİLMEZ, her
  kayda hangi capability'den geldiği (`capability` alanı) eklenir.
- `uncertainty` **arbitrary bir AI güven puanı DEĞİLDİR** (bkz.
  `validate_product_visual`/TASK-004'teki AYNI "no arbitrary confidence
  score" ilkesi) — tamamen deterministik, YAPISAL sinyallerden türetilir:
  `research_web` sıfır kaynak döndürürse veya tam olarak 1 kaynağa
  dayanıyorsa, ya da `search_product_knowledge` çelişki bulduysa
  (`hasConflicts`) bir not eklenir; aksi halde boş dizidir (bu "kesin"
  anlamına gelmez, sadece bu deterministik kontrolün bir bayrak
  bulmadığı anlamına gelir).
- `conflicts`, `search_product_knowledge`'ın KENDİ çelişki tespiti
  (yüksek-otoriteli kaynak vs. düşük-otoriteli belge) OLDUĞU GİBİ
  yüzeye çıkarılır — sessizce "gerçek" kabul edilip ezilmez.

**Provider ve onay davranışı** — TEK bir üst-seviye `confirmed:true`
TÜM akışı onaylar (`generate_reel_script`'in isteğe bağlı `researchMode`'u
İLE AYNI ilke — bkz. yukarıdaki bölüm): bu, TASK-007'nin orkestratörünün
AKSİNE, çağıranın seçtiği ADIMLARDAN oluşan genel bir plan DEĞİLDİR, sabit
bir araştırma akışıdır, bu yüzden tek bir onay yeterli ve tutarlıdır.
`confirmed:true` olmadan `get_buzsu_product_context` (ÜCRETSİZ) DAHİL
hiçbir çağrı yapılmaz — onay hiçbir zaman kendiliğinden ÜRETİLMEZ.
`research_web`/`search_product_knowledge`'ın KENDİ "sessiz fallback yok"
ilkesi (bkz. TASK-001/TASK-006) burada da bozulmadan geçerlidir — bir
provider başarısızlığında deep-research kendi başka bir provider'a
GEÇMEZ, hatayı olduğu gibi (secret redaksiyonu dışında) yükseltir.

**Ürün bağlamı (isteğe bağlı):** `productId`/`productUrl` verilirse
`get_buzsu_product_context` (ÜCRETSİZ) ile sorgu zenginleştirilir.
`productKnowledgeQuery` AYRICA verilirse (VE bir ürün bağlamı varsa)
`search_product_knowledge` (ücretli, AYNI `confirmed:true` altında)
DA çağrılır — otomatik/örtük DEĞİLDİR.

**`competitors`/`urls` girdi sınırı — FAIL CLOSED (ROOT review, PR #107):**
her ikisi de en fazla 5 öğe kabul eder (`MAX_COMPETITORS`/`MAX_URLS`,
`src/deep-research/validate.js`). Sınırı aşan bir dizi SESSİZCE KIRPILMAZ —
hiçbir downstream capability/ağ çağrısı yapılmadan açıkça reddedilir.
AÇIKÇA verilmiş ama dizi olmayan bir değer de aynı şekilde reddedilir
(sessizce `[]`'e çevrilmez); alan hiç verilmemişse (omitted) normal şekilde
`[]`'e normalize edilir. Dizideki her öğe boş olmayan bir string olmalıdır
— malformed bir öğe (obje, sayı, boş string) sessizce geçerli bir isim/URL
gibi yeniden yorumlanmaz, PLANIN TAMAMI reddedilir. `MAX_URLS` bilerek
`research_web`'in (TASK-001, `src/research/index.js`) KENDİ `MAX_URLS`
sabitiyle (5) AYNI değere sahip, TASK-008'e özgü bir sabittir — TASK-001'in
dosyasına dokunulmadan/export eklenmeden aynı üst sınır TASK-008'in kendi
sınırında da uygulanır; böylece `run_deep_research`, `research_web`'in
kendi (dokümante edilmiş, değiştirilmemiş) sessiz kırpmasına HİÇ
ulaşmadan reddeder.

**Bilinen sınırlamalar:** `conflicts`/kaynak-çakışması tespiti YALNIZ
`search_product_knowledge` çağrıldığında mevcuttur (yani bir ürün bağlamı
+ `productKnowledgeQuery` verildiğinde) — `research_web`'in birden çok
kaynağı arasındaki olası çelişkiler bu sürümde AYRICA analiz EDİLMEZ
(bu, güvenilir bir şekilde deterministik olmayan bir semantik karşılaştırma
gerektirirdi); `findings` her capability'nin kendi cevabını AYRI AYRI
taşır, tek bir sentezlenmiş anlatıya BİRLEŞTİRİLMEZ.

MCP örneği:
`run_deep_research({mode:"seo",objective:"kireç önleyici anahtar kelimeleri",provider:"auto",confirmed:true})`

## AI Araştırma / Agent Workspace (TASK-009: Dashboard AI Research / Agent Workspace)

Dashboard'da (`dashboard.html`, `data-tab="ai-workspace"` — nav'da "AI
Araştırma / Agent") TASK-007'nin kontrollü agent orkestratörünü
(`run_agent_orchestration`) ve TASK-008'in salt-okunur derin araştırma
katmanını (`run_deep_research`) authenticated kullanıcıya sunan bir sekme.
Bu sekme **hiçbir yeni provider/validation/allowlist/state-machine mantığı
İCAT ETMEZ** — sunucu tarafında yalnızca `api/ai-workspace.js` adlı EN
KÜÇÜK HTTP adaptörü vardır, o da `runDeepResearch`/`runOrchestration`'ı
DOĞRUDAN (case handler'ları ATLAYARAK, ama TASK-007/008'in KENDİ iç
onay/allowlist kontrolleri ile AYNI şekilde) çağırır.

**TASK-007/TASK-008 reuse noktaları:**
- Derin Araştırma bölümü → `api/ai-workspace.js`'in `action=deep-research`
  dalı → `runDeepResearch(input, env)` (TASK-008, değiştirilmeden).
- Gelişmiş Agent bölümü → `action=agent` dalı → `runOrchestration({steps},
  env)` (TASK-007, değiştirilmeden).
- Ürün seçimi, YENİ bir ürün kataloğu İCAT ETMEDEN, dashboard'ın ZATEN var
  olan `products` listesini (`GET /api/content`, `loadProducts()`/
  `renderProductSelect()`) reuse eder.

**Kimlik doğrulama:** `api/ai-workspace.js`'in HER isteği, depodaki HER
diğer authenticated route (`api/reel-script.js`, `api/queue.js`, ...) İLE
AYNI mekanizmayı (`getSession(request)`, `src/auth.js`) kullanır —
oturumsuz bir istek her zaman `401 Unauthorized` ile HİÇBİR downstream
çağrı yapmadan reddedilir. Yeni bir auth yolu İCAT EDİLMEMİŞTİR.

**Onay (confirmation) davranışı:**
- Derin Araştırma: `runDeepResearch`'in KENDİ TEK üst-seviye
  `confirmed:true` kapısı (bkz. yukarıdaki TASK-008 bölümü) DEĞİŞMEDEN
  korunur. Dashboard'daki "Çalıştır" butonuna İLK tıklama SADECE bir
  onay özeti (mod, hedef, rakipler, ürün bağlamı) gösterir ve butonu
  "Onayla ve Çalıştır (ücretli)"a çevirir — hiçbir ağ isteği ATILMAZ.
  `confirmed:true` yalnız İKİNCİ tıklamada, sunucuya gönderilir; adaptör
  bunu KENDİLİĞİNDEN asla üretmez/varsaymaz.
- Gelişmiş Agent: her adımın `confirmed:true`'sunu kullanıcı JSON içinde
  KENDİSİ yazar — adaptör hiçbir adıma bunu eklemez/değiştirmez.
  Dashboard'daki "Agent'ı çalıştır" da AYNI iki-tıklamalı onay desenini
  izler (birinci tıklama sadece plan özetini gösterir).
- Her iki bölümde de bir provider/capability başarısız olursa (örn. key
  yapılandırılmamış) `runDeepResearch`/`runOrchestration`'ın KENDİ
  "sessiz fallback yok" davranışı DEĞİŞMEDEN yansır — workspace hiçbir
  koşulda başka bir provider'a KENDİLİĞİNDEN geçmez veya ücretli bir
  işlemi otomatik tekrar DENEMEZ.

**Forbidden mutation sınırı:** `api/ai-workspace.js`, `create_draft`/
`update_draft`/`update_status`/`publish_now`/`upload_media`/
`set_autopilot` veya herhangi bir silme/env/deployment fonksiyonunu HİÇ
import ETMEZ — bunlar bu dosyanın bağımlılık grafiğinde YOKTUR. Gelişmiş
Agent'a bu isimlerden biri bir adım olarak yazılırsa,
`runOrchestration`'ın KENDİ sabit allowlist'i (bkz. TASK-007 bölümü)
planın TAMAMINI (`status:"blocked"`), hiçbir adım çalışmadan reddeder —
adaptör bunun için AYRICA bir kontrol EKLEMEZ, TASK-007'nin KENDİ
korumasına güvenir.

**Dashboard UX:** Derin Araştırma sonuçları `findings`/`sources`/
`uncertainty`/`conflicts`/`providers_or_capabilities_used` alanlarının
HER biri için AYRI bir blok olarak render edilir (bulgular tek bir
anlatıya BİRLEŞTİRİLMEZ; belirsizlik ve çelişkiler kendi renkli
bloklarında, SESSİZCE çözülmeden gösterilir). Gelişmiş Agent sonuçları
run durumunu (`completed`/`failed`/`blocked`/`waiting_for_confirmation`)
bir rozet olarak, ve HER adımı (tamamlanan/duran/bekleyen) sırayla,
hatasını/nedenini GİZLEMEDEN gösterir. Her iki "Çalıştır" butonu da
gerçek istek sırasında (`disabled`) devre dışı bırakılır — kazara çift
gönderim önlenir.

**Bilinen sınırlamalar:** Gelişmiş Agent alanı ham bir JSON adım dizisi
kabul eder — sürükle-bırak bir adım oluşturucu bu sürümde YOKTUR (bkz.
manifest: "Advanced Agent area... rather than inventing a new
orchestrator" — bilinçli olarak minimal tutulmuştur). Bir run
`waiting_for_confirmation`da durduğunda dashboard onu otomatik
devam ettirmez (TASK-007'nin kendi sınırlaması) — kullanıcı `confirmed:true`
ekleyip aynı planı/formu yeniden göndermelidir.

## AI Reels V2 — dashboard sihirbazı (PR-D: Ürün→Senaryo→Sahne Onayı, PR-E: Sahne Videosu, PR-F/G: Ses & Müzik + Final Reel)

Dashboard'da (`dashboard-reels-v2.js` + `dashboard.html`, `data-tab="reels"`
altındaki "AI Reels V2" paneli) 7 adımlı bir sihirbaz: 1. Ürün, 2. Kreatif
Ayarlar, 3. AI Senaryo, 4. Sahne Onayı (PR-D — yukarıdaki
`generate_reel_script`/`validateReelScript`'i kullanır), **5. Video Üretimi
(PR-E)**, **6. Ses & Müzik (PR-F/G)**, **7. Final Reel (PR-F/G)** — tüm 7
adım aktif, pasif adım kalmadı.

**PR-E, YENİ bir Veo sistemi yazmaz** — PR-D'de zaten onaylanan
`reelScript.scenes[i].veoPrompt`'u (deterministik "sessiz" + gerektiğinde
Product Identity Lock kısıtları PR-D'de zaten eklenmiş) MEVCUT
`submitVeoVideo`/`veoVideoStatus` (`src/veo-video.js`) altyapısına bağlar:

- Her onaylı sahne (`approvedScenes[sceneId]===true`) AYRI AYRI, kendi Veo
  işi olarak üretilir — Reel'in tamamı tek bir Veo çağrısında ASLA
  birleştirilmez.
- **`api/reel-scene-video.js`** (yeni, tek yeni endpoint): sahne başına
  `submitVeoVideo`'yu çağırır. `confirmed:true` VE `approved:true` sunucu
  tarafında ZORUNLUDUR (dashboard'un mevcut iki-adımlı "tekrar bas" onay
  deseniyle aynı ruhta, ama `generate_video_clip` MCP tool'unun sunucu-taraflı
  `confirmed:true` sözleşmesiyle AYNI sıkılıkta — `api/reels.js`'in daha
  gevşek, yalnız client-side onay deseninin AKSİNE). `normalizeVeoPrompt()`
  (artık `reel-script-schema.js`'ten export edilir) savunma amaçlı tekrar
  uygulanır — idempotent olduğu için promptu bozmaz, yalnız kısıtların
  client tarafında bir şekilde eksik kalmamasını garanti eder.
- **Durum sorgulama için yeni bir endpoint EKLENMEDİ** — mevcut,
  DEĞİŞTİRİLMEMİŞ `api/veo-video.js` (job/operationName tabanlı, tamamlanınca
  Vercel Blob'a yükleyip herkese açık `videoUrl` üreten) olduğu gibi reuse
  edilir. Polling ASLA yeni bir iş başlatmaz.
- **Referans görsel**: her sahne için `productContext.productImageUrls`
  içinden kullanıcı seçim yapar (`sceneReferenceImages[sceneId]`, minimal
  thumbnail seçici) — hiçbir görsel otomatik/olası-yanlış seçilmez.
- **Sahne durumu**: `generatedSceneVideos[sceneId] = {status, jobId, model,
  provider, createdAt, videoUrl, error}`; UI durumu her zaman `idle |
  awaiting_confirmation | generating | completed | failed` kümesine
  normalize edilir.
- **Yeniden üretim**: tek bir sahneyi hedefler, YENİ bir onay ister, eski
  (varsa tamamlanmış) `videoUrl`'i yeni üretim BAŞARILI olana kadar bozmaz —
  diğer sahnelerin sonuçları etkilenmez.
- Veo hatasında (kota, HTTP hata) OTOMATİK başka bir provider/model'e ASLA
  geçilmez, otomatik ikinci deneme YAPILMAZ — hata gösterilir, yeni deneme
  yeni bir onay ister.
- Product-claim bloklama (PR-D'de kaldırılan `UNVERIFIED_PRODUCT_CLAIM`
  mekanizması) bu adımda da YOKTUR ve eklenmemiştir — Product Intelligence
  hâlâ yalnız bağlam/context'tir.

**PR-F/G, Adım 6 (Ses & Müzik) ve Adım 7 (Final Reel)'i aktif eder — YENİ
bir TTS/Lyria/FFmpeg sistemi yazılmadı.** Aşağıdaki "Türkçe seslendirme +
AI müzik" bölümündeki `generate_turkish_voiceover`/`generate_lyria_music`
(ve onların `/api/turkish-tts`/`/api/lyria-music` HTTP uçları — dashboard'un
ayrı, standalone "Türkçe Seslendirme ve AI Müzik" panelinin de kullandığı
AYNI uçlar) doğrudan çağrılır; o panele hiç dokunulmadı, sihirbazın kendi
izole Adım 6 UI'sı vardır.

- **Adım 6**: `reelScript.fullNarrationText` / `musicBrief.lyriaPrompt`
  varsayılan olarak doldurulur (yalnız YENİ bir senaryo üretildiğinde —
  sahne düzenleme/onaylarında ÜZERİNE YAZILMAZ, kullanıcı elle
  düzenleyebilir). TTS/Lyria üretimi ikisi de GERÇEK PARA HARCAR — Adım 5
  ile AYNI iki-adımlı "tekrar bas" onay deseni (ilk tıklama hiçbir API
  çağrısı yapmaz), sonuçlar `state.narration`/`state.music` içinde
  (`idle|awaiting_confirmation|generating|completed|failed`) ayrı ayrı
  tutulur. Hata durumunda otomatik başka bir provider/model'e ASLA geçilmez.
- **Adım 7 — eksik parça raporu**: mevcut `compose_reel_audio` (bkz. altta)
  yalnız TEK bir ZATEN VAR OLAN videoya ses mix'i yapıyor, **sahne
  birleştirme (concat) hiç desteklemiyor** — Adım 5, sahne başına AYRI bir
  Veo klibi ürettiği için bu eksikti. En küçük ek olarak:
  - **`src/lib/reel-scene-concat-ffmpeg.js`** (yeni, saf argv üretici):
    sahne videolarını `reelScript.scenes` SIRASINA göre, yalnız VİDEO
    akışını (`concat=...:a=0`) birleştirir — her Veo klibinin kendi ses
    kanalı olup olmadığını varsaymaya gerek kalmaz (Veo sahneleri zaten
    deterministik olarak "sessiz" kısıtıyla üretiliyor). Tek sahne varsa
    concat filtresi hiç çalıştırılmaz (`-c:v copy`).
  - **`src/reel-final-assembly.js`** (yeni, `compose_reel_audio`'nun AYNI
    workflow_dispatch + `video-jobs.js` Blob job-status mimarisi):
    `composeReelFinal({sceneVideoUrls[], voiceoverUrl?, musicUrl?})` —
    `getReelFinalStatus`, `getReelAudioStatus`'un KENDİSİDİR (yeniden
    yazılmadı, aynen export edildi — jobId/Blob tabanlı durum sorgusu
    zaten üreten workflow'dan bağımsız).
  - **`scripts/render-reel-final.mjs`** + **`.github/workflows/render-reel-final.yml`**:
    sahneleri indirir, concat eder, sonra AYNI, DEĞİŞTİRİLMEMİŞ
    `buildReelAudioFfmpegArgs` (`src/lib/reel-audio-ffmpeg.js`) ile
    seslendirme/müzik mix'inden geçirir — ses-mix FFmpeg mantığı burada
    TEKRAR YAZILMADI.
  - **`api/reel-final.js`** (yeni, `api/reel-audio.js` ile AYNI GET/POST
    deseni). FFmpeg concat+mix ÜCRETSİZDİR — `confirmed:true` İSTENMEZ
    (`compose_reel_audio` ile AYNI kural).
  - Final Reel yalnız **tüm sahnelerin videosu tamamlanmış VE en az bir ses
    kaynağı (seslendirme veya müzik) hazır** olduğunda tetiklenebilir — bu,
    FFmpeg katmanının (`buildReelAudioFfmpegArgs`) kendi zorunlu kıldığı
    "en az biri" kısıtından gelir, yeni icat edilmedi. Yeniden compose,
    Veo/TTS/Lyria'yı OTOMATİK TETİKLEMEZ; bir sahne/seslendirme/müzik yeniden
    üretilirse mevcut final video otomatik SİLİNMEZ, yalnız arayüzde
    "güncelliğini kaybetti" olarak işaretlenir — kullanıcı yeniden compose
    etmeyi kendi seçer.
- Bilinen mimari kısıt: mevcut job/durum sorgulama sisteminde (Veo/TTS/
  Lyria/final compose, hepsi) per-user job ownership yok — bu PR-F/G'nin
  yeni eklediği bir açık değil, PR-E'den devam eden, mevcut mimarinin
  bilinen bir sınırıdır.

## Türkçe seslendirme + AI müzik (generate_video_narration / generate_turkish_voiceover / generate_lyria_music / compose_reel_audio)

Veo/fal/Omni'nin kendi ürettiği video sesini KULLANMAZ — bunun yerine bağımsız,
kontrollü bir zincir: senaryo → Türkçe voice-over metni → gerçek Türkçe TTS
sesi → senaryoya uygun sözsüz müzik → FFmpeg ile mix. Mevcut Veo/Omni/FFmpeg
koduna dokunmaz, tamamen ek/bağımsız bir katmandır.

- **`generate_video_narration`**: ÜCRETSİZ (yalnızca metin üretimi, mevcut
  `generateContent` deseniyle). Video süresine göre Türkçe kelime hızı tahmini
  (`TURKISH_WORDS_PER_SECOND = 2.5`, ~150 kelime/dk — belgelenmiş bir Türkçe
  "kesin" oran yok, bu bir TAHMİN) kullanılarak hedef kelime sayısı promptta
  istenir; ayrıca senaryodan bir `musicBrief` türetilir.
- **`generate_turkish_voiceover`**: `gemini-3.1-flash-tts-preview` (Interactions
  API, `POST /v1beta/interactions`) ile GERÇEK Türkçe (`tr-TR`) ses üretir —
  Türkçe desteklenmiyorsa `TURKISH_TTS_UNAVAILABLE` hatası döner, **başka bir
  dile asla otomatik geçilmez**. Gerçek ses süresi WAV başlığından veya ham
  L16 PCM'den **ffmpeg olmadan, matematiksel olarak** ölçülür (Vercel
  serverless'ta ffmpeg yok). `targetDurationSeconds` verilirse ve gerçek süre
  bunu %15'ten fazla aşarsa **otomatik hızlandırma yapılmaz** —
  `VOICEOVER_TOO_LONG` hatası döner, metni AI ile kısaltıp tekrar denemek
  gerekir.
- **`generate_lyria_music`**: `lyria-3-clip-preview` (varsayılan, ~30sn) veya
  `lyria-3-pro-preview` (~3dk'ya kadar) ile sözsüz müzik üretir. Kullanıcıdan
  ayrıca bir müzik promptu İSTEMEZ — `musicPrompt` verilmezse `scenario` +
  `musicBrief`'ten otomatik türetilir; "Instrumental only. No vocals." her
  zaman metne eklenir (response_format'taki `instrumental` alanı yoksayılsa
  bile).
- **`compose_reel_audio`**: ÜCRETSİZDİR (yalnızca FFmpeg) — `confirmed`
  gerektirmez. Video + [seslendirme] + [müzik] birleşimini
  `render-product-video.yml` ile AYNI mimariyle (Vercel süre/bellek sınırları
  riskli olduğu için GitHub Actions kuyruğu + `video-jobs.js` üzerinden Vercel
  Blob'da durum) yapar — ayrı bir mekanizma icat edilmedi. Seslendirme ana ses
  (0dB); müzik varsayılan ~-16dB altına alınır ve seslendirme çalarken
  `sidechaincompress` ile otomatik kısılır ("ducking"); çıkışta `alimiter` ile
  clipping önlenir. Video akışı **yeniden kodlanmaz** (`-c:v copy`) — yalnızca
  ses işlenir.
- **Veo/fal prompt varsayılanı değişti**: artık varsayılan olarak
  `buildVideoPromptSections`'a "Sessiz video: konuşma, anlatım, arka plan
  müziği veya otomatik altyazı ekleme" kısıtı ekleniyor (Veo'nun kendi sesi bu
  yeni ses zinciriyle çakışırdı) — `allowNativeAudio:true` ile kaldırılabilir
  (dashboard'da "Video promptunu önizle" düğmesinin yanındaki onay kutusu).
  Serbest metin promptu (`freePrompt`) bu şablonu hiç kullanmadığı için
  etkilenmez.
- **Test kapsamı dışı bırakılan tek şey**: gerçek `BLOB_READ_WRITE_TOKEN` +
  `@vercel/blob` `put()` akışı — bu depoda o modülü mock'layan bir test
  altyapısı yok, gerçek bir ağ isteği tetiklemek "gerçek çağrı yapılmaz"
  ilkesini ihlal ederdi.

**Bilinen doğrulama sınırları** (Omni'deki aynı ağ politikası kısıtı nedeniyle
`ai.google.dev`'e doğrudan erişim yok, arama sonuçlarıyla çapraz doğrulandı):
model kimlikleri (`gemini-3.1-flash-tts-preview`, `lyria-3-clip-preview`,
`lyria-3-pro-preview`) doküman sayfa URL'lerinden alındığı için yüksek
güvenilirlikte; ancak TTS/Lyria `response_format` içindeki tam alan adları
(`voice_name`, `language_code`, `instrumental`, `duration_seconds`) ve çıktı
dosyasının Omni'deki gibi Files API ACTIVE beklemesi gerekip gerekmediği
**doğrulanmadı** — gerçek ücretli ilk denemeden önce teyit edilmesi önerilir.

## YouTube Shorts — OAuth bağlantısı (youtube-auth / youtube-callback / youtube-status)

YouTube Data API v3'e (`videos.insert`) statik bir anahtar yeterli değil —
marka kanalı adına yükleme yapabilmek için OAuth 2.0 3-legged akışı
(kalıcı bir **refresh token**) gerekir. Bu akış üç uç noktaya bölünmüştür:

| Uç nokta | Rolü |
| --- | --- |
| `GET /api/youtube-auth` | **Başlangıç.** Panelde oturum açmış bir tarayıcıdan (dashboard'daki "Platform bağlantıları" panelindeki "Bağlan / Yeniden bağlan" linki) ziyaret edilir; hiçbir sır göndermeden, kullanıcıyı Google'ın yetkilendirme sayfasına 302 ile yönlendirir. `client_secret` bu URL'de ASLA görünmez. |
| `GET /api/youtube-callback` | **Dönüş.** Google'ın kendisi buraya `?code=...` ile yönlendirir (oturum gerekmez — bu istek Google'dan gelir, dashboard'dan değil). Tek seferlik kodu kalıcı bir `refresh_token` ile değiştirip ekranda **bir kez** gösterir. |
| `GET /api/youtube-status` | Dashboard'un canlı durum göstergesi (oturum gerektirir). `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN` tanımlı mı VE refresh token gerçekten hâlâ geçerli mi (Google'a ücretsiz bir token yenileme çağrısıyla) kontrol eder. |

**Yetkilendirme URL'i şunları içerir** (`api/youtube-auth.js`):
- `access_type=offline` — yalnızca `access_token` değil, kalıcı bir `refresh_token` de döner (uygulama tarayıcı kapalıyken de, ör. cron ile, video yükleyebilsin diye zorunlu).
- `prompt=consent` — Google, aynı istemciye DAHA ÖNCE izin verilmişse normalde ikinci yetkilendirmede `refresh_token` DÖNDÜRMEZ; bu parametre onay ekranını her seferinde yeniden gösterip yeni bir `refresh_token` almayı garanti eder — **süresi dolmuş/iptal edilmiş bir token'ı yenilemenin tek yolu budur**.
- `scope=https://www.googleapis.com/auth/youtube.upload`
- `redirect_uri=https://buzsu-social-publisher.vercel.app/api/youtube-callback` — Google Cloud Console'da bu OAuth Client için kayıtlı olan URI ile **birebir** aynı olmalı (aksi halde `redirect_uri_mismatch`); `api/youtube-auth.js` ve `api/youtube-callback.js`'te aynı sabit değer kullanılır.

**Güvenli saklama:** bu uygulamanın kalıcı bir sır deposu yok (bilinçli
tasarım) — `refresh_token` hiçbir veritabanına/dosyaya yazılmaz, yalnızca
`/api/youtube-callback`'in tek seferlik yanıtında gösterilir. Tek doğru
saklama yeri **Vercel Production ortam değişkenleridir**
(`YOUTUBE_REFRESH_TOKEN`) — sayfa kapatıldıktan sonra bir daha gösterilmez,
kaybedilirse `/api/youtube-auth` ile akış baştan tekrarlanır.

**"YouTube token yenilenemedi: Token has been expired or revoked" hatası**
kodda bir kusur değil, Google'ın `invalid_grant` cevabıdır — kayıtlı
`YOUTUBE_REFRESH_TOKEN` artık geçersizdir. En sık neden: Google Cloud
Console'daki OAuth consent screen hâlâ **"Testing"** durumundaysa, verilen
refresh token'lar **7 gün sonra otomatik geçersiz olur**. Kalıcı kullanım
için consent screen'i **"In production"**a almak gerekir; aksi halde
`/api/youtube-auth` ile periyodik olarak yeniden bağlanmak gerekir.
Dashboard'daki YouTube Shorts satırı artık bunu proaktif olarak gösterir
(`/api/youtube-status` üzerinden) — sabit "Bağlı değil" metni değil, gerçek
`configured`/`connected` durumu.

`src/youtube-publish.js`'teki gerçek yükleme mantığı (`uploadShort`,
resumable upload) bu değişiklikle **değişmedi** — yalnızca `getAccessToken`/
`assertYouTubeConfigured` dışa açıldı (`/api/youtube-status`'ün aynı OAuth
çağrısını tekrar yazmadan yeniden kullanabilmesi için).

## Meta Reklamlar — PR-4 (destructive/creative yönetimi: reklam silme + kreatif oluştur/bağla)

> Not: Meta Reklamlar modülünün PR-1/2/3'ü (salt-okunur reklam listesi, Genel
> Bakış, reklam durumu/reklam seti bütçesi write'ları) henüz README'de belgeli
> değildi — bu bölüm yalnızca PR-4'ün eklediklerini kapsıyor; geriye dönük
> PR-1/2/3 dokümantasyonu bu PR'ın kapsamı dışında bırakıldı.

Mimari (PR-1'den değişmedi): `Browser → /api/meta-ads/* → src/lib/meta-connect.js → Buzsu Meta Ads MCP → Meta Graph API`. Tarayıcı hiçbir zaman MCP'ye veya Meta Graph API'ye doğrudan konuşmaz.

**Reklam silme** — `POST /api/meta-ads/ad-delete`, body `{ad_id, confirm:true}`.
Admin-only, kalıcı ve geri alınamaz. Asıl güvenlik sınırı `ads_delete_ad`
MCP tool'unun kendisidir: ad_id'nin durumunu ÖNCE kendi okur, yalnızca
PAUSED ise siler (ACTIVE reddedilir, effective_status'a bakılmaz — sadece
kampanya/reklam seti duraklatılmış görünen bir reklam yine reddedilir);
DELETED/ARCHIVED için idempotent başarı döner. Dashboard'daki "yalnız PAUSED
ise buton görünür" kontrolü SADECE UX katmanıdır. Meta genelde hard-delete
yerine arşivliyor — sonuç `deletion_semantics` (`hard_delete`/`archived`/
`still_present`/`unconfirmed`) ve `deleted` (bilinmiyorsa `null`, uydurulmaz)
alanlarıyla döner.

**Kreatif oluştur ve reklama bağla** — `POST /api/meta-ads/ad-creative-update`,
body `{ad_id, name, message, headline, description?, link, call_to_action_type, image_hash, confirm:true}`.
Admin-only. Sunucu (`createAndBindAdCreative`) üç adımı sırayla yapar: (1)
reklamın MEVCUT `creative_id`'sini okur (rollback bilgisi), (2)
`ads_create_ad_creative` ile yeni, tekil-görsel bir link creative oluşturur
(bu adım hiçbir reklamı etkilemez/harcama başlatmaz), (3) `ads_update_ad` ile
yeni creative'i reklama bağlar. **`image_hash` zorunludur, `image_url` bu
route'ta hiç kabul edilmez** — ilk sürüm yalnızca reklamın zaten sahip olduğu
bir görseli (`ads_get_ad_creative_assets`'ten gelen `cards[].image_hash`)
yeniden kullanır; Meta'nın geçici CDN `image_url`'i asla yeni bir creative'e
girdi olarak geri verilmez. (2) başarılı ama (3) (bağlama) başarısız olursa,
oluşturulan (bağlanmamış, zararsız) `creative_id` `error.new_creative_id`
alanında kaybolmadan döner. Yeni görsel yükleme (`upload_ad_image`) ve
carousel/WhatsApp creative araçları bu ilk sürümün kapsamı dışında.

Her iki route da PR-3'teki (`ad-status`/`adset-budget`) İLE BİREBİR AYNI
güvenlik sözleşmesini izler: session yoksa 401, Admin değilse 403, istemci
yalnızca `confirm:true` gönderir (Social Publisher'ın kendi HTTP niyet
sinyali) — `confirmed` alanı istemciden HİÇ okunmaz; MCP'ye gönderilen
`confirmed:true` her zaman sunucuda (`src/lib/meta-connect.js`) sabitlenir.
Hatalar her zaman `{ok:false, error:{code, message}}` şekline normalize
edilir, `META_CONNECT_MCP_PATH_SECRET` hiçbir hata mesajında ham görünmez.

**Test kapsamı doğrulanamayan bir şey:** bu PR gerçek bir Meta hesabına karşı
canlı bir silme veya kreatif-oluşturma denemesi YAPMADI — tüm testler MCP
JSON-RPC katmanı mock'lanarak (`node --test`) doğrulandı. Gerçek bir deneme
yapılacaksa yalnızca geçici, PAUSED bir yardımcı reklamla yapılmalı; ACTIVE
veya gerçek üretim reklamı üzerinde delete testi YAPILMAMALI.

**Playwright ile ilgili not:** bu depoda Playwright (veya jsdom gibi bir DOM
kütüphanesi) hiç kurulu değil — `dashboard-meta-ads.js` PR-1'den beri gerçek
bir tarayıcıda/DOM'da hiç çalıştırılmadan, kaynak metnine karşı regex
assertion'larıyla test ediliyor (bkz. `test/dashboard-meta-ads.test.js`).
PR-4 Admin/Editor UI ayrımını ve "Editor'da write butonu yok" gereksinimini
AYNI teknikle doğruladı; kapsamı büyütmemek için yeni bir Playwright
bağımlılığı EKLENMEDİ. Gerçek bir tarayıcıyla uçtan uca doğrulama istenirse
bu ayrı bir görev olmalı.

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

