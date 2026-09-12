import crypto from "node:crypto";
import { writeVideoJobStatus, readVideoJobStatus } from "./lib/video-jobs.js";
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME, VIDEO_RENDER_WORKFLOW_FILE, VIDEO_RENDER_REF } from "./lib/config.js";
import { MUSIC_CATEGORIES, pickMusicTrack } from "./lib/music-catalog.js";

// compose_product_video (bkz. api/mcp.js), Vercel'in serverless süre/bellek
// sınırları FFmpeg render'ı için riskli olduğundan (bkz. PR açıklaması —
// Fluid Compute olmadan klasik Pro planında 15sn sınırı var), gerçek
// render'ı Vercel'de DEĞİL, GitHub Actions'ın ücretsiz workflow_dispatch
// kuyruğunda çalıştırır (bkz. .github/workflows/render-product-video.yml,
// scripts/render-product-video.mjs). workflow_dispatch API'si 204 No Content
// döner — bir "run ID" vermez — bu yüzden iş durumu GitHub'ı sorgulamak
// yerine Vercel Blob'daki video-jobs/<jobId>.json dosyasından okunur
// (bkz. src/lib/video-jobs.js).
export const MIN_MEDIA_ITEMS = 2;
export const MAX_MEDIA_ITEMS = 10;
export const MIN_DURATION_PER_IMAGE_SECONDS = 1.0;
export const MAX_DURATION_PER_IMAGE_SECONDS = 3.0;
export const DEFAULT_DURATION_PER_IMAGE_SECONDS = 1.8;
export const MIN_TRANSITION_DURATION_SECONDS = 0.2;
export const MAX_TRANSITION_DURATION_SECONDS = 1.0;
export const DEFAULT_TRANSITION_DURATION_SECONDS = 0.4;
export const ALLOWED_TRANSITIONS = new Set(["fade", "wipe"]);
export const MAX_TITLE_LENGTH = 60;

// Burada yalnızca söz dizimi (yalnızca HTTPS) doğrulanır — gerçek DNS/SSRF
// kontrolü ve indirme, bu URL'lerin fiilen fetch edildiği yerde
// (scripts/render-product-video.mjs içinde fetchPublicImage/fetchPublicAudio,
// bkz. src/lib/upload-media.js) yapılır. Vercel bu aşamada hiçbir dış
// isteği kendisi yapmaz; workflow_dispatch'e yalnızca jobId gönderilir, tüm
// payload video-jobs/<jobId>.json'a yazılır ve worker onu okur.
function assertHttpsUrlSyntax(rawUrl, label) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error(`${label} geçerli bir URL değil.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} yalnızca HTTPS olabilir.`);
  return url.toString();
}

function normalizeTitle(title) {
  if (title === undefined || title === null) return "";
  const trimmed = String(title).trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Error(`Ürün adı en fazla ${MAX_TITLE_LENGTH} karakter olabilir: "${trimmed.slice(0, 30)}..."`);
  }
  return trimmed;
}

