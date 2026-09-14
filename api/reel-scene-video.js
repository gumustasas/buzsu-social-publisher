import "dotenv/config";
import { getSession } from "../src/auth.js";
import { submitVeoVideo } from "../src/veo-video.js";
import { normalizeVeoPrompt, normalizeVeoDurationSeconds, REEL_ASPECT_RATIOS } from "../src/lib/reel-script-schema.js";

// AI Reels V2 PR-E — PR-D'nin sahne onay ekranını (dashboard-reels-v2.js,
// Step 5) MEVCUT Veo altyapısına (submitVeoVideo, bkz. src/veo-video.js;
// zaten api/reels.js ve api/mcp.js:generate_video_clip tarafından kullanılıyor)
// bağlayan TEK yeni endpoint. Yeni bir Veo/AI sistemi YAZILMADI — burada
// yalnızca sahne bazlı parametreler doğrulanıp submitVeoVideo'ya aktarılıyor.
//
// Durum sorgulama İÇİN YENİ BİR ENDPOINT EKLENMEDİ — mevcut api/veo-video.js
// (job/operationName tabanlı, Vercel Blob'a indirip herkese açık videoUrl
// üreten) olduğu gibi, değişiklik yapılmadan reuse edilir (bkz. §10).
//
// confirmed:true kontrolü burada api/reels.js'in (yalnızca client-side onay)
// AKSİNE, api/mcp.js:generate_video_clip ile AYNI, SUNUCU tarafında zorunlu
// kılınır — Veo gerçek para harcayan bir çağrı olduğu için ilk istekte asla
// tetiklenmemesi gerekir.
export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});

    const sceneId = String(body.sceneId || "").trim();
    if (!sceneId) throw new Error("sceneId gerekli.");

    // GERÇEK PARA HARCAR — confirmed:true olmadan submitVeoVideo HİÇ
    // ÇAĞRILMAZ. Onaylanmamış/onaysız bir sahne için de aynı kural geçerli;
    // dashboard bu isteği yalnız approvedScenes[sceneId]===true iken
    // gönderir (bkz. dashboard-reels-v2.js), burada ayrıca approved
    // bayrağının da true olması istenir (savunma amaçlı ikinci kat).
    if (body.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar (Google Veo). Onaylamak için confirmed:true gönderin.");
    if (body.approved !== true) throw new Error("Bu sahne henüz onaylanmamış — önce Sahne Onayı adımında sahneyi doğrulayıp onaylayın.");

    const referenceImageUrl = String(body.referenceImageUrl || "").trim();
    if (!/^https:\/\//i.test(referenceImageUrl)) throw new Error("referenceImageUrl herkese açık HTTPS URL olmalı.");

    const rawPrompt = String(body.veoPrompt || "").trim();
    if (!rawPrompt) throw new Error("veoPrompt boş olamaz.");
    // PR-D'de zaten normalize edilmiş (server-side onaylanmış) veoPrompt
    // BİREBİR kullanılır — burada AI ile YENİDEN YAZILMAZ. normalizeVeoPrompt
    // idempotent bir string işlemidir (regex ile "zaten var mı" kontrolü
    // yapar), bu yüzden tekrar çağrılması promptu bozmaz — yalnızca client
    // tarafında bir şekilde eksik kalmış olabilecek kısıtları savunma amaçlı
    // garanti eder (bkz. §4/§5).
    const referenceImageRequired = body.referenceImageRequired === true;
    const finalizedPrompt = normalizeVeoPrompt(rawPrompt, referenceImageRequired);

    const aspectRatio = REEL_ASPECT_RATIOS.includes(body.aspectRatio) ? body.aspectRatio : "9:16";
    // Veo sahne klipleri yalnızca 4, 6 veya 8 saniye kabul ediyor. Model senaryoda
    // 3 saniyelik bir sahne üretse bile ücretli provider çağrısını geçersiz
    // duration ile boşa harcamamak için sınırı sunucu tarafında deterministik
    // uygula. Prompt/validator katmanı da gelecekteki senaryoları 4–8 saniyeye
    // yönlendirir; bu clamp son savunma katmanıdır.
    const requestedDurationSeconds = Number.isFinite(Number(body.durationSeconds)) && Number(body.durationSeconds) > 0
      ? Math.round(Number(body.durationSeconds))
      : undefined;
    const durationSeconds = requestedDurationSeconds === undefined
      ? undefined
      : normalizeVeoDurationSeconds(requestedDurationSeconds);
    const resolution = ["720p", "1080p"].includes(body.resolution) ? body.resolution : undefined;

    const job = await submitVeoVideo(
      { imageUrl: referenceImageUrl, title: body.sceneTitle || sceneId },
      process.env,
      { finalizedPrompt, aspectRatio, durationSeconds, resolution, model: body.model }
    );
    return response.status(200).json({ ok: true, sceneId, veo: job });
  } catch (error) {
    console.error(error);
    // RATE_LIMITED (bkz. src/veo-video.js:VeoApiError) — api/veo-video.js ve
    // api/reels.js ile AYNI normalize edilmiş 429 sözleşmesi.
    if (error.code === "RATE_LIMITED") return response.status(429).json({ ok: false, ...error.toJSON() });
    return response.status(500).json({ ok: false, error: error.message });
  }
}
