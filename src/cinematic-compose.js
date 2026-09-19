import crypto from "node:crypto";
import { writeVideoJobStatus, readVideoJobStatus } from "./lib/video-jobs.js";
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME, CINEMATIC_RENDER_WORKFLOW_FILE, VIDEO_RENDER_REF } from "./lib/config.js";
import { validateComposeCinematicInput } from "./cinematic/schema.js";

// compose_cinematic_reel (TASK-011) — src/video-compose.js/src/reel-audio-
// compose.js ile AYNI mimari (workflow_dispatch + video-jobs.js Blob
// job-status, jobId AYNI paylaşılan video-jobs/<jobId>.json alanı), ama
// BAĞIMSIZ bir doğrulama/şema (src/cinematic/schema.js) ve BAĞIMSIZ bir
// GitHub Actions workflow'u (.github/workflows/render-cinematic-reel.yml,
// scripts/render-cinematic-reel.mjs) kullanır — compose_product_video'nun
// mediaItems/transition/closing sözleşmesi veya render motoru (zoompan tek
// tip Ken Burns) BURADA HİÇ KULLANILMAZ (manifest: "build independent of
// compose_product_video").
async function dispatchRenderWorkflow(jobId, { fetchImpl = fetch } = {}) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN tanımlı değil — cinematic render kuyruğu tetiklenemez.");
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${CINEMATIC_RENDER_WORKFLOW_FILE}/dispatches`;
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

// Render (kamera/renk/geçiş/tipografi/ses mix) TAMAMEN ÜCRETSİZDİR — hiçbir
// paid AI/generative video çağrısı YOKTUR (manifest: "no hidden paid
// provider calls, no automatic paid fallback, no Veo/Omni/fal.ai/Runway
// calls inside this tool"). Bu yüzden compose_product_video'nun
// upscaleImages'ı gibi bir confirmed şartı YOK — sahne görselleri zaten
// üretilmiş/sağlanmış varlıklardır, burada yalnızca ÜCRETSİZ FFmpeg
// kompozisyonu yapılır.
export async function composeCinematicReel(args, {
  putImpl,
  fetchImpl = fetch,
  randomUUIDImpl = crypto.randomUUID
} = {}) {
  const payload = validateComposeCinematicInput(args);
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
    message: "Cinematic render işi GitHub Actions kuyruğuna eklendi. Durumu get_cinematic_render_status ile sorgulayın (birkaç dakika sürebilir)."
  };
}

export async function getCinematicRenderStatus(jobId, { listImpl, fetchImpl } = {}) {
  if (!String(jobId || "").trim()) throw new Error("jobId gereklidir.");
  const status = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  if (!status) return { ok: true, jobId, status: "unknown", message: "Bu jobId için bir kayıt bulunamadı (yanlış ID veya iş hiç başlatılmadı)." };
  return { ok: true, ...status };
}
