import { createHash } from "node:crypto";
import { resolveProductUrl, slugFromUrl } from "./buzsu-url.js";
import { listProducts } from "./products.js";
import { catalogProductId } from "./product-catalog.js";
import { FEED_URL, findFeedProductByCanonicalUrl, listFeedProducts } from "./feed-catalog.js";
import { classifyInstallationContext, INSTALLATION_CONTEXT_LABELS } from "./product-installation-context.js";
import { classifyProhibitedClaims } from "./product-claims.js";
import { readProductContextCache, writeProductContextCache } from "./product-context-cache.js";

// get_buzsu_product_context (bkz. api/mcp.js): AI video senaryosu yazmadan
// önce GERÇEK Buzsu ürün bilgisini toplar/normalize eder. Tamamen
// ÜCRETSİZ/deterministiktir — hiçbir AI/paid API çağrısı yapmaz. Ana
// kaynak zaten var olan modüllerdir (buzsu-url.js/product-context.js/
// products.js/product-catalog.js/product-installation-context.js); bu
// dosya onları BİRLEŞTİRİR, yeni bir fetch/ağ mimarisi icat etmez.
//
// KRİTİK TASARIM KARARI: verifiedFacts, exact XML feed kaydından ve yalnız
// seçilen canonical ürün sayfasından AI TARAFINDAN YENİDEN
// YAZILMADAN, birebir cümle alıntısı olarak çıkarılır. Bu, "AI ürün
// özelliği uydurmasın" kuralını üretim (generation) değil ALINTI
// (extraction) yaparak mimari olarak garanti eder.

const CACHE_TTL_MS = 30 * 60 * 1000; // product-catalog.js'teki katalog önbelleğiyle aynı varsayım
const MAX_REDIRECTS = 5;
const MIN_SENTENCE_LENGTH = 8;
const MAX_DESCRIPTION_LENGTH = 400;

// technicalFeatures/sellingPoints/useCases/targetAudience alanları, AYNI
// birebir cümlelerin (verifiedFacts'teki) anahtar kelimeye göre
// SINIFLANDIRILMASIYLA doldurulur — yeni metin üretilmez, yalnızca mevcut
// alıntılar kovaya ayrılır. Deterministik bir sezgiseldir (heuristic);
// eşleşmeyen cümleler yalnızca verifiedFacts'te (genel havuzda) kalır.
const CATEGORY_KEYWORDS = {
  technicalFeatures: [/\bkademe/i, /\blitre/i, /\blt\/(gün|saat)/i, /\bwatt\b/i, /\binç/i, /\bmikron/i, /\bmembran/i, /\bkapasite/i, /\bfiltre/i, /\bvolt/i, /\bbar\b/i],
  sellingPoints: [/kolay/i, /hızlı/i, /dayanıklı/i, /uzun ömür/i, /pratik/i, /ekonomik/i, /tasarruf/i, /şık/i, /kompakt/i, /sessiz/i],
  useCases: [/için (ideal|uygun)/i, /kullanılır/i, /kullanılabilir/i, /yerlerde/i, /ortamlarda/i, /monte edilir/i],
  targetAudience: [/aile/i, /\bofis/i, /işletme/i, /\bev(e|in|de)?\b/i, /restoran/i, /\botel/i, /villa/i]
};

function titleFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toLocaleUpperCase("tr-TR") + word.slice(1))
    .join(" ");
}

