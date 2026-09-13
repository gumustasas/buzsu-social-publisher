import crypto from "node:crypto";
import { writeVideoJobStatus, readVideoJobStatus } from "./lib/video-jobs.js";
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME, REEL_AUDIO_RENDER_WORKFLOW_FILE, VIDEO_RENDER_REF } from "./lib/config.js";

// compose_reel_audio (bkz. api/mcp.js) — video-compose.js'in AYNI mimarisi:
// Vercel'in süre/bellek sınırları FFmpeg (video indirme + ses mix'i) için
// riskli olduğundan gerçek iş GitHub Actions'ın ücretsiz workflow_dispatch
// kuyruğunda çalışır (bkz. .github/workflows/render-reel-audio.yml,
// scripts/render-reel-audio.mjs). Durum, GitHub'ı sorgulamak yerine (
// workflow_dispatch 204 döner, run ID vermez) video-jobs.js aracılığıyla
// Vercel Blob'dan okunur — compose_product_video ile TAMAMEN aynı jobId
// alanı (video-jobs/<jobId>.json) paylaşılır, ayrı bir mekanizma icat
// edilmedi.
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

export function validateReelAudioInput(args = {}) {
  const videoUrl = assertHttpsUrlSyntax(args.videoUrl, "videoUrl");
  const voiceoverUrl = args.voiceoverUrl !== undefined && args.voiceoverUrl !== null && String(args.voiceoverUrl).trim()
    ? assertHttpsUrlSyntax(args.voiceoverUrl, "voiceoverUrl")
    : undefined;
  const musicUrl = args.musicUrl !== undefined && args.musicUrl !== null && String(args.musicUrl).trim()
    ? assertHttpsUrlSyntax(args.musicUrl, "musicUrl")
    : undefined;
  if (!voiceoverUrl && !musicUrl) throw new Error("voiceoverUrl veya musicUrl'den en az biri gereklidir.");

  const musicVolume = args.musicVolume === undefined ? 0.5 : Number(args.musicVolume);
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) {
    throw new Error("musicVolume 0-1 aralığında olmalıdır.");
  }
  return { videoUrl, voiceoverUrl, musicUrl, musicVolume };
}

async function dispatchRenderWorkflow(jobId, { fetchImpl = fetch } = {}) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN tanımlı değil — ses mix kuyruğu tetiklenemez.");
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${REEL_AUDIO_RENDER_WORKFLOW_FILE}/dispatches`;
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
  if (response.status !== 204) {
    let detail = "";
    try { detail = (await response.json()).message || ""; } catch { /* gövde olmayabilir */ }
    throw new Error(`GitHub Actions workflow_dispatch başarısız (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
  }
}

// FFmpeg mix ÜCRETSİZDİR (bkz. api/mcp.js açıklaması, madde 9 — "Final
// FFmpeg render ücretsizse ücret onayı isteme") — bu yüzden compose_
// product_video'daki upscaleImages gibi bir confirmed şartı YOK. Ücretli
// onay noktaları zaten daha önce (generate_turkish_voiceover, generate_
// lyria_music) geçildi; buraya gelen voiceoverUrl/musicUrl zaten üretilmiş
// dosyalardır.
export async function composeReelAudio(args, {
  putImpl,
  fetchImpl = fetch,
  randomUUIDImpl = crypto.randomUUID
} = {}) {
  const payload = validateReelAudioInput(args);
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
    message: "Ses mix işi GitHub Actions kuyruğuna eklendi. Durumu get_reel_audio_status ile sorgulayın."
  };
}

export async function getReelAudioStatus(jobId, { listImpl, fetchImpl } = {}) {
  if (!String(jobId || "").trim()) throw new Error("jobId gereklidir.");
  const status = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  if (!status) return { ok: true, jobId, status: "unknown", message: "Bu jobId için bir kayıt bulunamadı (yanlış ID veya iş hiç başlatılmadı)." };
  return { ok: true, ...status };
}
