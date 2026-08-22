import { baseProductTitle } from "./product-title.js";
import { listCatalogProducts, catalogProductId } from "./product-catalog.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";

export async function airtableRequest(path = "", options = {}) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
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
  const data = await airtableRequest("?pageSize=100");
  const seen = new Set();
  const airtableProducts = (data.records || []).map((record) => {
    const fields = record.fields || {};
    return { id: record.id, title: baseProductTitle(fields.Başlık) || "Başlıksız", url: fields["Kaynak URL"] || "", imageUrl: fields["Görsel URL"] || "", instagramText: fields["Instagram Metni"] || "", facebookText: fields["Facebook Metni"] || "" };
  }).filter((product) => {
    const key = product.url || product.id;
    if (!product.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const catalog = await listCatalogProducts();
  const catalogProducts = catalog.map((item) => ({ id: catalogProductId(item.url), title: item.title, url: item.url, imageUrl: "", instagramText: "", facebookText: "" })).filter((product) => {
    if (seen.has(product.url)) return false;
    seen.add(product.url);
    return true;
  });
  return [...airtableProducts, ...catalogProducts];
}