// compose_product_video'nun ham MCP argümanlarını doğrulayıp normalize
// edilmiş, GitHub Actions worker'ına aynen aktarılacak bir job payload'una
// çevirir. Ağ/IO içermez — bağımsız test edilebilir.
export function validateComposeInput(args = {}, { randomImpl = Math.random } = {}) {
  const mediaItemsInput = args.mediaItems;
  if (!Array.isArray(mediaItemsInput) || mediaItemsInput.length < MIN_MEDIA_ITEMS || mediaItemsInput.length > MAX_MEDIA_ITEMS) {
    throw new Error(`mediaItems en az ${MIN_MEDIA_ITEMS}, en fazla ${MAX_MEDIA_ITEMS} öğe içermelidir.`);
  }
  const mediaItems = mediaItemsInput.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`mediaItems[${index}] geçersiz.`);
    const imageUrl = assertHttpsUrlSyntax(item.imageUrl, `mediaItems[${index}].imageUrl`);
    const title = normalizeTitle(item.title);
    return { imageUrl, title };
  });

  const durationPerImageSeconds = args.durationPerImageSeconds === undefined
    ? DEFAULT_DURATION_PER_IMAGE_SECONDS
    : Number(args.durationPerImageSeconds);
  if (!Number.isFinite(durationPerImageSeconds) || durationPerImageSeconds < MIN_DURATION_PER_IMAGE_SECONDS || durationPerImageSeconds > MAX_DURATION_PER_IMAGE_SECONDS) {
    throw new Error(`durationPerImageSeconds ${MIN_DURATION_PER_IMAGE_SECONDS}-${MAX_DURATION_PER_IMAGE_SECONDS} aralığında olmalıdır.`);
  }

  const transition = args.transition === undefined ? "fade" : String(args.transition);
  if (!ALLOWED_TRANSITIONS.has(transition)) {
    throw new Error(`transition şunlardan biri olmalıdır: ${[...ALLOWED_TRANSITIONS].join(", ")}.`);
  }

  const transitionDurationSeconds = args.transitionDurationSeconds === undefined
    ? DEFAULT_TRANSITION_DURATION_SECONDS
    : Number(args.transitionDurationSeconds);
  if (!Number.isFinite(transitionDurationSeconds) || transitionDurationSeconds < MIN_TRANSITION_DURATION_SECONDS || transitionDurationSeconds > MAX_TRANSITION_DURATION_SECONDS) {
    throw new Error(`transitionDurationSeconds ${MIN_TRANSITION_DURATION_SECONDS}-${MAX_TRANSITION_DURATION_SECONDS} aralığında olmalıdır.`);
  }
  if (transitionDurationSeconds >= durationPerImageSeconds) {
    throw new Error("transitionDurationSeconds, durationPerImageSeconds'tan küçük olmalıdır.");
  }

  const closing = {};
  if (args.closingTitle !== undefined) closing.title = normalizeTitle(args.closingTitle) || undefined;
  if (args.closingSubtitle !== undefined) closing.subtitle = normalizeTitle(args.closingSubtitle) || undefined;

  const musicVolume = args.musicVolume === undefined ? 0.5 : Number(args.musicVolume);
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) {
    throw new Error("musicVolume 0-1 aralığında olmalıdır.");
  }

  let musicUrl;
  if (typeof args.musicUrl === "string" && args.musicUrl.trim()) {
    musicUrl = assertHttpsUrlSyntax(args.musicUrl, "musicUrl");
  } else {
    // musicUrl verilmezse video sessiz çıkmasın diye ÜCRETSİZ bir arka plan
    // müziği otomatik seçilir (bkz. src/lib/music-catalog.js — 30 parçalık,
    // ticari kullanıma açık Mixkit havuzu). musicMood verilirse o kategoriden
    // seçilir, verilmezse rastgele bir kategoriden.
    if (args.musicMood !== undefined && !MUSIC_CATEGORIES.includes(args.musicMood)) {
      throw new Error(`musicMood şunlardan biri olmalıdır: ${MUSIC_CATEGORIES.join(", ")}.`);
    }
    musicUrl = pickMusicTrack({ mood: args.musicMood, randomImpl }).audioUrl;
  }

  const upscaleImages = args.upscaleImages !== false;

  return {
    mediaItems,
    durationPerImageSeconds,
    transition,
    transitionDurationSeconds,
    closing,
    musicUrl,
    musicVolume,
    upscaleImages
  };
}

async function dispatchRenderWorkflow(jobId, { fetchImpl = fetch } = {}) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN tanımlı değil — video render kuyruğu tetiklenemez.");
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${VIDEO_RENDER_WORKFLOW_FILE}/dispatches`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ ref: VIDEO_RENDER_REF, inputs: { jobId } })
  });
  // GitHub başarıda 204 No Content döner, gövdesi yoktur.
  if (response.status !== 204) {
    let detail = "";
    try { detail = (await response.json()).message || ""; } catch { /* gövde olmayabilir */ }
    throw new Error(`GitHub Actions workflow_dispatch başarısız (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
  }
}

// mediaItems + seçenekleri doğrular, bir jobId üretir, işin tam payload'unu
// (durum "queued" ile) video-jobs/<jobId>.json'a yazar, ardından GitHub
// Actions render workflow'unu tetikler. Dispatch başarısız olursa iş
// "failed" olarak işaretlenip hata yeniden fırlatılır — böylece
// get_video_render_status "queued" durumunda asla takılı kalmaz.
export async function composeProductVideo(args, {
  putImpl,
  fetchImpl = fetch,
  randomUUIDImpl = crypto.randomUUID,
  randomImpl
} = {}) {
  const payload = validateComposeInput(args, { randomImpl });
  if (payload.upscaleImages && args.confirmed !== true) {
    throw new Error("upscaleImages:true gerçek Replicate API kredisi harcar. Onaylamak için confirmed:true gönderin.");
  }
  const jobId = randomUUIDImpl();

  await writeVideoJobStatus(jobId, { status: "queued", payload }, { putImpl });

  try {
    await dispatchRenderWorkflow(jobId, { fetchImpl });
  } catch (error) {
    await writeVideoJobStatus(jobId, { status: "failed", error: error.message }, { allowOverwrite: true, putImpl }).catch(() => {});
    throw error;
  }

  return {
    ok: true,
    jobId,
    status: "queued",
    message: "Video render işi GitHub Actions kuyruğuna eklendi. Durumu get_video_render_status ile sorgulayın (birkaç dakika sürebilir)."
  };
}

export async function getVideoRenderStatus(jobId, { listImpl, fetchImpl } = {}) {
  if (!String(jobId || "").trim()) throw new Error("jobId gereklidir.");
  const status = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  if (!status) return { ok: true, jobId, status: "unknown", message: "Bu jobId için bir kayıt bulunamadı (yanlış ID veya iş hiç başlatılmadı)." };
  return { ok: true, ...status };
}
