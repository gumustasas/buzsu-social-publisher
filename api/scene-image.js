import "dotenv/config";
import { put } from "@vercel/blob";
import { getSession } from "../src/auth.js";
import { availableSceneProviders, generateSceneImage } from "../src/scene-image.js";
import { generateCompositeSceneImage } from "../src/scene-composite.js";
import { validateScenario, validateScenarioAgainstContext, buildSceneDescriptionFromScenario } from "../src/lib/scenario-schema.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";
import { findKnownProductPhotos } from "../src/lib/product-photos.js";

import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    const providers = availableSceneProviders();
    if (request.method === "GET") return response.status(200).json({ ok: true, providers });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });

    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const provider = providers.includes(body.provider) ? body.provider : providers[0];
    if (!provider) return response.status(400).json({ error: "OPENAI_API_KEY veya GEMINI_API_KEY Vercel Production ortamında tanımlı değil." });

    // Panelde elle girilen/yüklenen görsel URL'i (bkz. dashboard.html
    // #product-imageurl, #product-image-upload) her zaman önceliklidir —
    // kullanıcı bunu bilinçli olarak girer/yükler, ürünün Airtable'daki
    // veya katalogdaki kayıtlı fotoğrafını (yanlış/pazarlama görseli
    // olabilir) BİLEREK geçersiz kılmak istiyor olabilir. Kayıtlı fotoğraf
    // yalnızca elle bir şey girilmediğinde yedek (fallback) olarak kullanılır.
    const manualImageUrl = typeof body.imageUrl === "string" && /^https:\/\//i.test(body.imageUrl) ? body.imageUrl : "";
    let product, recordId;
    if (isCatalogProductId(body.productId)) {
      const catalogProduct = await findCatalogProduct(body.productId);
      if (!catalogProduct) return response.status(400).json({ error: "Ürün bulunamadı." });
      const resolvedImageUrl = manualImageUrl || catalogProduct.imageUrl;
      if (!resolvedImageUrl) return response.status(400).json({ error: "Bu ürünün bilinen bir fotoğrafı yok. Üstteki \"Görsel URL\" alanına ürünün gerçek fotoğraf bağlantısını girin (ör. https://www.buzsu.com.tr/wp-content/uploads/.../urun.jpg) — ürün sayfasının linkini değil." });
      product = { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", imageUrl: resolvedImageUrl, imageUrls: manualImageUrl ? [manualImageUrl] : (catalogProduct.imageUrls || [resolvedImageUrl]) };
      recordId = body.productId;
    } else {
      const data = await airtable();
      const record = (data.records || []).find((item) => item.id === body.productId);
      const fields = record?.fields || {};
      if (!record) return response.status(400).json({ error: "Ürün bulunamadı." });
      const knownImages = findKnownProductPhotos(fields["Kaynak URL"] || "");
      const resolvedImageUrl = manualImageUrl || fields["Görsel URL"] || knownImages[0];
      if (!resolvedImageUrl) return response.status(400).json({ error: "Ürün görseli eksik." });
      product = { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", imageUrl: resolvedImageUrl, imageUrls: manualImageUrl ? [manualImageUrl] : [resolvedImageUrl, ...knownImages.filter((item) => item !== resolvedImageUrl)] };
      recordId = record.id;
    }

    // Opsiyonel yapılandırılmış senaryo (bkz. /api/scene-scenario) — verildiğinde
    // önce YENİDEN doğrulanır (kullanıcı dashboard'da elle düzenlemiş olabilir;
    // bağlam/yasak listesi çelişkisi burada da engellenir, tek noktaya güvenilmez)
    // ve tek bir sceneDescription paragrafına indirgenip generateSceneImage'a
    // AYNI şekilde verilir. body.sceneDescription verildiğinde davranış birebir
    // eskisi gibi kalır — bu blok yalnızca body.scenario doluyken çalışır.
    let sceneDescription = body.sceneDescription;
    if (body.scenario && typeof body.scenario === "object") {
      const scenario = validateScenario(body.scenario);
      validateScenarioAgainstContext(scenario);
      sceneDescription = buildSceneDescriptionFromScenario(scenario);
    }

    const scene = provider === "composite"
      ? await generateCompositeSceneImage(product, sceneDescription, process.env)
      : await generateSceneImage(product, sceneDescription, process.env, { removeFaucet: Boolean(body.removeFaucet), provider });

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const imageBuffer = Buffer.from(scene.dataUrl.split(",")[1], "base64");
      const safeId = String(recordId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      const blob = await put(`ai-scenes/${safeId}-${Date.now()}.png`, imageBuffer, { access: "public", contentType: "image/png" });
      scene.imageUrl = blob.url;
    }

    return response.status(200).json({ ok: true, scene });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
