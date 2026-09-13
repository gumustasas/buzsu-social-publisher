import { put, list } from "@vercel/blob";

// get_buzsu_product_context'in (bkz. product-intelligence.js) normalize
// edilmiş çıktısını kalıcı olarak önbelleğe alır — video-jobs.js'teki AYNI
// Blob deseni (öngörülebilir sabit yol, list() ile bulup gerçek Blob
// URL'inden oku), farklı bir prefix ile. TTL kontrolü BURADA yapılmaz —
// bu modül yalnızca ham okuma/yazmadır, "taze mi" kararını çağıran taraf
// (fetchedAt'e bakarak) verir.
const CACHE_PREFIX = "product-context-cache/";

export function productContextCachePath(canonicalUrl) {
  return `${CACHE_PREFIX}${encodeURIComponent(canonicalUrl)}.json`;
}

export async function writeProductContextCache(canonicalUrl, record, { putImpl = put } = {}) {
  const path = productContextCachePath(canonicalUrl);
  return putImpl(path, JSON.stringify(record), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

// Bozuk/eksik JSON (yarım yazım, format değişikliği, ağ hatası) SESSİZCE
// yok sayılır (null döner) — cache'in kendisi bozuksa get_buzsu_product_context
// tamamen fail olmamalı, taze bir context yeniden üretilmeli.
export async function readProductContextCache(canonicalUrl, { listImpl = list, fetchImpl = fetch } = {}) {
  const path = productContextCachePath(canonicalUrl);
  try {
    const { blobs } = await listImpl({ prefix: path, limit: 1 });
    const match = blobs.find((blob) => blob.pathname === path);
    if (!match) return null;
    const response = await fetchImpl(match.url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
