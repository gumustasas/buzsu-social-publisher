// buzsu.com.tr'nin Google Merchant/Shopping ürün feed'inden (RSS 2.0 + "g:"
// ad alanı — standart Google ürün feed şeması: https://support.google.com/merchants/answer/7052112)
// ürün adı + link + görsel galerisi çıkarır. llms-full.txt kataloğunun
// aksine bu feed genelde ürün başına birden fazla gerçek görsel içerir (ana
// görsel + ek görseller) — bu yüzden product-catalog.js'teki birleştirilmiş
// katalogda öncelikli görsel kaynağı burasıdır (bkz. product-catalog.js
// fetchCatalog()). Fiyat/stok/marka gibi alanlar bilinçli olarak
// çıkarılmıyor — bu aşamada yalnızca ürün seçimi ve AI görsel referansı
// hedefleniyor, fiyat gösterimi ayrı ve dikkatli bir karar (feed'deki
// fiyatın güncelliği garanti değil).
//
// Bu modül Airtable'a hiçbir şey yazmaz, yalnızca okur; ağ/format hatasında
// sessizce boş liste döner — llms-full.txt kataloğu ve Airtable kayıtları
// etkilenmeden ürün listesi eksiksiz görünmeye devam eder (bkz.
// product-catalog.js'teki listCatalogProducts()).
import { resolveProductUrl } from "./buzsu-url.js";

export const FEED_URL = "https://www.buzsu.com.tr/feed.xml";
// llms-full.txt'in 30 dakikalık önbelleğinden kasıtlı olarak daha uzun: feed
// çok daha büyük (~300KB, ~200 ürün) ve ürün görselleri gün içinde sık
// değişmiyor; gereksiz yere sık çekmenin bir faydası yok.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cached = null; // { catalog, fetchedAt }

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// Google ürün feed alanları genelde "g:" ad alanıyla yazılır ama bazı feed
// üreteçleri ad alanını atlar — ikisini de kabul ediyoruz, bilinmeyen bir
// üretici davranışına karşı kırılgan olmamak için.
function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<(?:g:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:g:)?${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1]) : "";
}

function extractAllTags(block, tagName) {
  const pattern = new RegExp(`<(?:g:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:g:)?${tagName}>`, "gi");
  const results = [];
  let match;
  while ((match = pattern.exec(block))) results.push(decodeXmlEntities(match[1]));
  return results;
}

function stripMarkup(value) {
  return decodeXmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Saf, ağdan bağımsız ayrıştırıcı — test edilebilir olması için ayrı
// tutuldu. Görseli olmayan bir <item> bu kataloğun amacına hizmet etmediği
// için (asıl değeri gerçek görsel galerisi sağlaması) atlanır; o ürün
// llms-full.txt yedeğinden (varsa) veya panelde elle görsel girişinden
// gelmeye devam eder.
export function extractFeedCatalog(xml) {
  const catalog = [];
  const seen = new Set();
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(String(xml || "")))) {
    const block = itemMatch[1];
    const title = extractTag(block, "title");
    const url = resolveProductUrl(extractTag(block, "link"));
    if (!title || !url || seen.has(url)) continue;
    const imageLink = extractTag(block, "image_link");
    const additionalImages = extractAllTags(block, "additional_image_link").filter((value) => /^https:\/\//i.test(value));
    const mainImage = /^https:\/\//i.test(imageLink) ? imageLink : additionalImages[0];
    if (!mainImage) continue;
    seen.add(url);
    catalog.push({
      feedId: extractTag(block, "id") || null,
      title,
      url,
      description: stripMarkup(extractTag(block, "description")),
      productType: stripMarkup(extractTag(block, "product_type")),
      googleProductCategory: stripMarkup(extractTag(block, "google_product_category")),
      brand: stripMarkup(extractTag(block, "brand")),
      imageUrl: mainImage,
      imageUrls: [mainImage, ...additionalImages.filter((value) => value !== mainImage)]
    });
  }
  return catalog;
}

async function fetchFeed() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.catalog;
  const response = await fetch(FEED_URL);
  if (!response.ok) throw new Error(`feed.xml alınamadı: HTTP ${response.status}`);
  const xml = await response.text();
  const catalog = extractFeedCatalog(xml);
  cached = { catalog, fetchedAt: Date.now() };
  return catalog;
}

// Ağ hatasında boş liste döner — çağıran taraf (product-catalog.js) bunu
// llms-full.txt kataloğuyla birleştirir; bu kaynağın çökmesi diğerini hiç
// etkilemez.
export async function listFeedProducts() {
  try {
    return await fetchFeed();
  } catch {
    return [];
  }
}

// Product Intelligence yalnız canonical URL'nin birebir eşleşmesini kabul
// eder. Başlık substring/fuzzy eşleştirmesi burada özellikle yoktur.
export async function findFeedProductByCanonicalUrl(canonicalUrl, { listFeedProductsImpl = listFeedProducts } = {}) {
  const target = resolveProductUrl(canonicalUrl);
  if (!target) return null;
  const products = await listFeedProductsImpl();
  return products.find((product) => resolveProductUrl(product.url) === target) || null;
}
