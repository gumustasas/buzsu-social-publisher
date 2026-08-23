// "Yeni içerik oluştur" ürün listesi şimdiye kadar yalnızca Airtable'daki
// mevcut Sosyal Medya Takvimi kayıtlarından türetiliyordu — yani daha önce
// hiç paylaşılmamış bir ürün listede hiç görünmüyordu. Bu modül,
// buzsu.com.tr'nin yayınladığı llms-full.txt dosyasından ürün adı+URL
// çiftlerini çıkarıp listeyi genişletir. Bu dosya fotoğraf URL'si içermez;
// bilinen ürünler için imageUrl product-photos.js'teki doğrulanmış eşleme
// listesinden doldurulur — listede olmayanlar boş kalır ve panelde elle
// girilmesi gerekir (bkz. dashboard.html).
import { findKnownProductPhoto } from "./product-photos.js";

const LLMS_FULL_URL = "https://www.buzsu.com.tr/llms-full.txt";
const CACHE_TTL_MS = 30 * 60 * 1000;
const PRODUCT_URL_PATTERN = /https:\/\/www\.buzsu\.com\.tr\/[a-z0-9-]+\/?/gi;
const EXCLUDED_SLUGS = new Set(["", "iletisim", "hakkimizda", "blog", "sepet", "hesabim", "kategori"]);

let cached = null; // { catalog, fetchedAt }

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((word) => (word.length ? word[0].toLocaleUpperCase("tr-TR") + word.slice(1) : word))
    .join(" ");
}

function slugFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

// llms-full.txt'in tam biçimini bilmediğimiz için (bu ortamdan erişilemiyor),
// her URL'nin hemen öncesindeki satırı olası bir başlık adayı olarak dener;
// makul görünmüyorsa (çok uzun/kısa, başka bir URL içeriyor) slug'dan
// okunabilir bir başlık türetir. Format farklı çıkarsa bu sezgisel yöntem
// canlıda gözden geçirilip ayarlanmalı.
function extractCatalog(text) {
  const seen = new Set();
  const catalog = [];
  const lines = text.split("\n");
  const lineStarts = [];
  let offset = 0;
  for (const line of lines) { lineStarts.push(offset); offset += line.length + 1; }

  let match;
  PRODUCT_URL_PATTERN.lastIndex = 0;
  while ((match = PRODUCT_URL_PATTERN.exec(text))) {
    const url = match[0].replace(/\/?$/, "/");
    const slug = slugFromUrl(url);
    if (!slug || EXCLUDED_SLUGS.has(slug) || seen.has(url)) continue;
    seen.add(url);

    let lineIndex = lineStarts.findIndex((start, i) => match.index >= start && match.index < (lineStarts[i + 1] ?? Infinity));
    let title = "";
    for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 3) && !title; i--) {
      const candidate = lines[i].replace(/^#+\s*/, "").trim();
      if (candidate && candidate.length <= 120 && !/https?:\/\//.test(candidate)) title = candidate;
    }
    catalog.push({ title: title || titleFromSlug(slug), url });
  }
  return catalog;
}

async function fetchCatalog() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.catalog;
  const response = await fetch(LLMS_FULL_URL);
  if (!response.ok) throw new Error(`llms-full.txt alınamadı: HTTP ${response.status}`);
  const text = await response.text();
  const catalog = extractCatalog(text);
  cached = { catalog, fetchedAt: Date.now() };
  return catalog;
}

// Ağ hatasında boş liste döner — ürün dropdown'u bu durumda sadece
// Airtable'daki mevcut kayıtları gösterir, hiçbir çağrıyı engellemez.
export async function listCatalogProducts() {
  try {
    const catalog = await fetchCatalog();
    return catalog.map((item) => ({ ...item, imageUrl: findKnownProductPhoto(item.url) }));
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
  return match || { title: titleFromSlug(slugFromUrl(url)), url, imageUrl: findKnownProductPhoto(url) };
}
