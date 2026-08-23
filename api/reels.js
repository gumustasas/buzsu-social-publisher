import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableProviders, generateReelPackage, generateMotionPlan } from "../src/ai-providers.js";
import { availableSceneProviders } from "../src/scene-image.js";
import { submitFalVideo, MAX_FAL_PROMPT_LENGTH } from "../src/fal-video.js";
import { submitVeoVideo } from "../src/veo-video.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { buildVideoPromptSections, renderVideoPrompt, hashVideoPrompt } from "../src/lib/video-prompt.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

// llms-full.txt kataloğundan gelen (henüz Airtable kaydı olmayan) ürünler
// için Kaynak URL/Görsel URL Airtable'da yok — bkz. api/scene-image.js'teki
// aynı desen. Dönen imageUrl boş olabilir (katalog ürünlerinin fotoğrafı
// yok); çağıran taraf sceneImageUrl/manualImageUrl ile tamamlamalı.
async function resolveProduct(productId) {
  if (isCatalogProductId(productId)) {
    const catalogProduct = await findCatalogProduct(productId);
    if (!catalogProduct) return null;
    return { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", url: catalogProduct.url, imageUrl: catalogProduct.imageUrl || "" };
  }
  const data = await airtable();
  const record = (data.records || []).find((item) => item.id === productId);
  if (!record) return null;
  const fields = record.fields || {};
  return { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", url: fields["Kaynak URL"] || "", imageUrl: fields["Görsel URL"] || "" };
}

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    const providers = availableProviders();
    if (request.method === "GET") return response.status(200).json({ ok: true, providers });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});

    // Video prompt önizleme: fal.ai/Veo'ya HİÇBİR istek atmadan (ücretsiz),
    // kullanıcının göreceği prompt ile üretim sırasında gönderilecek
    // promptun birebir aynı olmasını garanti eden bir snapshot (promptId)
    // üretir. Provider'dan bağımsızdır — ikisi de aynı promptu kullanır.
    if (body.action === "preview") {
      if (body.provider !== "fal" && body.provider !== "veo") return response.status(400).json({ error: "Önizleme yalnızca fal.ai veya Veo için kullanılabilir." });
      const previewProduct = await resolveProduct(body.productId);
      if (!previewProduct) return response.status(400).json({ error: "Ürün bulunamadı." });
      const title = previewProduct.title;
      let motion = typeof body.motion === "string" ? body.motion.trim() : "";
      let motionSource = "user";
      if (!motion) {
        const textProvider = availableSceneProviders(process.env)[0];
        if (!textProvider) return response.status(400).json({ error: "Hareket alanı boş ve OPENAI_API_KEY/GEMINI_API_KEY tanımlı değil — hareketi elle yazmalısınız." });
        motion = await generateMotionPlan(textProvider, body.sceneDescription, process.env);
        motionSource = "ai";
      }
      const sections = buildVideoPromptSections({ productTitle: title, motion });
      const prompt = renderVideoPrompt(sections);
      // Bu, sadece fal.ai'nin kendi API sınırı (fal-ai/minimax-video/
      // image-to-video prompt alanı en fazla 2000 karakter kabul ediyor,
      // gerçek denemede görülen hata: "String should have at most 2000
      // characters"). Veo'nun böyle bir sınırı yok, bu yüzden yalnızca
      // provider fal iken erkenden (ücretsiz önizleme sırasında) uyarıyoruz;
      // asıl koruma src/fal-video.js:submitFalVideo içinde.
      if (body.provider === "fal" && prompt.length > MAX_FAL_PROMPT_LENGTH) {
        return response.status(400).json({ error: `Video hareketi metni çok uzun (toplam prompt ${prompt.length}/${MAX_FAL_PROMPT_LENGTH} karakter, fal.ai sınırı). Hareket açıklamasını kısaltıp tekrar önizle.` });
      }
      const promptId = hashVideoPrompt(prompt);
      return response.status(200).json({ ok: true, preview: { promptId, prompt, motion, motionSource } });
    }

    if (!providers.includes(body.provider)) return response.status(400).json({ error: "Seçilen AI sağlayıcısının API anahtarı Vercel'de tanımlı değil." });
    const resolvedProduct = await resolveProduct(body.productId);
    if (!resolvedProduct || !resolvedProduct.url) return response.status(400).json({ error: "Ürün URL bilgisi eksik." });
    // Kompozerde önceden bir AI sahne görseli üretilip kalıcı bir URL aldıysa
    // (bkz. api/scene-image.js), video bunun üzerinden üretilsin — kullanıcı
    // önizlediği sahneyi baz almak istiyor, ham ürün fotoğrafını değil. Bu,
    // fotoğrafı Airtable'da olmayan (katalog) ürünler için TEK görsel
    // kaynağıdır — onlarda resolvedProduct.imageUrl boştur.
    const sceneImageUrl = typeof body.sceneImageUrl === "string" && /^https:\/\//i.test(body.sceneImageUrl) ? body.sceneImageUrl : null;
    const imageUrl = sceneImageUrl || resolvedProduct.imageUrl;
    if (!imageUrl) return response.status(400).json({ error: "Ürün görseli eksik — önce üstte bir AI sahne görseli üretip \"Sahneyi baz alarak video üret\" kutusunu işaretleyin." });
    const product = { title: resolvedProduct.title, url: resolvedProduct.url, imageUrl };

    if (body.provider === "fal" || body.provider === "veo") {
      // Video üretimi her zaman önce "preview" ile kurulmuş bir snapshot
      // gerektirir; prompt burada YENİDEN KURULMAZ, sadece hash doğrulanıp
      // olduğu gibi provider'a gönderilir — provider değişse (fal↔veo) bile
      // aynı finalizedPrompt kullanılır, AI ile yeniden üretilmez.
      const finalizedPrompt = typeof body.finalizedPrompt === "string" ? body.finalizedPrompt.trim() : "";
      const promptId = typeof body.promptId === "string" ? body.promptId : "";
      if (!finalizedPrompt || !promptId) return response.status(400).json({ error: "Önce \"Video promptunu önizle\" ile bir prompt oluşturun." });
      if (hashVideoPrompt(finalizedPrompt) !== promptId) return response.status(400).json({ error: "Prompt değişmiş görünüyor — lütfen tekrar önizleyin." });
      const submit = body.provider === "fal" ? submitFalVideo : submitVeoVideo;
      const job = await submit(product, process.env, { finalizedPrompt });
      console.log(JSON.stringify({ event: "video-prompt-sent", promptId, provider: body.provider, model: job.model, productId: body.productId, at: new Date().toISOString() }));
      return response.status(200).json({ ok: true, [body.provider]: job });
    }

    const reel = await generateReelPackage(body.provider, product);
    return response.status(200).json({ ok: true, reel });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
