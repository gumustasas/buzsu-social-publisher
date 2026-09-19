import { fetchPublicImage, decodeImageBase64 } from "../lib/upload-media.js";
import { compareProductVisuals } from "./gemini-compare.js";
import { VISUAL_VALIDATION_CHECKS, normalizeFailedChecks } from "./checks.js";

// TASK-004 (validate_product_visual): AI ile üretilmiş bir sahne görselini,
// ürünün GERÇEK referans fotoğrafıyla doğrudan karşılaştırır — src/lib/
// scene-validation.js'teki mevcut "Faz 1" kontrolünün (yalnızca metin
// bağlamına karşı, tek görsel) AKSİNE, burada İKİ görsel karşılaştırılır.
// Bu, generate_scene_image/generate_nano_banana_scene'in VARSAYILAN akışına
// dahil DEĞİLDİR — ayrı, isteğe bağlı bir MCP tool'udur (bkz. api/mcp.js
// validate_product_visual); mevcut sahne üretim davranışı DEĞİŞMEZ.
//
// KARAR İLKESİ: "no arbitrary single confidence score" — passed/needsReview
// modelin bir güven puanından DEĞİL, sabit VISUAL_VALIDATION_CHECKS listesine
// karşı normalize edilmiş failedChecks dizisinden türetilir (bkz. checks.js).
export { VISUAL_VALIDATION_CHECKS };

function assertGeneratedImageInput(input) {
  const generatedImageUrl = input.generatedImageUrl ? String(input.generatedImageUrl).trim() : "";
  const hasBase64 = typeof input.generatedImageBase64 === "string" && input.generatedImageBase64.trim().length > 0;
  if (!generatedImageUrl && !hasBase64) {
    throw new Error('"generatedImageUrl" veya "generatedImageBase64" alanlarından biri gerekli.');
  }
  if (generatedImageUrl && hasBase64) {
    throw new Error('"generatedImageUrl" ve "generatedImageBase64" birlikte verilemez, yalnızca birini gönderin.');
  }
  return { generatedImageUrl, hasBase64 };
}

export async function validateProductVisual(input = {}, env = process.env, deps = {}) {
  const referenceImageUrl = String(input.referenceImageUrl || "").trim();
  if (!referenceImageUrl) throw new Error('"referenceImageUrl" gerekli.');
  const { generatedImageUrl, hasBase64 } = assertGeneratedImageInput(input);

  const {
    fetchPublicImageImpl = fetchPublicImage,
    decodeImageBase64Impl = decodeImageBase64,
    compareImpl = compareProductVisuals
  } = deps;

  const reference = await fetchPublicImageImpl(referenceImageUrl, deps);
  const generated = generatedImageUrl
    ? await fetchPublicImageImpl(generatedImageUrl, deps)
    : { buffer: decodeImageBase64Impl(input.generatedImageBase64, input.generatedImageMimeType), mimeType: input.generatedImageMimeType };

  const raw = await compareImpl(
    {
      referenceBuffer: reference.buffer,
      referenceMimeType: reference.mimeType,
      generatedBuffer: generated.buffer,
      generatedMimeType: generated.mimeType,
      productTitle: input.productTitle,
      sceneDescription: input.sceneDescription
    },
    env,
    deps
  );

  const failedChecks = normalizeFailedChecks(raw.failedChecks);
  return {
    passed: failedChecks.length === 0,
    needsReview: failedChecks.length > 0,
    checks: VISUAL_VALIDATION_CHECKS,
    failedChecks,
    notes: typeof raw.notes === "string" ? raw.notes : ""
  };
}