function sha256(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function truncate(text, maxLength) {
  const value = String(text || "").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}…` : value;
}

// Kaba ama yeterli bir Türkçe cümle bölücü — amaç mükemmel dilbilimsel
// ayrıştırma değil, kısa (llms-full.txt penceresi ~1400 karakter) bir
// metni birebir alıntılanabilir parçalara ayırmak.
function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH);
}

function classifySentences(sentences, sourceUrl) {
  const buckets = { technicalFeatures: [], sellingPoints: [], useCases: [], targetAudience: [] };
  for (const sentence of sentences) {
    for (const [bucket, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
      if (patterns.some((pattern) => pattern.test(sentence))) buckets[bucket].push({ fact: sentence, sourceUrl });
    }
  }
  return buckets;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripMarkup(value) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaDescription(html) {
  const match =
    String(html || "").match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    String(html || "").match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

function jsonLdObjects(value) {
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (!value || typeof value !== "object") return [];
  const nested = Object.values(value).flatMap(jsonLdObjects);
  return [value, ...nested];
}

function extractExactProductJsonLd(html, canonicalUrl) {
  const scripts = String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1].trim());
      for (const item of jsonLdObjects(parsed)) {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (!types.some((type) => String(type).toLowerCase() === "product")) continue;
        const urls = [item.url, item["@id"]].flat().filter(Boolean);
        if (!urls.some((url) => {
          try {
            return resolveProductUrl(new URL(String(url), canonicalUrl).toString()) === canonicalUrl;
          } catch {
            return false;
          }
        })) continue;
        return {
          name: stripMarkup(item.name),
          description: stripMarkup(item.description),
          category: stripMarkup(item.category),
          imageUrls: [item.image].flat().filter((url) => /^https:\/\//i.test(String(url)))
        };
      }
    } catch {
      // Bozuk JSON-LD diğer güvenilir sayfa alanlarının kullanılmasını
      // engellemez.
    }
  }
  return null;
}

// Ürün sayfasının kendisinden yalnız meta description ve canonical URL'si
// seçilen ürünle birebir eşleşen Product JSON-LD kaydını çeker. Her
// yönlendirme adımı resolveProductUrl'den GEÇMEDEN takip edilmez; hedef
// buzsu.com.tr dışına çıkarsa (yönlendirme zinciri ele geçirilmiş/bozuk
// olsa bile) hemen hata verir.
async function fetchCanonicalProductPage(canonicalUrl, { fetchImpl }) {
  let currentUrl = canonicalUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(currentUrl, { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("Yönlendirme hedefi eksik.");
      const nextUrl = new URL(location, currentUrl).toString();
      const revalidated = resolveProductUrl(nextUrl);
      if (!revalidated) throw new Error("Yönlendirme hedefi izin verilen buzsu.com.tr dışına çıktı.");
      currentUrl = revalidated;
      continue;
    }
    if (!response.ok) throw new Error(`Ürün sayfası alınamadı (HTTP ${response.status}).`);
    const html = await response.text();
    const product = extractExactProductJsonLd(html, canonicalUrl);
    return {
      metaDescription: stripMarkup(extractMetaDescription(html)),
      product
    };
  }
  throw new Error("Çok fazla yönlendirme.");
}

// productId/productUrl'den ürünün title + GERÇEK, allowlist'ten geçmiş
// canonicalUrl'ini çözer. Hem productId hem productUrl verilirse productUrl
// önceliklidir (kullanıcının açık URL'i, dolaylı id çözümlemesinin önüne
// geçer). Airtable + katalog birleşimi listProducts() (products.js) ÜZERİNDEN
// yapılır — yeni bir çözümleme mekanizması icat edilmez.
async function resolveProductIdentity({ productId, productUrl }, { listProductsImpl = listProducts } = {}) {
  if (productUrl) {
    const canonicalUrl = resolveProductUrl(productUrl);
    if (!canonicalUrl) throw new Error("productUrl yalnızca buzsu.com.tr/www.buzsu.com.tr adreslerini kabul eder.");
    const products = await listProductsImpl();
    const match = products.find((product) => resolveProductUrl(product.url) === canonicalUrl);
    return {
      canonicalUrl,
      productName: match?.title || titleFromSlug(slugFromUrl(canonicalUrl)) || "Buzsu ürünü",
      productImageUrls: match?.imageUrls?.length ? match.imageUrls : match?.imageUrl ? [match.imageUrl] : []
    };
  }
  if (productId) {
    const products = await listProductsImpl();
    const match = products.find((product) => product.id === productId);
    if (!match) throw new Error("Ürün bulunamadı (productId).");
    // Katalog/Airtable kaydındaki URL bozuk/izinsiz olsa bile (veri hatası,
    // farklı bir domain) buradan GEÇMEDEN canonicalUrl olarak kabul
    // edilmez — bu kontrol productUrl girdisiyle birebir aynıdır.
    const canonicalUrl = resolveProductUrl(match.url);
    if (!canonicalUrl) throw new Error("Bu ürünün kayıtlı URL'si buzsu.com.tr allowlist doğrulamasından geçemedi.");
    return {
      canonicalUrl,
      productName: match.title || "Buzsu ürünü",
      productImageUrls: match.imageUrls?.length ? match.imageUrls : match.imageUrl ? [match.imageUrl] : []
    };
  }
  throw new Error("productId veya productUrl gerekli.");
}

export async function getBuzsuProductContext(
  { productId, productUrl, refresh } = {},
  {
    listProductsImpl,
    listFeedProductsImpl = listFeedProducts,
    fetchImpl = fetch,
    putImpl,
    listImpl,
    now = () => Date.now()
  } = {}
) {
  const identity = await resolveProductIdentity({ productId, productUrl }, { listProductsImpl });
  const { canonicalUrl, productName, productImageUrls } = identity;

  if (refresh !== true) {
    const cached = await readProductContextCache(canonicalUrl, { listImpl, fetchImpl });
    const cachedAt = cached?.fetchedAt ? Date.parse(cached.fetchedAt) : NaN;
    if (cached && Number.isFinite(cachedAt) && now() - cachedAt < CACHE_TTL_MS) {
      return { ...cached, fromCache: true, warnings: [] };
    }
  }

  const warnings = [];
  let feedProduct = null;
  try {
    feedProduct = await findFeedProductByCanonicalUrl(canonicalUrl, { listFeedProductsImpl });
  } catch (error) {
    warnings.push(`XML ürün feed'i alınamadı: ${error.message}`);
  }
  if (!feedProduct) warnings.push("XML ürün feed'inde canonical URL ile birebir eşleşen kayıt bulunamadı.");

  let page = null;
  try {
    page = await fetchCanonicalProductPage(canonicalUrl, { fetchImpl });
  } catch (error) {
    warnings.push(`Canonical ürün sayfası içeriği alınamadı: ${error.message}`);
  }

  const exactSources = [
    feedProduct?.description && { text: feedProduct.description, sourceUrl: FEED_URL },
    page?.metaDescription && { text: page.metaDescription, sourceUrl: canonicalUrl },
    page?.product?.description && { text: page.product.description, sourceUrl: canonicalUrl }
  ].filter(Boolean);
  const seenFacts = new Set();
  const verifiedFacts = [];
  for (const source of exactSources) {
    for (const fact of splitSentences(source.text)) {
      const key = fact.toLocaleLowerCase("tr-TR");
      if (seenFacts.has(key)) continue;
      seenFacts.add(key);
      verifiedFacts.push({ fact, sourceUrl: source.sourceUrl });
    }
  }
  const buckets = { technicalFeatures: [], sellingPoints: [], useCases: [], targetAudience: [] };
  for (const sourceUrl of [...new Set(verifiedFacts.map((fact) => fact.sourceUrl))]) {
    const classified = classifySentences(verifiedFacts.filter((fact) => fact.sourceUrl === sourceUrl).map((fact) => fact.fact), sourceUrl);
    for (const key of Object.keys(buckets)) buckets[key].push(...classified[key]);
  }

  const exactText = exactSources.map((source) => source.text).join("\n");
  const classification = classifyInstallationContext({ title: productName }, exactText);
  const category = classification.confident ? INSTALLATION_CONTEXT_LABELS[classification.context] || "" : "";
  if (!classification.confident) {
    warnings.push("Ürün kategorisi/kullanım bağlamı net belirlenemedi (belirsiz sinyaller) — category alanı boş bırakıldı.");
  }

  const combinedText = exactText;
  const prohibitedClaims = classifyProhibitedClaims(combinedText);
  const sourceUrls = [...new Set(exactSources.map((source) => source.sourceUrl))];
  const exactImageUrls = feedProduct?.imageUrls?.length
    ? feedProduct.imageUrls
    : page?.product?.imageUrls?.length
      ? page.product.imageUrls
      : productImageUrls;

  const record = {
    productId: productId || catalogProductId(canonicalUrl),
    productName,
    canonicalUrl,
    category,
    description: combinedText ? truncate(combinedText, MAX_DESCRIPTION_LENGTH) : "",
    verifiedFacts,
    technicalFeatures: buckets.technicalFeatures,
    sellingPoints: buckets.sellingPoints,
    useCases: buckets.useCases,
    targetAudience: buckets.targetAudience,
    productImageUrls: exactImageUrls,
    prohibitedClaims,
    sourceUrls,
    fetchedAt: new Date(now()).toISOString(),
    contentHash: sha256(combinedText || canonicalUrl)
  };

  // Cache yazımı BEST-EFFORT'tur: başarısız olursa (BLOB_READ_WRITE_TOKEN
  // yok, Blob geçici hata) tool tamamen fail OLMAZ — taze context yine
  // döner, hata warnings'e eklenir.
  try {
    await writeProductContextCache(canonicalUrl, record, { putImpl });
  } catch (error) {
    warnings.push(`Önbelleğe yazılamadı: ${error.message}`);
  }

  return { ...record, fromCache: false, warnings };
}
