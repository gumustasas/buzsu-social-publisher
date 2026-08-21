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

- Ürünün kendisi (şekli, logosu, musluğu, etiketi) prompt'a güvenilerek değil,
  **piksel maskesiyle** korunur: `src/scene-image.js` beyaz/açık renkli arka planı
  kenarlardan taşma (flood fill) ile tespit edip yalnızca o bölgeyi OpenAI
  `images.edit` uç noktasına "değiştirilebilir" olarak işaretler. Ürün alanı API'ye
  hiç gönderilmeden aynen korunur.
- `OPENAI_API_KEY` (ve isteğe bağlı `OPENAI_SCENE_MODEL`, varsayılan `gpt-image-1`)
  Vercel Production'da tanımlı olmalı; tanımlı değilse panel bunu bildirir.
- Üretilen görsel şu an yalnızca önizleme amaçlıdır (tarayıcıda gösterilir),
  Airtable kaydına veya yayın kuyruğuna otomatik eklenmez. Kuyruğa/etikete bağlama
  ve çoklu format (gönderi/hikâye) türetme sonraki aşamadadır.
- "Musluğu cihazın yanından kaldır" seçeneği **varsayılan olarak kapalı** —
  cihaz musluğuyla birlikte, olduğu gibi korunur. İşaretlenirse musluk bölgesi
  de maskeye eklenir (`FAUCET_REMOVE_BOX`, `src/scene-image.js`); bu kutu
  `assets/code-product.png` üzerinde elle ölçüldü ve musluk cihaz gövdesine
  değecek kadar yakın olduğundan gövdenin gerçek kenarından dar bir şerit de
  yeniden üretilecek alana giriyor (kenar çentiği riski). Bu yüzden deneysel
  işaretlenmiştir; onaylanmadan yayında kullanılmamalıdır.

## Sonraki adım

Dry-run doğru çalıştıktan sonra Meta API için ayrı gönderim scripti eklenir. O aşamada da önce test modu, sonra tek kayıtla kontrollü canlı paylaşım yapılmalıdır.

## Otomatik çalışma

GitHub Actions manuel doğrulama için kullanılabilir. Canlı otomatik çalışma, Windows Görev Zamanlayıcı üzerinden `run-publisher.ps1` ile 5 dakikada bir yapılır. Her çalışmada yalnızca `Onaylandı` durumundaki, yeni `Yayın Zamanı` alanı dolu ve zamanı gelmiş en eski tek kayıt yayınlanır.

Vercel Pro kurulumu için proje kökü bu reponun kökü (Root Directory boş bırakılır), Build Command boş, Install Command `npm ci`, Output Directory boş ve Cron Secret `CRON_SECRET` olarak ayarlanır. Vercel Cron `/api/publish` adresini `Authorization: Bearer CRON_SECRET` ile çağırır.
