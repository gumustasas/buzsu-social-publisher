import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableProviders, generateReelPackage, generateMotionPlan } from "../src/ai-providers.js";
import { availableSceneProviders } from "../src/scene-image.js";
import { submitFalVideo, MAX_FAL_PROMPT_LENGTH } from "../src/fal-video.js";
import { submitVeoVideo } from "../src/veo-video.js";
import { submitOmniVideoGeneration } from "../src/omni-video.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { buildVideoPromptSections, renderVideoPrompt, hashVideoPrompt } from "../src/lib/video-prompt.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";

import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";
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
      if (body.provider !== "fal" && body.provider !== "veo" && body.provider !== "omni") return response.status(400).json({ error: "Önizleme yalnızca fal.ai, Veo veya Omni için kullanılabilir." });
      const freePrompt = typeof body.freePrompt === "string" ? body.freePrompt.trim() : "";
      // Omni sıfırdan (zero-shot) üretim: serbest metin promptu doluysa ve
      // hiçbir productId verilmemişse ürün çözümlemesi TAMAMEN atlanır —
      // freePrompt zaten birebir/olduğu gibi gönderiliyor (aşağıdaki
      // "if (freePrompt)" dalı), ürün başlığına hiç ihtiyaç yok. fal.ai/Veo
      // için bu istisna YOKTUR (ikisi de image-to-video, ürün/görsel şart).
      const skipProductForOmni = body.provider === "omni" && Boolean(freePrompt) && !body.productId;
      let title = "";
      if (!skipProductForOmni) {
        const previewProduct = await resolveProduct(body.productId);
        if (!previewProduct) return response.status(400).json({ error: "Ürün bulunamadı." });
        title = previewProduct.title;
      }
      let motion = typeof body.motion === "string" ? body.motion.trim() : "";
      let motionSource = "user";
      // Serbest metin doluysa REFERENCE/PRESERVE/MOTION/CAMERA/CONSTRAINTS
      // şablonu tamamen atlanır; kullanıcının yazdığı metin fal.ai/Veo'ya
      // birebir, olduğu gibi gönderilir (bkz. src/fal-video.js,
      // src/veo-video.js — finalizedPrompt zaten olduğu gibi kullanılıyordu).
      let prompt;
      if (freePrompt) {
        prompt = freePrompt;
        motion = "";
        motionSource = "free";
      } else {
        if (!motion) {
          const textProvider = availableSceneProviders(process.env)[0];
          if (!textProvider) return response.status(400).json({ error: "Hareket alanı boş ve OPENAI_API_KEY/GEMINI_API_KEY tanımlı değil — hareketi elle yazmalısınız." });
          motion = await generateMotionPlan(textProvider, body.sceneDescription, process.env);
          motionSource = "ai";
        }
        const sections = buildVideoPromptSections({ productTitle: title, motion, allowNativeAudio: body.allowNativeAudio === true });
        prompt = renderVideoPrompt(sections);
      }
      // Bu, sadece fal.ai'nin kendi API sınırı (fal-ai/minimax-video/
      // image-to-video prompt alanı en fazla 2000 karakter kabul ediyor,
      // gerçek denemede görülen hata: "String should have at most 2000
      // characters"). Veo'nun böyle bir sınırı yok, bu yüzden yalnızca
      // provider fal iken erkenden (ücretsiz önizleme sırasında) uyarıyoruz;
      // asıl koruma src/fal-video.js:submitFalVideo içinde.
      if (body.provider === "fal" && prompt.length > MAX_FAL_PROMPT_LENGTH) {
        const hint = freePrompt ? "Serbest metin promptunu kısaltıp" : "Hareket açıklamasını kısaltıp";
        return response.status(400).json({ error: `Video prompt'u çok uzun (${prompt.length}/${MAX_FAL_PROMPT_LENGTH} karakter, fal.ai sınırı). ${hint} tekrar önizle.` });
      }
      const promptId = hashVideoPrompt(prompt);
      return response.status(200).json({ ok: true, preview: { promptId, prompt, motion, motionSource } });
    }

    if (!providers.includes(body.provider)) return response.status(400).json({ error: "Seçilen AI sağlayıcısının API anahtarı Vercel'de tanımlı değil." });
    // Kompozerde önceden bir AI sahne görseli üretilip kalıcı bir URL aldıysa
    // (bkz. api/scene-image.js), video bunun üzerinden üretilsin — kullanıcı
    // önizlediği sahneyi baz almak istiyor, ham ürün fotoğrafını değil. Bu,
    // fotoğrafı Airtable'da olmayan (katalog) ürünler için TEK görsel
    // kaynağıdır — onlarda resolvedProduct.imageUrl boştur.
    const sceneImageUrl = typeof body.sceneImageUrl === "string" && /^https:\/\//i.test(body.sceneImageUrl) ? body.sceneImageUrl : null;
    // Omni sıfırdan (zero-shot) üretim: productId verilmemiş VE bir sahne
    // görseli de istenmemişse ürün çözümlemesi/görsel zorunluluğu TAMAMEN
    // atlanır — submitOmniVideoGeneration referenceImageUrl'siz de çalışır
    // (bkz. src/omni-video.js). fal.ai/Veo için bu istisna YOKTUR (ikisi de
    // image-to-video, ürün/görsel her zaman şart).
    const skipProductForOmni = body.provider === "omni" && !body.productId && !sceneImageUrl;
    let product = null;
    if (!skipProductForOmni) {
      const resolvedProduct = await resolveProduct(body.productId);
      if (!resolvedProduct || !resolvedProduct.url) return response.status(400).json({ error: "Ürün URL bilgisi eksik." });
      const imageUrl = sceneImageUrl || resolvedProduct.imageUrl;
      if (!imageUrl) return response.status(400).json({ error: "Ürün görseli eksik — önce üstte bir AI sahne görseli üretip \"Sahneyi baz alarak video üret\" kutusunu işaretleyin." });
      product = { title: resolvedProduct.title, url: resolvedProduct.url, imageUrl };
    }

    if (body.provider === "fal" || body.provider === "veo" || body.provider === "omni") {
      // Video üretimi her zaman önce "preview" ile kurulmuş bir snapshot
      // gerektirir; prompt burada YENİDEN KURULMAZ, sadece hash doğrulanıp
      // olduğu gibi provider'a gönderilir — provider değişse (fal↔veo↔omni)
      // bile aynı finalizedPrompt kullanılır, AI ile yeniden üretilmez.
      const finalizedPrompt = typeof body.finalizedPrompt === "string" ? body.finalizedPrompt.trim() : "";
      const promptId = typeof body.promptId === "string" ? body.promptId : "";
      if (!finalizedPrompt || !promptId) return response.status(400).json({ error: "Önce \"Video promptunu önizle\" ile bir prompt oluşturun." });
      if (hashVideoPrompt(finalizedPrompt) !== promptId) return response.status(400).json({ error: "Prompt değişmiş görünüyor — lütfen tekrar önizleyin." });
      // Model/tier seçimi YALNIZCA Veo için anlamlı (fal.ai'de/Omni'de tier
      // kavramı yok) — dashboard #veo-model-tier alanından body.model olarak
      // gönderiyor; body.profile aynı alanın bir eşanlamlısı olarak da
      // kabul edilir. Bu, prompt hash'ine (promptId) hiç dahil değil —
      // model değişmesi promptun kendisini değiştirmiyor, o yüzden hash
      // doğrulaması yukarıda değişmeden kalıyor. Provider seçildiyse ASLA
      // başka bir provider'a sessizce geçilmez (fal/veo/omni birbirinden
      // tamamen ayrı çağrılır) — bu if/else zinciri buna göre yazıldı.
      const modelOverride = body.provider === "veo" ? (body.model || body.profile) : undefined;
      // Omni'nin confirmed:true zorunluluğu (bkz. src/omni-video.js) burada
      // sabit true'dur — bu satıra ulaşılması, kullanıcının dashboard'daki
      // iki tıklamalı "Emin misin?" onayını (fal/veo ile AYNI UX) zaten
      // geçtiği anlamına gelir; MCP tarafında ise generate_gemini_video
      // kendi confirmed kontrolünü çağırandan (args.confirmed) okur.
      const job = body.provider === "fal"
        ? await submitFalVideo(product, process.env, { finalizedPrompt })
        : body.provider === "veo"
          ? await submitVeoVideo(product, process.env, { finalizedPrompt, model: modelOverride })
          : await submitOmniVideoGeneration(finalizedPrompt, process.env, { referenceImageUrl: product?.imageUrl, confirmed: true });
      console.log(JSON.stringify({ event: "video-prompt-sent", promptId, provider: body.provider, model: job.model, productId: body.productId, at: new Date().toISOString() }));
      return response.status(200).json({ ok: true, [body.provider]: job });
    }

    const reel = await generateReelPackage(body.provider, product);
    return response.status(200).json({ ok: true, reel });
  } catch (error) {
    console.error(error);
    if (error.code === "RATE_LIMITED") return response.status(429).json({ ok: false, ...error.toJSON() });
    return response.status(500).json({ ok: false, error: error.message });
  }
}
