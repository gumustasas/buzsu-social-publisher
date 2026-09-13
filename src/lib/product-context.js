// AI sahne/metin üretimi, ürünün gerçekte ne olduğunu bilmeden (Code = mutfak
// altı cihaz, UltraMag = boru/bina girişine takılan manyetik kireç önleyici
// gibi) hep aynı şablonu (mutfak+aile) üretiyordu. Bu modül, buzsu.com.tr'nin
// yayınladığı llms-full.txt dosyasından ürüne ait gerçek metni bulup AI
// prompt'una "grounding" (gerçek bilgi) olarak ekler.
// product-intelligence.js (get_buzsu_product_context) verifiedFacts'in
// sourceUrl'ü olarak AYNI sabiti kullanır — tek kaynaktan doğruluk için
// export edildi.
export const LLMS_FULL_URL = "https://www.buzsu.com.tr/llms-full.txt";
const CACHE_TTL_MS = 30 * 60 * 1000;
const CONTEXT_WINDOW_BEFORE = 200;
const CONTEXT_WINDOW_AFTER = 1400;

let cached = null; // { text, fetchedAt }

async function fetchLlmsFullText() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.text;
  const response = await fetch(LLMS_FULL_URL);
  if (!response.ok) throw new Error(`llms-full.txt alınamadı: HTTP ${response.status}`);
  const text = await response.text();
  cached = { text, fetchedAt: Date.now() };
  return text;
}

export function slugFromUrl(url) {
  try {
    const segments = new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    return segments[segments.length - 1] || "";
  } catch {
    return "";
  }
}

export function findMatchIndex(text, candidates) {
  const lowerText = text.toLocaleLowerCase("tr-TR");
  for (const candidate of candidates) {
    const needle = String(candidate || "").trim().toLocaleLowerCase("tr-TR");
    if (!needle) continue;
    const index = lowerText.indexOf(needle);
    if (index >= 0) return index;
  }
  return -1;
}

// Ağ hatası veya eşleşme yoksa boş string döner — prompt üretimi bu durumda
// gerçek bilgi olmadan devam eder, hiçbir çağrıyı engellemez.
export async function fetchProductContext(product) {
  try {
    const text = await fetchLlmsFullText();
    const url = String(product?.url || "").trim();
    const title = String(product?.title || "").trim();
    const slug = url ? slugFromUrl(url) : "";
    const index = findMatchIndex(text, [url, slug, title]);
    if (index < 0) return "";
    const start = Math.max(0, index - CONTEXT_WINDOW_BEFORE);
    const end = Math.min(text.length, index + CONTEXT_WINDOW_AFTER);
    return text.slice(start, end).trim();
  } catch {
    return "";
  }
}
