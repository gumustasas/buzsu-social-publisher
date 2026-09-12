// "Yeni içerik oluştur" ürün listesi şimdiye kadar yalnızca Airtable'daki
// mevcut Sosyal Medya Takvimi kayıtlarından türetiliyordu — yani daha önce
// hiç paylaşılmamış bir ürün listede hiç görünmüyordu. Bu modül,
// buzsu.com.tr'nin yayınladığı llms-full.txt dosyasından ürün adı+URL
// çiftlerini çıkarıp listeyi genişletir. Bu dosya fotoğraf URL'si içermez;
// bilinen ürünler için imageUrl product-photos.js'teki doğrulanmış eşleme
// listesinden doldurulur — listede olmayanlar boş kalır ve panelde elle
// girilmesi gerekir (bkz. dashboard.html).
import { findKnownProductPhoto, findKnownProductPhotos } from "./product-photos.js";
import { resolveProductUrl, slugFromUrl } from "./buzsu-url.js";
import { listFeedProducts } from "./feed-catalog.js";

const LLMS_FULL_URL = "https://www.buzsu.com.tr/llms-full.txt";
const CACHE_TTL_MS = 30 * 60 * 1000;
const EXCLUDED_SLUGS = new Set(["", "iletisim", "hakkimizda", "blog", "sepet", "hesabim", "kategori"]);
// llms-full.txt iki sabit kalıpla ürün listeler (canlı dosyadan doğrulandı):
//   1) "#### ⭐ Ana Ürün: <başlık>" satırını izleyen "**URL:** <mutlak url>" satırı.
//   2) Bir "| Ürün | URL |" tablo başlığını izleyen "| <başlık> | /göreli-yol/ |" satırları.
// Kategori/alt-kategori tabloları ("| Alt Kategori | URL |") ve bilgi
// tabloları (URL sütunu olmayan) kasıtlı olarak eşleşmez — bunlar ürün değil.
const ANA_URUN_PATTERN = /^####\s*⭐\s*Ana Ürün:\s*(.+)$/;
const URL_FIELD_PATTERN = /^\*\*URL:\*\*\s*(\S+)/;
const PRODUCT_TABLE_HEADER_PATTERN = /^\|\s*Ürün\s*\|\s*URL\s*\|/i;
const PRODUCT_TABLE_ROW_PATTERN = /^\|\s*(.+?)\s*\|\s*(\/\S*|https?:\/\/\S*)\s*\|/i;

let cached = null; // { catalog, fetchedAt }

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((word) => (word.length ? word[0].toLocaleUpperCase("tr-TR") + word.slice(1) : word))
    .join(" ");
}

export function extractCatalog(text) {
  const seen = new Set();
  const catalog = [];
  const lines = text.split("\n");

  function addProduct(rawTitle, rawUrl) {
    const title = String(rawTitle || "").replace(/^#+\s*/, "").trim();
    const url = resolveProductUrl(String(rawUrl || "").trim());
    if (!title || !url) return;
    const slug = slugFromUrl(url);
    if (!slug || EXCLUDED_SLUGS.has(slug) || seen.has(url)) return;
    seen.add(url);
    catalog.push({ title, url });
  }

  for (let i = 0; i < lines.length; i++) {
    const anaUrunMatch = lines[i].match(ANA_URUN_PATTERN);
    if (anaUrunMatch) {
      for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
        const urlMatch = lines[j].match(URL_FIELD_PATTERN);
        if (urlMatch) { addProduct(anaUrunMatch[1], urlMatch[1]); break; }
      }
      continue;
    }
    if (PRODUCT_TABLE_HEADER_PATTERN.test(lines[i])) {
      let j = i + 1;
      if (lines[j] && /^\|[\s|-]+\|$/.test(lines[j].trim())) j++;
      for (; j < lines.length; j++) {
        const rowMatch = lines[j].match(PRODUCT_TABLE_ROW_PATTERN);
        if (!rowMatch) break;
        addProduct(rowMatch[1], rowMatch[2]);
      }
    }
  }
  return catalog;
}

async function fetchLlmsCatalog() {
  const response = await fetch(LLMS_FULL_URL);
  if (!response.ok) throw new Error(`llms-full.txt alınamadı: HTTP ${response.status}`);
  const text = await response.text();
  return extractCatalog(text);
}

// İki kaynağı birleştirir: feed.xml (Google Merchant ürün feed'i, gerçek
// görsel galerisi içerir — bkz. feed-catalog.js) ve llms-full.txt (görselsiz
// ama feed'de olmayan kampanya/set sayfalarını da kapsar). Aynı URL her
// ikisinde de varsa feed'deki kazanır (görseli daha zengin); feed'de hiç
// olmayan URL'ler llms-full.txt'ten olduğu gibi geçer. Kaynaklardan biri
// başarısız olursa (ağ hatası, format değişikliği) diğerini hiç etkilemez —
// her ikisi de kendi içinde ayrı ayrı try/catch ile korunuyor.
async function fetchCatalog() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.catalog;
  const [llmsCatalog, feedCatalog] = await Promise.all([
    fetchLlmsCatalog().catch(() => []),
    listFeedProducts()
  ]);
  const byUrl = new Map();
  for (const item of feedCatalog) byUrl.set(item.url, item);
  for (const item of llmsCatalog) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  const catalog = [...byUrl.values()];
  cached = { catalog, fetchedAt: Date.now() };
  return catalog;
}

// Ağ hatasında boş liste döner — ürün dropdown'u bu durumda sadece
// Airtable'daki mevcut kayıtları gösterir, hiçbir çağrıyı engellemez.
export async function listCatalogProducts() {
  try {
    const catalog = await fetchCatalog();
    // feed.xml'den gelen ürünlerde imageUrl zaten dolu (gerçek galeri) —
    // bunlar olduğu gibi kullanılır. Yalnızca hiç görseli olmayanlar (feed'de
    // yok, sadece llms-full.txt'te var) için eski elle doğrulanmış
    // product-photos.js eşlemesine düşülür.
    return catalog.map((item) => (item.imageUrl ? item : { ...item, imageUrl: findKnownProductPhoto(item.url), imageUrls: findKnownProductPhotos(item.url) }));
  } catch {
    return [];
  }
}

// llms-full.txt'ten gelen ürünlerin henüz bir Airtable kaydı yok; bu yüzden
// dropdown'da URL'lerinden türetilen sentetik bir id kullanılır. Bu id'ler
// gerçek Airtable record id'leriyle (rec...) asla çakışmaz.
const CATALOG_ID_PREFIX = "llms:";

export function catalogProductId(url) {
  return `${CATALOG_ID_PREFIX}${encodeURIComponent(url)}`;
}

export function isCatalogProductId(id) {
  return typeof id === "string" && id.startsWith(CATALOG_ID_PREFIX);
}

export async function findCatalogProduct(id) {
  if (!isCatalogProductId(id)) return null;
  const url = decodeURIComponent(id.slice(CATALOG_ID_PREFIX.length));
  const catalog = await listCatalogProducts();
  const match = catalog.find((item) => item.url === url);
  return match || { title: titleFromSlug(slugFromUrl(url)), url, imageUrl: findKnownProductPhoto(url), imageUrls: findKnownProductPhotos(url) };
}
