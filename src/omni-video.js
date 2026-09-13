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
// "upload, finalize" komutuyla PUT/POST et. Video VE referans görsel,
// Interactions API'nin dokümante edilmiş girdi şekli ({type,uri} — bkz.
// submitOmniVideoEdit) gereği ikisi de Files API üzerinden yükleniyor;
// inline_data/base64 KULLANILMIYOR (önceki sürümde görsel için inline_data
// kullanılıyordu — bu, resmi dokümanla doğrulanınca düzeltildi).
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

async function uploadPublicUrlToOmniFiles(url, label, env) {
  const upstream = await fetch(url);
  if (!upstream.ok) throw new Error(`${label} alınamadı.`);
  const mimeType = upstream.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await upstream.arrayBuffer());
  const uploaded = await uploadOmniFile(buffer, mimeType, `omni-${Date.now()}`, env);
  const active = await waitForOmniFileActive(uploaded.name, env);
  return { uri: active.uri, mimeType: active.mimeType || mimeType };
}

// interactions/{id} URL'i oluştururken kullanılacak KISA/HAM id — Google'ın
// bazı REST kaynaklarında (Veo'nun "operations/xyz" gibi) "name" alanı zaten
// kaynak yolunun tam hâlini taşıyabiliyor. Eğer "name" (veya "id") baştan
// "interactions/" öneki taşıyorsa bu önek burada bir kez temizlenir — aksi
// halde GET isteği .../interactions/interactions/xyz gibi YANLIŞ, iki kat
// önekli bir URL'e gidebilirdi.
function normalizeInteractionId(raw) {
  const value = String(raw || "");
  return value.startsWith("interactions/") ? value.slice("interactions/".length) : value;
}

// Interactions API yanıtı, tamamlanmış çıktıyı outputs[]/output[] gibi
// (önceki sürümde tahmini olarak kullanılan, doğrulanamamış) alanlarda
// DEĞİL — resmi dokümanda tarif edilen `steps[]` dizisinde taşır: model'in
// ürettiği son adım `type:"model_output"` olur, içindeki `content[]`
// dizisinde `type:"video"` olan öğe ya bir `uri` (delivery:"uri" istendiyse)
// ya da inline base64 `data` (+ `mime_type`) taşır. Google, GET
// /interactions/{id} ile durum sorgulanırken delivery:"uri" istenmiş olsa
// bile inline base64 DÖNDÜREBİLİYOR — bu yüzden ikisi de burada ayrıştırılır,
// biri "varsayılan doğru şekil" diye seçilmez.
//
// model_output adımı VARSA ama içinde video parçası YOKSA (örn. metinle
// reddetme/açıklama) bu bir "henüz bitmedi" durumu DEĞİLDİR — sessizce
// IN_PROGRESS'e düşüp hayalî bir polling'e geçmek yerine `error: {thrown:
// true, reason}` ile işaretlenir, çağıran taraf bunu açık bir hataya çevirir.
function extractOmniVideoOutput(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const modelOutputStep = steps.find((step) => step?.type === "model_output");
  if (!modelOutputStep) return { done: false };
  const parts = Array.isArray(modelOutputStep.content) ? modelOutputStep.content : [];
  const videoPart = parts.find((part) => part?.type === "video");
  if (videoPart?.uri) return { done: true, uri: videoPart.uri, mimeType: videoPart.mime_type || null };
  if (videoPart?.data) return { done: true, base64Data: videoPart.data, mimeType: videoPart.mime_type || "video/mp4" };
  const textSummary = parts.find((part) => part?.type === "text")?.text;
  return { done: true, error: textSummary || "Omni model_output adımında video bulunamadı." };
}

// model_output bir `uri` taşıması ("delivery":"uri" istendiğinde), videonun
// O ANDA indirilebilir olduğu ANLAMINA GELMEZ — Google'ın Files API'sindeki
// diğer tüm dosyalar gibi çıktı dosyası da PROCESSING -> ACTIVE (veya FAILED)
// durumundan geçer. Bu yüzden uri'den dosya kimliği ayrıştırılıp Files API
// (GET /v1beta/files/{id}) İLE DURUM DOĞRULANMADAN indirme denenmez.
// Google'ın döndürdüğü tam URI metne güvenmek yerine (o metnin gelecekte
// başka bir yapıya sahip olması durumuna karşı savunmacı olarak) yalnızca
// içindeki dosya kimliği çıkarılır; indirme URL'i buradan, bilinen
// `:download?alt=media` şekliyle YENİDEN KURULUR.
function extractFileId(uri) {
  const match = String(uri || "").match(/\/files\/([^/:?]+)/);
  if (!match) throw new Error(`Omni çıktı URI'sinden dosya kimliği ayrıştırılamadı: ${uri}`);
  return match[1];
}

function omniFileDownloadUrl(fileId) {
  return `${API_BASE}/files/${fileId}:download?alt=media`;
}

