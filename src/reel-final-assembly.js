import crypto from "node:crypto";
import { writeVideoJobStatus } from "./lib/video-jobs.js";
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME, REEL_FINAL_RENDER_WORKFLOW_FILE, VIDEO_RENDER_REF } from "./lib/config.js";

// compose_reel_final (AI Reels V2 PR-F/G) — src/reel-audio-compose.js'in
// AYNI mimarisi (workflow_dispatch + video-jobs.js Blob job-status), ama
// TEK bir videoUrl değil, Step 5'in ürettiği SIRALI bir sceneVideoUrls
// listesi alır (mevcut compose_reel_audio bunu YAPAMIYOR — yalnızca zaten
// var olan tek bir videoya ses mix'i yapıyor, sahne birleştirme/concat
// içermiyor; bu dosya bu eksik parçayı EN KÜÇÜK ek olarak tamamlar).
// Durum sorgusu YENİDEN İCAT EDİLMEZ — getReelAudioStatus zaten tamamen
// jobId/Blob tabanlı ve üreten workflow'a bağımlı değildir, bu yüzden
// api/reel-final.js onu doğrudan reuse eder (bkz. o dosya).
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

export function validateReelFinalInput(args = {}) {
  const sceneVideoUrlsRaw = Array.isArray(args.sceneVideoUrls) ? args.sceneVideoUrls : [];
  if (sceneVideoUrlsRaw.length === 0) throw new Error("sceneVideoUrls en az bir sahne video URL'i içermelidir.");
  const sceneVideoUrls = sceneVideoUrlsRaw.map((url, index) => assertHttpsUrlSyntax(url, `sceneVideoUrls[${index}]`));

  const voiceoverUrl = args.voiceoverUrl !== undefined && args.voiceoverUrl !== null && String(args.voiceoverUrl).trim()
    ? assertHttpsUrlSyntax(args.voiceoverUrl, "voiceoverUrl")
    : undefined;
  const musicUrl = args.musicUrl !== undefined && args.musicUrl !== null && String(args.musicUrl).trim()
    ? assertHttpsUrlSyntax(args.musicUrl, "musicUrl")
    : undefined;
  // Bu kısıt YENİ İCAT EDİLMEDİ — buildReelAudioFfmpegArgs'ın (reuse edilen
  // ses-mix katmanı) kendisi de voiceoverPath/musicPath'ten en az birini
  // zorunlu kılıyor; burada aynı kural erken (görsel/ücretsiz) doğrulanır.
  if (!voiceoverUrl && !musicUrl) throw new Error("voiceoverUrl veya musicUrl'den en az biri gereklidir.");

  const musicVolume = args.musicVolume === undefined ? 0.5 : Number(args.musicVolume);
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) {
    throw new Error("musicVolume 0-1 aralığında olmalıdır.");
  }
  return { sceneVideoUrls, voiceoverUrl, musicUrl, musicVolume };
}

async function dispatchRenderWorkflow(jobId, { fetchImpl = fetch } = {}) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN tanımlı değil — final reel kuyruğu tetiklenemez.");
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${REEL_FINAL_RENDER_WORKFLOW_FILE}/dispatches`;
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

// FFmpeg concat+mix ÜCRETSİZDİR — compose_reel_audio ile AYNI sebeple
// confirmed şartı YOK. Ücretli onay noktaları (Veo, TTS, Lyria) zaten daha
// önce geçildi; buraya gelen URL'ler zaten üretilmiş dosyalardır. Bu
// fonksiyon Veo/TTS/Lyria'yı OTOMATİK TETİKLEMEZ.
export async function composeReelFinal(args, {
  putImpl,
  fetchImpl = fetch,
  randomUUIDImpl = crypto.randomUUID
} = {}) {
  const payload = validateReelFinalInput(args);
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
    message: "Final Reel işi GitHub Actions kuyruğuna eklendi. Durumu get_reel_audio_status ile (aynı jobId, aynı Blob deposu) sorgulayın."
  };
}

// getReelAudioStatus (src/reel-audio-compose.js) BİREBİR reuse edilir —
// jobId/Blob'a dayalı, üreten workflow'dan bağımsız, YENİDEN YAZILMAZ.
export { getReelAudioStatus as getReelFinalStatus } from "./reel-audio-compose.js";
