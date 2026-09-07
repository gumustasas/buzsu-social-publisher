import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableSceneProviders } from "../src/scene-image.js";
import { generateScenario } from "../src/ai-providers.js";
import { fetchProductContext } from "../src/lib/product-context.js";
import { classifyInstallationContext, detectsContextConflict, INSTALLATION_CONTEXTS, INSTALLATION_CONTEXT_LABELS } from "../src/lib/product-installation-context.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";

import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

// Yeni, yapılandırılmış AI senaryo akışının giriş noktası. Mevcut
// /api/scene-plan (serbest metin sahne planı) DOKUNULMADAN yanına eklendi —
// dashboard'daki eski "Sahne planı üret (AI)" akışı bu dosyayı hiç kullanmaz.
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

    const context = await fetchProductContext(product);

    // Kullanım bağlamı: önce kullanıcının elle seçtiği override (bkz.
    // dashboard'daki "Bu ürün nerede kullanılıyor?" seçici), yoksa üründen
    // otomatik sınıflandırma. Sınıflandırma belirsizse (AMBIGUOUS) ve bir
    // override verilmemişse AI'ya HİÇ gidilmez — kullanıcıya bağlam
    // seçtirilir (varsayım yapılmaz, bkz. gereksinim).
    const validOverride = Object.values(INSTALLATION_CONTEXTS).includes(body.usageContextOverride) && body.usageContextOverride !== INSTALLATION_CONTEXTS.AMBIGUOUS ? body.usageContextOverride : null;
    const classification = validOverride ? { context: validOverride, matchedKeywords: [], confident: true } : classifyInstallationContext(product, context);
    if (classification.context === INSTALLATION_CONTEXTS.AMBIGUOUS) {
      return response.status(200).json({
        ok: true,
        needsContextSelection: true,
        product,
        options: Object.entries(INSTALLATION_CONTEXT_LABELS).map(([value, label]) => ({ value, label })),
        message: "Bu ürünün gerçek kullanım/montaj yeri ürün başlığından otomatik belirlenemedi. Yanlış varsayım yapmamak için lütfen aşağıdan seçin."
      });
    }
    const usageContext = classification.context;

    const userNotes = typeof body.userNotes === "string" ? body.userNotes : "";
    // "evin içine koy" gibi ürünün gerçek montaj yeriyle çelişen bir istek
    // sessizce uygulanmaz — kullanıcı açıkça onaylamadan (confirmContextOverride)
    // AI'ya gidilmez. Onaylansa bile validateScenarioAgainstContext (aşağıda,
    // generateScenario içinde) teknik/fiziksel çelişkileri yine engeller —
    // bu onay yalnızca "bu tercihi denemek istiyorum" anlamına gelir, ürünün
    // gerçek montaj mantığını geçersiz kılmaz.
    if (userNotes && detectsContextConflict(userNotes, usageContext) && !body.confirmContextOverride) {
      return response.status(200).json({
        ok: true,
        needsContextConfirmation: true,
        usageContext,
        message: `Yazdığınız not, "${product.title}" ürününün gerçek kullanım yeriyle (${INSTALLATION_CONTEXT_LABELS[usageContext]}) çelişiyor gibi görünüyor. Devam etmek isterseniz onaylayın — yine de ürünün fiziksel montaj gerçeğiyle (boru bağlantısı, kurulum yeri) çelişen öğeler sahneye eklenmeyecektir.`
      });
    }

    const scenario = await generateScenario(provider, product, process.env, { usageContext, userNotes, fixNote: typeof body.fixNote === "string" ? body.fixNote : "" });
    return response.status(200).json({ ok: true, scenario, usageContext, usageContextLabel: INSTALLATION_CONTEXT_LABELS[usageContext], product });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
