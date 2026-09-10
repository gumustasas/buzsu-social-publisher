import { createContentVariant, DEFAULT_HASHTAGS } from "./content-variants.js";
import { baseProductTitle } from "./lib/product-title.js";

// src/lib/scenario-schema.js (AI senaryo/sahne akışı) da bu listeyi kullanır —
// kanıtsız iddia politikası tek bir yerde tanımlı kalsın diye export edildi.
export const riskyClaims = [/en iyi/gi, /kesinlikle sağlıklı/gi, /tedavi/gi, /hastalığı/gi, /garanti eder/gi, /%100/gi];

const CAROUSEL_MEDIA_TYPES = new Set(["image", "video"]);
const CAROUSEL_MIN_ITEMS = 2;
const CAROUSEL_MAX_ITEMS = 10; // Instagram carousel sınırı (görsel+video karışık, resmi API limiti)

// mediaItems: [{type:"image"|"video", url:https}, ...]. create_draft (api/mcp.js)
// üzerinden gelir, doğrudan Vercel Blob'a dokunmaz — bu fonksiyon yalnızca
// Airtable'a yazılacak taslağın GEÇERLİ olup olmadığını kontrol eder.
function validateMediaItems(mediaItems) {
  if (!Array.isArray(mediaItems) || mediaItems.length < CAROUSEL_MIN_ITEMS) return `Carousel için en az ${CAROUSEL_MIN_ITEMS} medya öğesi (mediaItems) gerekli.`;
  if (mediaItems.length > CAROUSEL_MAX_ITEMS) return `Carousel en fazla ${CAROUSEL_MAX_ITEMS} medya öğesi kabul eder (Instagram sınırı).`;
  const invalid = mediaItems.some((item) => !item || !CAROUSEL_MEDIA_TYPES.has(item.type) || !isHttps(item.url));
  if (invalid) return "mediaItems içindeki her öğe {type:'image'|'video', url:<herkese açık HTTPS>} biçiminde olmalı.";
  return null;
}

export function buildDraft(product, { format = "Gönderi", platforms = ["Instagram", "Facebook"], variant = 0, publishAt, captionOverride, allowCatalogCaption = false } = {}) {
  const url = String(product.url || "").trim();
  // allowCatalogCaption SADECE create_draft (api/mcp.js) tarafından açılır —
  // panel composer'ı (api/content.js) bunu hiç göndermez, bu yüzden oradaki
  // "Metin seçeneği 1/2/3" (variant) seçici her zaman createContentVariant'ın
  // 3 şablonunu döndürmeye devam eder. product.instagramText/facebookText
  // burada YALNIZCA gerçekten onaylanmış/yayınlanmış bir kayıttan geliyorsa
  // dolu olur (bkz. src/lib/products.js REUSABLE_CAPTION_STATUSES) — bir
  // "Taslak"/"Hata" kaydının incelenmemiş metni asla buraya taşınmaz.
  const catalogCaption = !captionOverride && allowCatalogCaption && (product.instagramText || product.facebookText)
    ? { instagramText: product.instagramText || product.facebookText, facebookText: product.facebookText || product.instagramText }
    : null;

  let content;
  if (captionOverride) {
    content = {
      title: baseProductTitle(product.title) || "Buzsu ürünü",
      sourceUrl: url,
      instagramText: `${captionOverride.instagramText}\n\nDetaylar: ${url}`,
      facebookText: `${captionOverride.facebookText}\n\nÜrünü inceleyin: ${url}`,
      hashtags: captionOverride.hashtags || "#Buzsu",
      format,
      platform: platforms
    };
  } else if (catalogCaption) {
    // Bu metin zaten ÖNCEKİ bir buildDraft/createDraftRecord çıktısı — kendi
    // "Detaylar: <url>"/"Ürünü inceleyin: <url>" bağlantısını ZATEN içeriyor
    // (bkz. src/lib/products.js). Üstüne tekrar bir link eklemek aynı linki
    // iki kez yazdırırdı — bu yüzden burada OLDUĞU GİBİ kullanılıyor.
    content = {
      title: baseProductTitle(product.title) || "Buzsu ürünü",
      sourceUrl: url,
      instagramText: catalogCaption.instagramText,
      facebookText: catalogCaption.facebookText,
      hashtags: DEFAULT_HASHTAGS,
      format,
      platform: platforms
    };
  } else {
    content = createContentVariant({ ...product, format, platform: platforms }, variant);
  }
  const allText = `${content.instagramText}\n${content.facebookText}`;
  const warnings = [];
  if (!product.url || !isHttps(product.url)) warnings.push("Kaynak URL herkese açık HTTPS olmalı.");
  // Carousel'de tekil "Görsel URL" yerine mediaItems dizisi kullanılır —
  // aşağıdaki ayrı kontrol bunu doğrular, bu yüzden burada atlanır.
  if (format !== "Carousel" && (!product.imageUrl || !isHttps(product.imageUrl))) warnings.push("Görsel URL herkese açık HTTPS olmalı.");
  if (format === "Reel" && (!product.videoUrl || !isHttps(product.videoUrl))) warnings.push("Reel için herkese açık HTTPS video URL'i gerekli.");
  if (format === "Carousel") {
    const mediaError = validateMediaItems(product.mediaItems);
    if (mediaError) warnings.push(mediaError);
    // Facebook'un resmi Graph API'si tek bir gönderide görsel+video karışımını
    // güvenilir desteklemiyor (attached_media video ID'lerinde izin hatası
    // veriyor) — bu yüzden burada draft oluşturma anında engelleniyor, 2 saat
    // sonra cron'da sessizce "Hata" durumuna düşmesi yerine.
    else if (platforms.includes("Facebook") && product.mediaItems.some((item) => item.type === "video")) {
      warnings.push("UNSUPPORTED_FACEBOOK_MEDIA_COMBINATION: Facebook karma (görsel+video) carousel gönderisini desteklemiyor. Görselleri Facebook'ta çoklu-fotoğraf gönderisi, videoyu ayrı bir Reel taslağı olarak paylaşın.");
    }
  }
  if (!platforms.length) warnings.push("En az bir platform seçilmeli.");
  if (riskyClaims.some((pattern) => pattern.test(allText))) warnings.push("Kanıtsız sağlık veya üstünlük iddiası bulundu.");
  if (format === "Hikâye" && platforms.includes("Instagram")) warnings.push("Instagram hikâyesinde ürün bağlantı etiketi API tarafından otomatik eklenmez.");
  if (platforms.includes("YouTube") && format !== "Reel") warnings.push("YouTube Shorts için Reel (video) formatı gerekli.");
  return { ...content, title: `${content.title} | ${format}`, publishAt, warnings, valid: warnings.filter((warning) => !warning.startsWith("Instagram hikâyesi")).length === 0 };
}

function isHttps(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
