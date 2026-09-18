import "dotenv/config";
import { getSession } from "../src/auth.js";
import { generateNanoBananaScene } from "../src/nano-banana-scene.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";
import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";

function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

// productId'yi mevcut api/scene-image.js ile AYNI desenle (katalog/Airtable)
// çözer — tek fark burada productId İSTEĞE BAĞLIDIR: boşsa Nano Banana 2
// sıfırdan/zero-shot moda geçer (bkz. src/nano-banana-scene.js), diğer hiçbir
// ürün-referanslı üretim uç noktasında (scene-image, reels) bu istisna yoktur.
async function resolveOptionalProduct(productId) {
  if (!String(productId || "").trim()) return null;
  if (isCatalogProductId(productId)) {
    const catalogProduct = await findCatalogProduct(productId);
    if (!catalogProduct) throw new Error("Ürün bulunamadı.");
    if (!catalogProduct.imageUrl) throw new Error("Bu ürünün bilinen bir fotoğrafı yok.");
    return { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", imageUrl: catalogProduct.imageUrl, imageUrls: catalogProduct.imageUrls || [catalogProduct.imageUrl] };
  }
  const data = await airtable();
  const record = (data.records || []).find((item) => item.id === productId);
  if (!record) throw new Error("Ürün bulunamadı.");
  const fields = record.fields || {};
  if (!fields["Görsel URL"]) throw new Error("Bu ürünün bilinen bir fotoğrafı yok; önce Görsel URL alanını doldurun.");
  return { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", imageUrl: fields["Görsel URL"], imageUrls: [fields["Görsel URL"]] };
}

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});

    const product = await resolveOptionalProduct(body.productId);
    const scene = await generateNanoBananaScene({
      product,
      prompt: body.prompt,
      aspectRatio: body.aspectRatio,
      confirmed: body.confirmed === true
    }, process.env);

    return response.status(200).json({ ok: true, scene });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
