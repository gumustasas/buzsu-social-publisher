const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

// Tek izinli model — kullanıcı isteği açık: Omni fazında BAŞKA hiçbir model
// (tier, allowlist genişletme) yok. Veo'daki VEO_MODEL_TIERS deseninin
// kasıtlı olarak burada bir karşılığı yok.
export const OMNI_MODEL = "gemini-omni-1.1-flash";

// GEMINI_API_KEY zaten bu depoda kullanılıyor (bkz. src/veo-video.js,
// src/scene-image.js) — Omni de aynı Gemini Developer API anahtarını kullanır.
function omniHeaders(env, extra = {}) {
  return { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json", ...extra };
}

// Yapılandırılmış Omni API hatası — RATE_LIMITED (HTTP 429, Veo'dakiyle
// birebir aynı sınıflandırma) ve REGION_UNAVAILABLE (Google'ın "bu özellik
// bulunduğunuz bölgede/ülkede desteklenmiyor" yanıtı — EEA/İsviçre/UK ve
// bazı ABD eyaletleri için dokümante edilmiş, Türkiye için garanti YOK).
// Her iki durumda da hiçbir otomatik tekrar/model değişimi YAPILMAZ — bu
// sınıf sadece bilgi taşır, katman üstü (api/omni-video.js) buna göre HTTP
// kodu seçer.
export class OmniApiError extends Error {
  constructor(message, { code, httpStatus, model, providerStatus, retryAfter = null, details = null } = {}) {
    super(message);
    this.name = "OmniApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.model = model;
    this.providerStatus = providerStatus;
    this.retryAfter = retryAfter;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, httpStatus: this.httpStatus, model: this.model, providerStatus: this.providerStatus, retryAfter: this.retryAfter, details: this.details, error: this.message };
  }
}

function redact(message) {
  return String(message || "").replace(/key=[^&\s"]+/gi, "key=[gizli]");
}

function parseRetryAfter(response, data) {
  const header = response && typeof response.headers?.get === "function" ? response.headers.get("retry-after") : null;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds;
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
  }
  const details = data?.error?.details;
  if (Array.isArray(details)) {
    const retryInfo = details.find((item) => String(item?.["@type"] || "").includes("RetryInfo"));
    const match = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
    if (match) return Number(match[1]);
  }
  return null;
}

// Google'ın bölgesel kısıt hatasını KESİN bir status koduyla vermeyeceği
// varsayılıyor (dokümantasyonda örnek yok) — bu yüzden hem status alanına
// hem de mesaj metnine bakılıyor. Eşleşme yoksa bu bir REGION_UNAVAILABLE
// DEĞİL, düz bir hata olarak kalır (yanlış sınıflandırma, sessizce yutmaktan
// daha az kötüdür).
function isRegionUnavailable(data, httpStatus) {
  const status = String(data?.error?.status || "");
  const message = String(data?.error?.message || "").toLowerCase();
  if (!(httpStatus === 403 || httpStatus === 400 || status === "PERMISSION_DENIED" || status === "FAILED_PRECONDITION")) return false;
  return /region|country|available in|desteklenmiyor|bölge|ülke/.test(message);
}

async function readOmniJson(response, { model } = {}) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      const safeMessage = redact(data?.error?.message || "HTTP 429");
      throw new OmniApiError(`Omni modeli (${model}) için istek sınırına ulaşıldı. ${safeMessage}`, {
        code: "RATE_LIMITED",
        httpStatus: 429,
        model,
        providerStatus: data?.error?.status || null,
        retryAfter: parseRetryAfter(response, data),
        details: { message: safeMessage }
      });
    }
    if (isRegionUnavailable(data, response.status)) {
      const safeMessage = redact(data?.error?.message || `HTTP ${response.status}`);
      throw new OmniApiError(`Omni video düzenleme bu bölgede/hesapta desteklenmiyor. ${safeMessage}`, {
        code: "REGION_UNAVAILABLE",
        httpStatus: response.status,
        model,
        providerStatus: data?.error?.status || null,
        details: { message: safeMessage }
      });
    }
    throw new Error(redact(data.error?.message) || `Omni HTTP ${response.status}`);
  }
  return data;
}

