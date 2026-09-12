import { baseProductTitle } from "./lib/product-title.js";

const blockedClaims = [/hastalığı/gi, /tedavi/gi];

// Ürünün gerçek Airtable "Hashtagler" alanına erişimimiz olmadığı (listProducts
// bu alanı döndürmüyor) her jenerik/otomatik taslak yolunda kullanılan tek
// varsayılan hashtag seti — src/content-worker.js'teki katalog-metni yolu da
// bunu paylaşır.
export const DEFAULT_HASHTAGS = "#Buzsu #SuArıtma #SuArıtmaCihazı";

function cleanClaim(text) {
  return blockedClaims.reduce((value, pattern) => value.replace(pattern, ""), text).replace(/\s{2,}/g, " ").trim();
}

function productKey(product) {
  return String(product.title || "ürün").toLocaleLowerCase("tr-TR");
}

export function createContentVariant(product, variant = 0) {
  const title = baseProductTitle(product.title) || "Buzsu ürünü";
  const url = String(product.url || "").trim();
  const key = productKey(product);
  const templates = key.includes("ultramag")
    ? ["Şebeke girişinde kireç oluşumunu azaltmaya yardımcı UltraMag Manyetik Kireç Önleyici.", "Apartman ve ev girişleri için pratik kireç önleme çözümünü inceleyin.", "UltraMag ile su tesisatınızı daha yakından tanıyın."]
    : key.includes("watercare")
      ? ["Watercare atıksız su arıtma cihazı ile su kullanımını daha verimli değerlendirin.", "Atıksız su arıtma çözümünü eviniz ve iş yeriniz için inceleyin.", "Watercare ürün özelliklerini ve kullanım detaylarını keşfedin."]
      : key.includes("code")
        ? ["Code kapalı kasa su arıtma cihazı, filtre yapısı ve servis desteğiyle ev ve iş yerleri için tasarlanmıştır.", "Code su arıtma cihazının filtre yapısını ve seçeneklerini inceleyin.", "Günlük kullanım için Code modelinin teknik özelliklerine göz atın."]
        : ["Buzsu ürününü özellikleri, kullanım alanı ve teknik detaylarıyla inceleyin.", "İhtiyacınıza uygun su arıtma çözümünü Buzsu'da keşfedin.", "Ürün detayları ve güncel bilgiler için Buzsu sayfasını ziyaret edin."];
  const text = cleanClaim(templates[Math.abs(Number(variant)) % templates.length]);
  const hashtags = DEFAULT_HASHTAGS;
  return {
    title,
    sourceUrl: url,
    instagramText: `${text}\n\nDetaylar: ${url}`,
    facebookText: `${text}\n\nÜrünü inceleyin: ${url}`,
    hashtags,
    format: product.format || "Gönderi",
    platform: product.platform || ["Instagram", "Facebook"]
  };
}

export function createApprovedRecordFields(product, variant = 0) {
  const content = createContentVariant(product, variant);
  return {
    Başlık: content.title,
    "Kaynak URL": content.sourceUrl,
    "Görsel URL": product.imageUrl || "",
    "Instagram Metni": content.instagramText,
    "Facebook Metni": content.facebookText,
    Hashtagler: content.hashtags,
    Platform: content.platform,
    "Yayın Biçimi": content.format,
    "Yayın Zamanı": product.publishAt,
    Durum: "Onaylandı",
    "Deneme Sayısı": 0,
    "Hata Mesajı": ""
  };
}