// Tek seferlik durum kontrolü (waitForOmniFileActive'in aksine burada
// BEKLEME/tekrar deneme YOK — PROCESSING durumu bir hata değil, çağıran
// tarafın "OUTPUT_PROCESSING" olarak geri dönüp daha sonra tekrar
// sorgulaması gereken normal bir ara durumdur).
async function checkOmniFileState(fileId, env) {
  const response = await fetch(`${API_BASE}/files/${fileId}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!response.ok) throw new Error(`Omni çıktı dosyası durumu sorgulanamadı (HTTP ${response.status}).`);
  const data = await response.json();
  return data.state;
}

// extractOmniVideoOutput'un ürettiği ham çıktıyı (uri/base64Data/error/
// done) gerçek bir iş durumuna çevirir. Bir `uri` varsa dosya ACTIVE olana
// kadar COMPLETED denmez — "OUTPUT_PROCESSING" adında ayrı bir ara durum
// döner (submitOmniVideoEdit VE omniInteractionStatus'un ikisi de bunu
// kullanır, davranış tek bir yerden yönetilir).
async function resolveOmniOutput(output, env) {
  if (output.error) throw new Error(`Omni video düzenleme tamamlandı ama video üretmedi: ${output.error}`);
  if (!output.done) return { status: "IN_PROGRESS", outputFileId: null, fileUri: null, videoBase64: null, videoMimeType: null };
  if (output.base64Data) return { status: "COMPLETED", outputFileId: null, fileUri: null, videoBase64: output.base64Data, videoMimeType: output.mimeType || null };
  const fileId = extractFileId(output.uri);
  const state = await checkOmniFileState(fileId, env);
  if (state === "FAILED") throw new Error("Omni çıktı videosu işlenemedi (Files API state: FAILED).");
  if (state !== "ACTIVE") return { status: "OUTPUT_PROCESSING", outputFileId: fileId, fileUri: null, videoBase64: null, videoMimeType: output.mimeType || null };
  return { status: "COMPLETED", outputFileId: fileId, fileUri: omniFileDownloadUrl(fileId), videoBase64: null, videoMimeType: output.mimeType || null };
}

// existingVideoUrl: düzeltilecek, zaten üretilmiş/render edilmiş video
// (örn. compose_product_video ya da Veo çıktısı) — herkese açık HTTPS URL.
// referenceImageUrl: korunması istenen ürünün gerçek görseli (opsiyonel).
// İkisi de Files API'ye yüklenip {type:"video"/"image", uri, mime_type}
// olarak input dizisine eklenir (dokümante edilen çoklu-referans şekli:
// video URI + image URI + text).
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

  const video = await uploadPublicUrlToOmniFiles(existingVideoUrl, "Düzenlenecek mevcut video", env);
  const input = [{ type: "video", uri: video.uri, mime_type: video.mimeType }];
  if (typeof referenceImageUrl === "string" && /^https:\/\//i.test(referenceImageUrl)) {
    const image = await uploadPublicUrlToOmniFiles(referenceImageUrl, "Referans ürün görseli", env);
    input.push({ type: "image", uri: image.uri, mime_type: image.mimeType });
  }
  input.push({ type: "text", text: prompt });

  // NOT: /v1beta/interactions çok yeni bir yüzey (27 Ağustos 2026 GA). Bu
  // istek gövdesi resmi dokümanla (arama motoru üzerinden erişilen özet +
  // kullanıcı tarafından ayrıca teyit edilen şema) karşılaştırılıp
  // düzeltildi: input dizisi düz {type,uri,text} öğeleri (role/content/
  // file_data/inline_data DEĞİL); response_format en net doğrulanan örnekte
  // görülen NESNE şekliyle gönderiliyor (aspect_ratio/resolution
  // generation_config'te değil response_format'ın İÇİNDE). Yine de tek bir
  // istek gövdesi burada izole tutuluyor — gerçek şema küçük bir noktada
  // farklı çıkarsa düzeltme tek buradan.
  const response = await fetch(`${API_BASE}/interactions`, {
    method: "POST",
    headers: omniHeaders(env),
    body: JSON.stringify({
      model: OMNI_MODEL,
      input,
      response_format: { type: "video", delivery: "uri", aspect_ratio: aspectRatio, resolution }
    })
  });
  const data = await readOmniJson(response, { model: OMNI_MODEL });
  const interactionId = normalizeInteractionId(data.id || data.name);
  if (!interactionId) throw new Error("Omni interaction id alınamadı.");
  const output = extractOmniVideoOutput(data);
  const resolved = await resolveOmniOutput(output, env);
  return {
    provider: "omni",
    model: OMNI_MODEL,
    interactionId,
    ...resolved,
    sourceVideoUrl: existingVideoUrl,
    editPrompt: prompt,
    createdAt: new Date().toISOString()
  };
}

// job.outputFileId set edilmişse (bir önceki adımda model_output zaten bir
// uri üretmiş ama dosya henüz ACTIVE değilmiş), GET /interactions/{id}'ye
// HİÇ gidilmez — doğrudan Files API'den (GET /v1beta/files/{id}) dosyanın
// durumu sorgulanır. Bu, kullanıcı doğrulaması: "URI oluştuktan sonra takip
// Files API'ye geçmeli; GET /interactions/{id} yalnızca henüz model_output
// oluşmadığında kullanılabilir."
export async function omniInteractionStatus(job, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.interactionId) throw new Error("Omni iş bilgisi eksik.");
  if (job.outputFileId) {
    const state = await checkOmniFileState(job.outputFileId, env);
    if (state === "FAILED") throw new Error("Omni çıktı videosu işlenemedi (Files API state: FAILED).");
    if (state !== "ACTIVE") return { ...job, status: "OUTPUT_PROCESSING" };
    return { ...job, status: "COMPLETED", fileUri: omniFileDownloadUrl(job.outputFileId), videoBase64: null };
  }
  const response = await fetch(`${API_BASE}/interactions/${normalizeInteractionId(job.interactionId)}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const data = await readOmniJson(response, { model: job.model });
  const output = extractOmniVideoOutput(data);
  const resolved = await resolveOmniOutput(output, env);
  return { ...job, ...resolved };
}

export async function downloadOmniVideo(fileUri, env = process.env) {
  const response = await fetch(fileUri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!response.ok) throw new Error(`Omni video indirilemedi (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
