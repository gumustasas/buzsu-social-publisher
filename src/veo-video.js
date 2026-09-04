import { buildVideoPrompt } from "./lib/video-prompt.js";

const DEFAULT_MODEL = "veo-3.1-fast-generate-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// GEMINI_API_KEY zaten bu depoda kullanılıyor (bkz. src/scene-image.js,
// src/ai-providers.js); Veo aynı anahtarla, Gemini API'nin bir parçası
// olarak çalışıyor, ayrı bir hesap/anahtar gerekmiyor.
function veoHeaders(env) {
  return { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
}

async function readJson(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Veo HTTP ${response.status}`);
  return data;
}

export function veoModel(env = process.env) { return env.VEO_VIDEO_MODEL || DEFAULT_MODEL; }

// fal.ai'nin aksine Veo, görsel URL'i değil ham baytları (base64) kabul
// ediyor; bu yüzden ürün görselini burada indirip gövdeye gömüyoruz.
// finalizedPrompt, önizleme adımında (bkz. api/reels.js) kurulup snapshot
// alınmış promptun aynısıdır — burada yeniden kurulmaz, olduğu gibi
// kullanılır. Verilmezse (örn. ileride başka bir çağıran) generic bir
// prompt'a düşer.
export async function submitVeoVideo(product, env = process.env, { finalizedPrompt, aspectRatio = "9:16" } = {}) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  const imageUrl = String(product.imageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("Veo için ürün görseli herkese açık HTTPS URL olmalı.");
  const upstream = await fetch(imageUrl);
  if (!upstream.ok) throw new Error("Ürün görseli alınamadı.");
  const mimeType = upstream.headers.get("content-type") || "image/jpeg";
  const imageBytes = Buffer.from(await upstream.arrayBuffer()).toString("base64");
  const prompt = String(finalizedPrompt || "").trim() || buildVideoPrompt(product.title);
  const model = veoModel(env);
  const response = await fetch(`${API_BASE}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: veoHeaders(env),
    body: JSON.stringify({ instances: [{ prompt, image: { bytesBase64Encoded: imageBytes, mimeType } }], parameters: { aspectRatio } })
  });
  const data = await readJson(response);
  if (!data.name) throw new Error("Veo işlem adı (operation) alınamadı.");
  return { provider: "veo", model, operationName: data.name, product: product.title, imageUrl, prompt, createdAt: new Date().toISOString() };
}

export async function veoVideoStatus(job, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.operationName) throw new Error("Veo iş bilgisi eksik.");
  const response = await fetch(`${API_BASE}/${job.operationName}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const data = await readJson(response);
  if (!data.done) return { ...job, status: "IN_PROGRESS" };
  if (data.error) throw new Error(data.error.message || "Veo video üretimi başarısız.");
  const sample = data.response?.generateVideoResponse?.generatedSamples?.[0];
  const fileUri = sample?.video?.uri || null;
  if (!fileUri) throw new Error("Veo yanıtında video bulunamadı.");
  return { ...job, status: "COMPLETED", fileUri };
}

// Google'ın dosya URI'si x-goog-api-key ile korunuyor; anahtarı tarayıcıya
// ifşa etmeden kullanıcıya bir bağlantı verebilmek için video burada
// sunucu tarafında indirilir (api/veo-video.js bunu Vercel Blob'a yükleyip
// herkese açık bir URL üretir).
export async function downloadVeoVideo(fileUri, env = process.env) {
  const response = await fetch(fileUri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!response.ok) throw new Error(`Veo video indirilemedi (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
