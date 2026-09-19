import sharp from "sharp";
import { fetchPublicImage } from "../lib/upload-media.js";

// TASK-011 manifest error_context.required_fields: [scene_index,
// original_url, failure_stage, stable_error_code] (örnek: {code:
// INVALID_SCENE_IMAGE, stage: decode}) — manifest'in KENDİ verdiği
// snake_case alan adları BİREBİR korunuyor (TASK-008'de olduğu gibi: bir
// manifest açıkça belirli alan adları verdiğinde bu depo genelindeki
// camelCase konvansiyonu o alan için ezilmez).
export class InvalidSceneImageError extends Error {
  constructor(message, { scene_index, original_url, failure_stage, cause } = {}) {
    super(message);
    this.name = "InvalidSceneImageError";
    this.stable_error_code = "INVALID_SCENE_IMAGE";
    this.scene_index = scene_index;
    this.original_url = original_url;
    this.failure_stage = failure_stage;
    if (cause) this.cause = cause;
  }
}

// Signed URL query/hash sızıntısını önlemek için (bkz. scripts/render-
// product-video.mjs'teki AYNI teknik, TASK-010) — bağımsız bir kopya:
// TASK-011 manifest'i compose_cinematic_reel'in compose_product_video'dan
// mimari olarak TAMAMEN bağımsız olmasını istiyor, bu küçük güvenlik
// yardımcısının kopyalanması bu depoda zaten kabul edilen bir konvansiyon
// (bkz. redactSecrets'ın ~6-7 bağımsız kopyası).
export function redactSceneUrlForLog(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[geçersiz URL]";
  }
}

// Ürün fotoğrafları çoğunlukla kare/yatay geliyor — hedef canvas'a (9:16/
// 1:1/16:9) doğrudan "cover" ile sığdırmak görselin büyük kısmını kırpar.
// compose_product_video'daki (src/post-branding.js composeFramedBackground)
// AYNI teknik: hiçbir parça kaybolmadan "contain" ile ortala, boşluğu aynı
// görselin bulanıklaştırılmış büyük hâliyle doldur. BAĞIMSIZ bir kopya
// (post-branding.js import edilmiyor — TASK-011 mimari olarak ayrı).
async function frameSceneImage(buffer, width, height, { sharpImpl = sharp } = {}) {
  const background = await sharpImpl(buffer)
    .resize(width, height, { fit: "cover" })
    .blur(Math.round(width * 0.045))
    .modulate({ brightness: 0.55 })
    .toBuffer();
  const foreground = await sharpImpl(buffer)
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  return sharpImpl(background).composite([{ input: foreground }]).png().toBuffer();
}

// downloadAndNormalizeSceneImage: TASK-010'un sertleştirilmiş fetchPublicImage
// yolunu (SSRF/DNS + MIME + magic-byte + decode doğrulaması) AYNEN kullanır
// — BYPASS EDİLMEZ, DEĞİŞTİRİLMEZ. Sonucu (hangi formatta gelirse gelsin —
// PNG/JPEG/WebP) her zaman normalize edilmiş bir PNG buffer'a çevirir, bu
// yüzden render motoru orijinal uzak dosya uzantısına HİÇ bağımlı değildir
// (manifest şartı). Geçersiz bir sahne görseli TÜM render'dan ÖNCE, burada
// sahne bağlamıyla (scene_index/original_url/failure_stage) fırlar.
export async function downloadAndNormalizeSceneImage(scene, sceneIndex, {
  width,
  height,
  fetchPublicImageImpl = fetchPublicImage,
  sharpImpl = sharp
} = {}) {
  let rawBuffer;
  try {
    ({ buffer: rawBuffer } = await fetchPublicImageImpl(scene.imageUrl));
  } catch (error) {
    // fetchPublicImage'ın kendi INVALID_IMAGE_INPUT hatası (.code/.reason)
    // AYNEN korunur (cause olarak) — yalnızca sahne bağlamı eklenir, birincil
    // teşhis olarak ham/alt seviye hata SIZDIRILMAZ (TASK-010 ile AYNI ilke).
    const stage = error?.code === "INVALID_IMAGE_INPUT" ? "validate" : "fetch";
    throw new InvalidSceneImageError(
      `scenes[${sceneIndex}] (${redactSceneUrlForLog(scene.imageUrl)}): ${error.message}`,
      { scene_index: sceneIndex, original_url: redactSceneUrlForLog(scene.imageUrl), failure_stage: stage, cause: error }
    );
  }

  try {
    return await frameSceneImage(rawBuffer, width, height, { sharpImpl });
  } catch (error) {
    throw new InvalidSceneImageError(
      `scenes[${sceneIndex}] (${redactSceneUrlForLog(scene.imageUrl)}): sahne görseli normalize edilemedi.`,
      { scene_index: sceneIndex, original_url: redactSceneUrlForLog(scene.imageUrl), failure_stage: "normalize", cause: error }
    );
  }
}
