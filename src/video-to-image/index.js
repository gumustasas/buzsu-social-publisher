import { put } from "@vercel/blob";
import { fetchPublicVideo } from "../lib/upload-media.js";
import { listGeminiModels } from "../lib/gemini-model-discovery.js";

export const VIDEO_TO_IMAGE_MODELS = ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"];
export const DEFAULT_VIDEO_TO_IMAGE_MODEL = "gemini-3.1-flash-image";
export const VIDEO_TO_IMAGE_ASPECT_RATIOS = ["9:16", "1:1", "16:9"];

const MODEL_SET = new Set(VIDEO_TO_IMAGE_MODELS);
const RATIO_SET = new Set(VIDEO_TO_IMAGE_ASPECT_RATIOS);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const MAX_POLLS = 15;
const POLL_MS = 1000;

export function isPublicYouTubeUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || "").trim()); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(host)) return false;
  if (host === "youtu.be") return Boolean(url.pathname.slice(1));
  if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"));
  return /^\/(shorts|live)\//.test(url.pathname);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function uploadGeminiVideo(buffer, mimeType, apiKey, fetchImpl) {
  const start = await fetchImpl("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: "video-to-image-source" } })
  });
  if (!start.ok) {
    const data = await start.json().catch(() => ({}));
    throw new Error(data.error?.message || `Gemini Files start HTTP ${start.status}`);
  }
  const uploadUrl = start.headers?.get?.("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files API upload URL döndürmedi.");
  const upload = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType
    },
    body: buffer
  });
  const data = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new Error(data.error?.message || `Gemini Files upload HTTP ${upload.status}`);
  const file = data.file || {};
  if (!file.uri || !file.name) throw new Error("Gemini Files API file URI/name döndürmedi.");
  return { ...file, mimeType: file.mimeType || mimeType };
}

async function waitForActive(file, apiKey, fetchImpl, sleepImpl = sleep) {
  let current = file;
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const state = String(current.state || "").toUpperCase();
    if (!state || state === "ACTIVE") return current;
    if (state === "FAILED") throw new Error("Gemini Files API video işleme başarısız oldu.");
    if (state !== "PROCESSING") throw new Error(`Gemini Files API bilinmeyen dosya durumu: ${current.state}`);
    await sleepImpl(POLL_MS);
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${current.name}`, {
      headers: { "x-goog-api-key": apiKey }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Gemini Files status HTTP ${response.status}`);
    current = data;
  }
  throw new Error("Gemini Files API video işleme zaman aşımına uğradı.");
}

async function resolveVideoPart(videoUrl, env, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  if (isPublicYouTubeUrl(videoUrl)) {
    return { inputMethod: "youtube-url", part: { fileData: { fileUri: videoUrl }, videoMetadata: { fps: 0.5 } } };
  }
  const fetchPublicVideoImpl = deps.fetchPublicVideoImpl || fetchPublicVideo;
  const media = await fetchPublicVideoImpl(videoUrl, { fetchImpl, lookup: deps.lookup });
  const uploaded = await uploadGeminiVideo(media.buffer, media.mimeType, env.GEMINI_API_KEY, fetchImpl);
  const active = await waitForActive(uploaded, env.GEMINI_API_KEY, fetchImpl, deps.sleepImpl);
  return {
    inputMethod: "files-api",
    part: { fileData: { fileUri: active.uri, mimeType: active.mimeType || media.mimeType }, videoMetadata: { fps: 0.5 } }
  };
}

function getImage(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const part = parts.find((item) => item.inlineData?.data && String(item.inlineData?.mimeType || "image/png").startsWith("image/"));
  if (!part) throw new Error("Gemini video-to-image yanıtında görsel bulunamadı.");
  return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
}

function ext(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export async function generateImageFromVideo(input = {}, env = process.env, deps = {}) {
  if (input.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar (Gemini video-to-image). Onaylamak için confirmed:true gönderin.");
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY tanımlı değil.");
  const videoUrl = String(input.videoUrl || "").trim();
  const prompt = String(input.prompt || "").trim();
  if (!videoUrl) throw new Error("videoUrl gerekli.");
  if (!prompt) throw new Error("prompt boş olamaz.");
  if (prompt.length > 4000) throw new Error("prompt en fazla 4000 karakter olabilir.");

  const aspectRatio = String(input.aspectRatio || "9:16");
  if (!RATIO_SET.has(aspectRatio)) throw new Error(`Desteklenmeyen aspectRatio: ${aspectRatio}.`);

  const model = String(input.model || env.GEMINI_VIDEO_TO_IMAGE_MODEL || DEFAULT_VIDEO_TO_IMAGE_MODEL).trim();
  if (!MODEL_SET.has(model)) throw new Error(`Video-to-image yalnız şu modellerde desteklenir: ${VIDEO_TO_IMAGE_MODELS.join(", ")}. Sessiz fallback uygulanmadı.`);

  const listModels = deps.listGeminiModelsImpl || listGeminiModels;
  const discovered = await listModels(env, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
  if (discovered instanceof Set && !discovered.has(model)) {
    throw new Error(`Seçilen video-to-image modeli bu hesapta discovery sonucunda bulunamadı: ${model}. Sessiz fallback uygulanmadı.`);
  }

  const { inputMethod, part } = await resolveVideoPart(videoUrl, env, deps);
  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [part, { text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
  const image = getImage(data);
  const buffer = Buffer.from(image.base64, "base64");
  if (!buffer.length) throw new Error("Gemini video-to-image boş görsel verisi döndürdü.");

  let imageUrl = `data:${image.mimeType};base64,${image.base64}`, uploaded = false;
  if (env.BLOB_READ_WRITE_TOKEN) {
    const putImpl = deps.putImpl || put;
    const blob = await putImpl(`ai-video-to-image/${Date.now()}.${ext(image.mimeType)}`, buffer, { access: "public", contentType: image.mimeType });
    imageUrl = blob.url;
    uploaded = true;
  }
  return { ok: true, provider: "google", model, inputMethod, videoUrl, prompt, aspectRatio, imageUrl, mimeType: image.mimeType, uploaded };
}
