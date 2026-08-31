import { baseProductTitle } from "./product-title.js";
import { listCatalogProducts, catalogProductId } from "./product-catalog.js";
import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "./config.js";

export async function airtableRequest(path = "", options = {}) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
}

export async function listRawRecords() {
  const data = await airtableRequest("?pageSize=100");
  return data.records || [];
}

// Ürün listesi iki kaynağın birleşimidir: (1) Airtable'daki mevcut Sosyal
// Medya Takvimi kayıtları — bunlar daha önce paylaşılmış/taslak ürünlerdir
// ve genelde bir Görsel URL'e sahiptir; (2) buzsu.com.tr'nin llms-full.txt
// kataloğundaki, henüz hiç Airtable kaydı olmayan ürünler — bunların
// imageUrl'i boştur ve panelde elle girilmesi gerekir (bkz. dashboard.html).
// Görsel URL zorunluluğu burada değil, kayıt sırasında buildDraft() içinde
// kontrol edilir; böylece görseli eksik ürünler listeden tamamen kaybolmak
// yerine "elle gir" seçeneğiyle görünür kalır.
//
// api/content.js (composer) ve api/intent.js (tek cümlelik istek ayrıştırma)
// aynı listeyi kullanır — tek kaynak burasıdır.
export async function listProducts() {
  const [records, catalog] = await Promise.all([listRawRecords(), listCatalogProducts()]);
  // Aynı ürüne ait birden fazla Airtable taslağı olabilir (her paylaşım
  // denemesi ayrı bir kayıttır) ve dropdown bunlardan yalnızca ilkini
  // ürün adı olarak kullanır. O ilk kayıt "DENEME | ..." gibi geçici bir
  // test başlığı taşıyorsa ürün dropdown'da tanınmaz hale gelir (bkz.
  // "DENEME" bug'ı). Bu yüzden llms-full.txt kataloğunda bu URL için
  // resmi bir ürün adı varsa, Airtable kaydının başlığı yerine o kullanılır.
  const catalogTitleByUrl = new Map(catalog.map((item) => [item.url, item.title]));
  const seen = new Set();
  const airtableProducts = records.map((record) => {
    const fields = record.fields || {};
    const url = fields["Kaynak URL"] || "";
    const title = (url && catalogTitleByUrl.get(url)) || baseProductTitle(fields.Başlık) || "Başlıksız";
    return { id: record.id, title, url, imageUrl: fields["Görsel URL"] || "", instagramText: fields["Instagram Metni"] || "", facebookText: fields["Facebook Metni"] || "" };
  }).filter((product) => {
    const key = product.url || product.id;
    if (!product.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const catalogProducts = catalog.map((item) => ({ id: catalogProductId(item.url), title: item.title, url: item.url, imageUrl: item.imageUrl || "", instagramText: "", facebookText: "" })).filter((product) => {
    if (seen.has(product.url)) return false;
    seen.add(product.url);
    return true;
  });
  return [...airtableProducts, ...catalogProducts];
}

// api/content.js (composer) ve api/autopilot.js (otomatik pilot) aynı alan
// eşlemesiyle taslak kaydı oluşturur — tek kaynak burasıdır.
export async function createDraftRecord({ product, draft, format, platforms, publishAt, note }) {
  return airtableRequest("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: {
    "Başlık": draft.title,
    "İçerik Türü": "Ürün",
    "Kaynak URL": product.url,
    "Görsel URL": product.imageUrl,
    ...(product.videoUrl ? { "Video URL": product.videoUrl } : {}),
    "Instagram Metni": draft.instagramText,
    "Facebook Metni": draft.facebookText,
    Hashtagler: draft.hashtags,
    Platform: platforms,
    "Yayın Biçimi": format,
    "Yayın Zamanı": publishAt,
    Durum: "Taslak",
    Not: note,
    "Deneme Sayısı": 0,
    "Hata Mesajı": ""
  } }) });
}
