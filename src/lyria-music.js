// generate_lyria_music — Google'ın Lyria 3 modeliyle (Interactions API
// üzerinden) senaryoya uygun, sözsüz (instrumental) müzik üretir. Aynı
// steps[]/model_output ayrıştırma + RATE_LIMITED disiplini src/omni-video.js
// ve src/turkish-tts.js ile birebir aynı — bağımsız bir kopya olarak tutulur.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const LYRIA_MODELS = { clip: "lyria-3-clip-preview", pro: "lyria-3-pro-preview" };
export const LYRIA_TIERS = Object.keys(LYRIA_MODELS);

function lyriaHeaders(env) {
  return { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
}

export class LyriaApiError extends Error {
  constructor(message, { code, httpStatus, model, providerStatus, retryAfter = null, details = null } = {}) {
    super(message);
    this.name = "LyriaApiError";
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
  }
  const details = data?.error?.details;
  if (Array.isArray(details)) {
    const retryInfo = details.find((item) => String(item?.["@type"] || "").includes("RetryInfo"));
    const match = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
    if (match) return Number(match[1]);
  }
  return null;
}

async function readLyriaJson(response, { model } = {}) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      const safeMessage = redact(data?.error?.message || "HTTP 429");
      throw new LyriaApiError(`Lyria modeli (${model}) için istek sınırına ulaşıldı. ${safeMessage}`, {
        code: "RATE_LIMITED",
        httpStatus: 429,
        model,
        providerStatus: data?.error?.status || null,
        retryAfter: parseRetryAfter(response, data),
        details: { message: safeMessage }
      });
    }
    throw new Error(redact(data.error?.message) || `Lyria HTTP ${response.status}`);
  }
  return data;
}

function extractLyriaOutput(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const modelOutputStep = steps.find((step) => step?.type === "model_output");
  if (!modelOutputStep) return { done: false };
  const parts = Array.isArray(modelOutputStep.content) ? modelOutputStep.content : [];
  const audioPart = parts.find((part) => part?.type === "audio");
  if (audioPart?.uri) return { done: true, uri: audioPart.uri, mimeType: audioPart.mime_type || null };
  if (audioPart?.data) return { done: true, base64Data: audioPart.data, mimeType: audioPart.mime_type || "audio/mpeg" };
  const textSummary = parts.find((part) => part?.type === "text")?.text;
  return { done: true, error: textSummary || "Lyria model_output adımında ses bulunamadı." };
}

export function buildLyriaPrompt(scenario, musicBrief = {}) {
  const description = String(musicBrief.description || "").trim();
  if (description) {
    return /instrumental/i.test(description) ? description : `${description} Instrumental only. No vocals.`;
  }
  const scenarioText = String(scenario || "").trim();
  const mood = String(musicBrief.mood || "").trim();
  const energy = String(musicBrief.energy || "").trim();
  const tempo = String(musicBrief.tempo || "").trim();
  const hints = [mood && `mood: ${mood}`, energy && `energy: ${energy}`, tempo && `tempo: ${tempo}`].filter(Boolean).join(", ");
  return `Premium modern commercial soundtrack for this scene: "${scenarioText}".${hints ? ` (${hints})` : ""} Clean and elegant atmosphere, optimistic progression, refined instrumentation designed to sit underneath spoken narration. Instrumental only. No vocals.`;
}

export async function generateLyriaMusic({ scenario, musicBrief, musicPrompt, durationSeconds, tier = "clip", confirmed } = {}, env = process.env) {
  if (confirmed !== true) throw new Error("Lyria müzik üretimi onay (confirmed:true) gerektirir — ücretli bir işlemdir.");
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!LYRIA_TIERS.includes(tier)) throw new Error(`Desteklenmeyen Lyria tier'ı: "${tier}". Kullanılabilir: ${LYRIA_TIERS.join(", ")}.`);
  const scenarioText = String(scenario || "").trim();
  const explicitPrompt = String(musicPrompt || "").trim();
  if (!scenarioText && !explicitPrompt) throw new Error("scenario veya musicPrompt gerekli.");
  const model = LYRIA_MODELS[tier];
  let finalPrompt = explicitPrompt
    ? (/instrumental/i.test(explicitPrompt) ? explicitPrompt : `${explicitPrompt} Instrumental only. No vocals.`)
    : buildLyriaPrompt(scenarioText, musicBrief || {});

  if (Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0) {
    finalPrompt = `${finalPrompt} Target duration: approximately ${Math.round(Number(durationSeconds))} seconds.`;
  }

  const response = await fetch(`${API_BASE}/interactions`, {
    method: "POST",
    headers: lyriaHeaders(env),
    body: JSON.stringify({ model, input: [{ type: "text", text: finalPrompt }], response_format: { type: "audio" } })
  });
  const data = await readLyriaJson(response, { model });
  const output = extractLyriaOutput(data);
  if (output.error) throw new Error(`Lyria müzik üretimi tamamlandı ama ses üretmedi: ${output.error}`);
  if (!output.done) {
    return { provider: "lyria", model, tier, status: "IN_PROGRESS", interactionId: String(data.id || data.name || ""), generatedPrompt: finalPrompt };
  }
  let audioBuffer, mimeType;
  if (output.base64Data) {
    audioBuffer = Buffer.from(output.base64Data, "base64");
    mimeType = output.mimeType;
  } else {
    const audioResponse = await fetch(output.uri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
    if (!audioResponse.ok) throw new Error(`Müzik indirilemedi (HTTP ${audioResponse.status}).`);
    audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    mimeType = output.mimeType || "audio/mpeg";
  }
  return { provider: "lyria", model, tier, status: "COMPLETED", audioBuffer, mimeType, generatedPrompt: finalPrompt };
}

export async function lyriaMusicStatus(job, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.interactionId) throw new Error("Lyria iş bilgisi eksik.");
  const response = await fetch(`${API_BASE}/interactions/${job.interactionId}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const data = await readLyriaJson(response, { model: job.model });
  const output = extractLyriaOutput(data);
  if (!output.done) return { ...job, status: "IN_PROGRESS" };
  if (output.error) throw new Error(`Lyria müzik üretimi tamamlandı ama ses üretmedi: ${output.error}`);
  let audioBuffer, mimeType;
  if (output.base64Data) {
    audioBuffer = Buffer.from(output.base64Data, "base64");
    mimeType = output.mimeType;
  } else {
    const audioResponse = await fetch(output.uri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
    if (!audioResponse.ok) throw new Error(`Müzik indirilemedi (HTTP ${audioResponse.status}).`);
    audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    mimeType = output.mimeType || "audio/mpeg";
  }
  return { ...job, status: "COMPLETED", audioBuffer, mimeType };
}
