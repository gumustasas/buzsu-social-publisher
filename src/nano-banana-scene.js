import { put } from "@vercel/blob";
import { generateSceneImage, callGeminiTextToImage } from "./scene-image.js";
import { validateSceneImage } from "./lib/scene-validation.js";

const ASPECT_RATIOS = new Set(["9:16", "1:1", "16:9"]);

// Nano Banana 2 iki-aşamalı akışın YALNIZCA 1. aşamasıdır (sahne görseli).
// confirmed:true olmadan HİÇBİR ağ isteği (Gemini görsel çağrısı) yapılmaz —
// generate_video_clip/generate_omni_video_edit ile AYNI konvansiyon (bkz.
// api/mcp.js). Video (Veo/Omni) bu fonksiyondan HİÇBİR ŞEKİLDE çağrılmaz;
// kullanıcı burada üretilen imageUrl'i ayrı, açık bir ikinci adımda
// generate_video_clip/generate_omni_video_edit'e kendisi verir.
export async function generateNanoBananaScene({ product = null, prompt, aspectRatio, confirmed } = {}, env = process.env) {
  if (confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar (Nano Banana 2 görsel üretimi). Onaylamak için confirmed:true gönderin.");
  const trimmedPrompt = String(prompt || "").trim();
  if (!trimmedPrompt) throw new Error("prompt (sahne açıklaması) boş olamaz.");
  const ratio = ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "9:16";

  let dataUrl, model, rawBuffer;
  let needsReview = false, failedChecks = [], reviewNotes = "", checked = false;

  if (product) {
    const scene = await generateSceneImage(product, trimmedPrompt, env, { provider: "nano-banana-2", aspectRatio: ratio });
    dataUrl = scene.dataUrl;
    model = scene.model;
    rawBuffer = Buffer.from(dataUrl.split(",")[1], "base64");
    // Ürün-referanslı üretimde mevcut otomatik inceleme sistemi (bkz.
    // src/lib/scene-validation.js) AYNEN yeniden kullanılır — bu Faz 1
    // sistemiyle aynı şekilde yalnızca raporlar, ama bu tool'un çağıranı
    // (dashboard) needsReview:true iken video aşamasına geçmeden önce ayrı
    // bir onay istemekle YÜKÜMLÜDÜR (bkz. dashboard.html Nano Banana paneli).
    const validation = await validateSceneImage(rawBuffer, { sceneDescription: trimmedPrompt, productTitle: product.title }, env);
    needsReview = validation.needsReview;
    failedChecks = validation.failedChecks;
    reviewNotes = validation.notes;
    checked = validation.checked;
  } else {
    const result = await callGeminiTextToImage({ prompt: trimmedPrompt, aspectRatio: ratio }, env);
    dataUrl = `data:image/png;base64,${result.imageBase64}`;
    model = result.model;
    rawBuffer = Buffer.from(result.imageBase64, "base64");
    reviewNotes = "Ürün referansı verilmediği (sıfırdan/zero-shot) için otomatik ürün kimliği kontrolü uygulanmadı.";
  }

  let imageUrl = dataUrl;
  let uploaded = false;
  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`ai-nano-banana/scene-${Date.now()}.png`, rawBuffer, { access: "public", contentType: "image/png" });
    imageUrl = blob.url;
    uploaded = true;
  }

  return {
    ok: true,
    model,
    provider: "nano-banana-2",
    mode: product ? "product-reference" : "zero-shot",
    imageUrl,
    uploaded,
    prompt: trimmedPrompt,
    aspectRatio: ratio,
    needsReview,
    failedChecks,
    reviewNotes,
    checked
  };
}
