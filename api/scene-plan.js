import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableSceneProviders } from "../src/scene-image.js";
import { generateScenePlan } from "../src/ai-providers.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";
import { fetchProductContext } from "../src/lib/product-context.js";
import { classifyInstallationContext, detectsContextConflict, INSTALLATION_CONTEXTS, INSTALLATION_CONTEXT_LABELS } from "../src/lib/product-installation-context.js";

import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const providers = availableSceneProviders();
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const provider = providers.includes(body.provider) ? body.provider : providers[0];
    if (!provider) return response.status(400).json({ error: "OPENAI_API_KEY veya GEMINI_API_KEY Vercel Production ortamında tanımlı değil." });

    let product;
    if (isCatalogProductId(body.productId)) {
      const catalogProduct = await findCatalogProduct(body.productId);
      if (!catalogProduct) return response.status(400).json({ error: "Ürün seçilmedi." });
      product = { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", url: catalogProduct.url };
    } else {
      const data = await airtable();
      const record = (data.records || []).find((item) => item.id === body.productId);
      const fields = record?.fields || {};
      if (!record) return response.status(400).json({ error: "Ürün seçilmedi." });
      product = { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", url: fields["Kaynak URL"] || "" };
    }

    // Bağlam sınıflandırması HER ZAMAN çalışır (ücretsiz, deterministik) —
    // bu, eski çağıranlar (bkz. dashboard.html #seo-generate-image) için de
    // hiçbir yanıt şekli değişikliği olmadan, sessizce daha güvenli/bağlama
    // uygun bir sahne planı üretilmesini sağlar. Yalnızca `allowContextQuestion`
    // açıkça true gönderildiğinde (bkz. dashboard.html #scene-plan, yeni akış)
    // belirsizlik/çelişki durumunda AI'ya HİÇ gidilmeden kullanıcıya kısa bir
    // soru sorulur — eski çağıranlar bu soru akışını hiç görmez, geriye
    // uyumluluk bu şekilde korunur.
    const context = await fetchProductContext(product);
    const allowContextQuestion = body.allowContextQuestion === true;
    const validOverride = Object.values(INSTALLATION_CONTEXTS).includes(body.usageContextOverride) && body.usageContextOverride !== INSTALLATION_CONTEXTS.AMBIGUOUS ? body.usageContextOverride : null;
    const classification = validOverride ? { context: validOverride } : classifyInstallationContext(product, context);

    if (allowContextQuestion && classification.context === INSTALLATION_CONTEXTS.AMBIGUOUS) {
      return response.status(200).json({
        ok: true,
        needsContextSelection: true,
        product,
        options: Object.entries(INSTALLATION_CONTEXT_LABELS).map(([value, label]) => ({ value, label })),
        message: "Bu ürünün gerçek kullanım/montaj yeri ürün başlığından otomatik belirlenemedi. Yanlış varsayım yapmamak için lütfen aşağıdan seçin."
      });
    }
    // Sınıflandırma belirsiz (AMBIGUOUS) ve soru sorulmasına izin verilmediyse
    // (eski çağıran) bağlam zorlanmaz — generateScenePlan'e usageContext=null
    // geçilir, prompt kendi eski (serbest tahmin) davranışına döner.
    const usageContext = classification.context === INSTALLATION_CONTEXTS.AMBIGUOUS ? null : classification.context;

    const userNotes = typeof body.userNotes === "string" ? body.userNotes : "";
    if (allowContextQuestion && usageContext && userNotes && detectsContextConflict(userNotes, usageContext) && !body.confirmContextOverride) {
      return response.status(200).json({
        ok: true,
        needsContextConfirmation: true,
        usageContext,
        message: `Yazdığınız not, "${product.title}" ürününün gerçek kullanım yeriyle (${INSTALLATION_CONTEXT_LABELS[usageContext]}) çelişiyor gibi görünüyor. Devam etmek isterseniz onaylayın — yine de ürünün fiziksel montaj gerçeğiyle çelişen öğeler sahneye eklenmeyecektir.`
      });
    }

    const plan = await generateScenePlan(provider, product, process.env, { usageContext, userNotes });
    return response.status(200).json({ ok: true, plan });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
