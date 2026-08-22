// Otomatik Pilot'ın "bugün hangi ürünü paylaşalım" kararı: kataloğun en uzun
// süredir (hiç veya en eski) öne çıkarılmamış ürününü seçer. Ayrı bir dönüşüm
// sırası saklamak yerine mevcut Airtable kayıtlarının "Kaynak URL" + oluşturma
// zamanından çıkarım yapar — böylece rotasyon durumu için yeni bir alan/tablo
// gerekmez.
export function pickNextProduct(products, records) {
  const lastFeaturedByUrl = new Map();
  for (const record of records || []) {
    const url = record.fields?.["Kaynak URL"];
    if (!url) continue;
    const created = Date.parse(record.createdTime);
    if (Number.isNaN(created)) continue;
    const previous = lastFeaturedByUrl.get(url);
    if (previous === undefined || created > previous) lastFeaturedByUrl.set(url, created);
  }

  // AI sahnesi gerçek bir referans fotoğraf gerektirdiğinden, fotoğrafsız
  // katalog ürünleri (bkz. product-catalog.js) otomatik pilotta atlanır —
  // insan onayı olmadan elle görsel girme adımı yok.
  const candidates = (products || []).filter((product) => /^https:\/\//i.test(product.imageUrl || ""));
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aTime = lastFeaturedByUrl.has(a.url) ? lastFeaturedByUrl.get(a.url) : -Infinity;
    const bTime = lastFeaturedByUrl.has(b.url) ? lastFeaturedByUrl.get(b.url) : -Infinity;
    return aTime - bTime;
  });
  return candidates[0];
}
