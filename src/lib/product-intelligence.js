import { createHash } from "node:crypto";
import { resolveProductUrl, slugFromUrl } from "./buzsu-url.js";
import { fetchProductContext, LLMS_FULL_URL } from "./product-context.js";
import { listProducts } from "./products.js";
import { catalogProductId } from "./product-catalog.js";
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
// KRİTİK TASARIM KARARI: verifiedFacts, kaynak metinden (llms-full.txt
// penceresi veya destekleyici sayfa özeti) AI TARAFINDAN YENİDEN
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

function extractMetaDescription(html) {
  const match =
    String(html || "").match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    String(html || "").match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

// Ürün sayfasının kendisinden meta description çeker — SADECE destekleyici
// bir kaynaktır (llms-full.txt eşleşmesi yoksa devreye girer). Her
// yönlendirme adımı resolveProductUrl'den GEÇMEDEN takip edilmez; hedef
// buzsu.com.tr dışına çıkarsa (yönlendirme zinciri ele geçirilmiş/bozuk
// olsa bile) hemen hata verir.
async function fetchSupportiveMeta(canonicalUrl, { fetchImpl }) {
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
    return extractMetaDescription(html);
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
    fetchProductContextImpl = fetchProductContext,
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
  const grounding = await fetchProductContextImpl({ title: productName, url: canonicalUrl }).catch(() => "");
  if (!grounding) warnings.push("llms-full.txt içinde bu ürüne ait eşleşen içerik bulunamadı.");

  // HTML/meta fallback yalnızca destekleyici bir kaynaktır — ana kaynak
  // (llms-full.txt) bir eşleşme bulduysa devreye hiç girmez.
  let supportiveText = "";
  if (!grounding) {
    try {
      supportiveText = await fetchSupportiveMeta(canonicalUrl, { fetchImpl });
    } catch (error) {
      warnings.push(`Destekleyici ürün sayfası içeriği alınamadı: ${error.message}`);
    }
  }

  const primaryText = grounding || supportiveText;
  const primarySourceUrl = grounding ? LLMS_FULL_URL : canonicalUrl;
  const sentences = splitSentences(primaryText);
  const verifiedFacts = sentences.map((fact) => ({ fact, sourceUrl: primarySourceUrl }));
  const buckets = classifySentences(sentences, primarySourceUrl);

  const classification = classifyInstallationContext({ title: productName }, grounding);
  const category = classification.confident ? INSTALLATION_CONTEXT_LABELS[classification.context] || "" : "";
  if (!classification.confident) {
    warnings.push("Ürün kategorisi/kullanım bağlamı net belirlenemedi (belirsiz sinyaller) — category alanı boş bırakıldı.");
  }

  const combinedText = [grounding, supportiveText].filter(Boolean).join("\n");
  const prohibitedClaims = classifyProhibitedClaims(combinedText);
  const sourceUrls = [...new Set([grounding && LLMS_FULL_URL, supportiveText && canonicalUrl].filter(Boolean))];

  const record = {
    productId: productId || catalogProductId(canonicalUrl),
    productName,
    canonicalUrl,
    category,
    description: primaryText ? truncate(primaryText, MAX_DESCRIPTION_LENGTH) : "",
    verifiedFacts,
    technicalFeatures: buckets.technicalFeatures,
    sellingPoints: buckets.sellingPoints,
    useCases: buckets.useCases,
    targetAudience: buckets.targetAudience,
    productImageUrls,
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
