// buzsu.com.tr ürün sayfası URL'lerini doğrulayıp normalize eden ortak
// yardımcı. Hem llms-full.txt kataloğu (product-catalog.js) hem de feed.xml
// kataloğu (feed-catalog.js) aynı fonksiyonu kullanır — "hangi host'a izin
// veriliyor" kararı tek bir yerde kalır, iki modülde ayrı ayrı bakım
// gerektiren birbirinden sapabilecek kopyalar oluşmaz.
const SITE_ORIGIN = "https://www.buzsu.com.tr";

export function resolveProductUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return null;
  const absolute = /^https?:\/\//i.test(trimmed) ? trimmed : `${SITE_ORIGIN}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  if (parsed.hostname !== "www.buzsu.com.tr") return null;
  return `${SITE_ORIGIN}${parsed.pathname.replace(/\/+$/, "")}/`;
}

export function slugFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}