// Gemini Files API — resumable upload protokolü: (1) start ile metadata
// gönderip X-Goog-Upload-URL header'ını al, (2) o URL'e ham baytları
// "upload, finalize" komutuyla PUT/POST et. Videolar Omni'de inline
// base64 DEĞİL, Files API üzerinden referanslanıyor (dokümantasyon).
export async function uploadOmniFile(buffer, mimeType, displayName, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  const startResponse = await fetch(`${UPLOAD_BASE}/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: displayName } })
  });
  if (!startResponse.ok) throw new Error(`Omni dosya yükleme başlatılamadı (HTTP ${startResponse.status}).`);
  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Omni dosya yükleme URL'i alınamadı.");
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(buffer.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: buffer
  });
  if (!uploadResponse.ok) throw new Error(`Omni dosya yüklenemedi (HTTP ${uploadResponse.status}).`);
  const data = await uploadResponse.json().catch(() => ({}));
  if (!data.file?.uri || !data.file?.name) throw new Error("Omni dosya yükleme yanıtında uri/name bulunamadı.");
  return data.file;
}

const FILE_ACTIVE_POLL_MAX_ATTEMPTS = 20;
const FILE_ACTIVE_POLL_INTERVAL_MS = 1500;

// Video dosyaları Google tarafında işleniyor (state: PROCESSING -> ACTIVE);
// ACTIVE olmadan interactions isteğine referans verilirse hata alınır.
// Sınırlı sayıda deneme — sonsuz döngü YOK, takılırsa açık hata fırlatılır.
export async function waitForOmniFileActive(fileName, env = process.env, { maxAttempts = FILE_ACTIVE_POLL_MAX_ATTEMPTS, intervalMs = FILE_ACTIVE_POLL_INTERVAL_MS } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${API_BASE}/${fileName}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
    if (!response.ok) throw new Error(`Omni dosya durumu sorgulanamadı (HTTP ${response.status}).`);
    const data = await response.json();
    if (data.state === "ACTIVE") return data;
    if (data.state === "FAILED") throw new Error("Omni dosya işleme başarısız oldu (state: FAILED).");
    if (attempt < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Omni dosyası zaman aşımına uğradı (state hâlâ ACTIVE değil).");
}

// existingVideoUrl: düzeltilecek, zaten üretilmiş/render edilmiş video
// (örn. compose_product_video ya da Veo çıktısı) — herkese açık HTTPS URL.
// referenceImageUrl: korunması istenen ürünün gerçek görseli (opsiyonel,
// verilirse inline referans olarak eklenir — küçük bir dosya, Files API'ye
// gerek yok).
//
// confirmed !== true ise HİÇBİR ağ isteği atılmadan reddedilir — bu, ücretli
// bir işlem olduğu için Veo/compose'daki "onay olmadan asla confirmed:true
// gönderilmez" kuralının sunucu tarafı karşılığı (istemci onayı atlarsa bile
// burada durur).
export async function submitOmniVideoEdit(existingVideoUrl, env = process.env, { referenceImageUrl, editPrompt, aspectRatio = "9:16", resolution = "360p", confirmed } = {}) {
  if (confirmed !== true) throw new Error("Omni video düzenleme onay (confirmed:true) gerektirir — ücretli bir işlemdir.");
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!/^https:\/\//i.test(String(existingVideoUrl || ""))) throw new Error("Omni için mevcut video herkese açık HTTPS URL olmalı.");
  const prompt = String(editPrompt || "").trim();
  if (!prompt) throw new Error("Omni video düzenleme için bir düzenleme talimatı (editPrompt) gerekli.");
  const allowedResolutions = new Set(["360p", "720p", "1080p", "4k"]);
  if (!allowedResolutions.has(resolution)) throw new Error(`Desteklenmeyen Omni çözünürlüğü: "${resolution}". Kullanılabilir: ${[...allowedResolutions].join(", ")}.`);

  const videoUpstream = await fetch(existingVideoUrl);
  if (!videoUpstream.ok) throw new Error("Düzenlenecek mevcut video alınamadı.");
  const videoMimeType = videoUpstream.headers.get("content-type") || "video/mp4";
  const videoBuffer = Buffer.from(await videoUpstream.arrayBuffer());
  const uploadedFile = await uploadOmniFile(videoBuffer, videoMimeType, `omni-edit-source-${Date.now()}`, env);
  const activeFile = await waitForOmniFileActive(uploadedFile.name, env);

  const contentParts = [{ text: prompt }, { file_data: { file_uri: activeFile.uri, mime_type: activeFile.mimeType || videoMimeType } }];
  if (typeof referenceImageUrl === "string" && /^https:\/\//i.test(referenceImageUrl)) {
    const imageUpstream = await fetch(referenceImageUrl);
    if (!imageUpstream.ok) throw new Error("Referans ürün görseli alınamadı.");
    const imageMimeType = imageUpstream.headers.get("content-type") || "image/jpeg";
    const imageBytes = Buffer.from(await imageUpstream.arrayBuffer()).toString("base64");
    contentParts.push({ inline_data: { mime_type: imageMimeType, data: imageBytes } });
  }

  // NOT: /v1beta/interactions çok yeni bir yüzey (27 Ağustos 2026) — burada
  // kullanılan input/generation_config/response_format alan adları resmi
  // dokümandan (arama sonuçları üzerinden) derlendi, ağ politikası nedeniyle
  // ai.google.dev sayfası birebir doğrulanamadı. Gerçek şema küçük farklıysa
  // düzeltme TEK bu istek gövdesinde yapılır.
  const response = await fetch(`${API_BASE}/interactions`, {
    method: "POST",
    headers: omniHeaders(env),
    body: JSON.stringify({
      model: OMNI_MODEL,
      input: [{ role: "user", content: contentParts }],
      generation_config: { aspect_ratio: aspectRatio, resolution },
      response_format: { delivery: "uri" }
    })
  });
  const data = await readOmniJson(response, { model: OMNI_MODEL });
  const interactionId = data.id || data.name;
  if (!interactionId) throw new Error("Omni interaction id alınamadı.");
  const outputVideo = extractOmniVideoUri(data);
  return {
    provider: "omni",
    model: OMNI_MODEL,
    interactionId,
    status: outputVideo ? "COMPLETED" : "IN_PROGRESS",
    fileUri: outputVideo,
    sourceVideoUrl: existingVideoUrl,
    editPrompt: prompt,
    createdAt: new Date().toISOString()
  };
}

// Google'ın yanıt şeklinin (senkron mu, tamamlanmış çıktı hemen mi gelir,
// yoksa long-running mı) tam olarak nasıl olduğu doğrulanamadığı için
// birden çok olası alan adı denenir — hiçbiri yoksa null döner (üst katman
// bunu IN_PROGRESS olarak kabul eder, hata fırlatmaz).
function extractOmniVideoUri(data) {
  const output = data.outputs?.[0] || data.output?.[0] || data.response?.output?.[0];
  const candidates = [
    output?.content?.find?.((part) => part?.file_data)?.file_data?.file_uri,
    output?.video?.uri,
    data.output_video?.uri,
    data.video?.uri
  ];
  return candidates.find((value) => typeof value === "string" && value) || null;
}

export async function omniInteractionStatus(job, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.interactionId) throw new Error("Omni iş bilgisi eksik.");
  const response = await fetch(`${API_BASE}/interactions/${job.interactionId}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const data = await readOmniJson(response, { model: job.model });
  const outputVideo = extractOmniVideoUri(data);
  if (!outputVideo) return { ...job, status: "IN_PROGRESS" };
  return { ...job, status: "COMPLETED", fileUri: outputVideo };
}

export async function downloadOmniVideo(fileUri, env = process.env) {
  const response = await fetch(fileUri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!response.ok) throw new Error(`Omni video indirilemedi (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
