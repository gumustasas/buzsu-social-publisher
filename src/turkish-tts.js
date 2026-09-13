// generate_turkish_voiceover — Google'ın Gemini TTS modeliyle (Interactions
// API üzerinden) TÜRKÇE seslendirme sesi üretir. src/omni-video.js'teki
// Interactions API deseniyle (steps[]/model_output ayrıştırma, RATE_LIMITED
// sınıflandırması, confirmed:true zorunluluğu) BİREBİR aynı disiplin
// uygulanır — o dosyaya dokunulmaz, burada bağımsız bir kopyası tutulur.
//
// NOT — doğrulama sınırı: model kimliği (gemini-3.1-flash-tts-preview)
// Google'ın kendi doküman sayfası URL'sinden (ai.google.dev/gemini-api/docs/
// models/gemini-3.1-flash-tts-preview) doğrudan alındı ve Türkçe'nin bu
// modele Nisan 2026'da 16 yeni dil arasında eklendiği Google Workspace
// duyurusuyla teyit edildi — ikisi de yüksek güvenilirlikte. Ancak
// response_format İÇİNDEKİ ses/dil alan adları (voice_name, language_code)
// bu ortamda ai.google.dev'e doğrudan erişim olmadan arama sonuçlarından
// derlendi — gerçek ücretli ilk denemeden önce teyit edilmesi önerilir
// (bkz. README). AYRICA: src/omni-video.js'te video çıktısının Files
// API'de PROCESSING->ACTIVE beklemesi gerektiği öğrenildi (bkz. o dosyanın
// yorumları) — burada bir `uri` gelirse AYNI bekleme uygulanmıyor, doğrudan
// indiriliyor. Bunun güvenli olduğu varsayımı, ses dosyalarının video'dan
// çok daha küçük olması ve response_format'ta "delivery" hiç istenmediği
// için Google'ın küçük ses çıktılarını muhtemelen inline base64 döndürmesi
// beklentisine dayanıyor — DOĞRULANMADI, ilk gerçek denemede izlenmeli.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const TTS_MODEL = "gemini-3.1-flash-tts-preview";
export const TTS_LANGUAGE_CODE = "tr-TR";

// Google'ın prebuilt ses adları (Kore, Puck, Zephyr, Charon vb.) resmi
// olarak "kadın/erkek" diye etiketlenmiyor — bu eşleme, yaygın olarak
// gözlemlenen ton karakterine dayanan bir VARSAYILAN tercihtir, Google'ın
// resmi bir sınıflandırması değildir. Kullanıcı isterse doğrudan `voice`
// parametresiyle bu varsayılanı geçersiz kılabilir.
const VOICE_BY_GENDER = { female: "Kore", male: "Puck", auto: "Kore" };
export const TTS_STYLES = ["reklam", "premium", "samimi", "bilgilendirici"];

function ttsHeaders(env) {
  return { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
}

export class TtsApiError extends Error {
  constructor(message, { code, httpStatus, model, providerStatus, retryAfter = null, details = null } = {}) {
    super(message);
    this.name = "TtsApiError";
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

// Google'ın "bu dil bu modelde desteklenmiyor" hatasını KESİN bir status
// koduyla vermeyeceği varsayılıyor (dokümantasyonda örnek yok) — bu yüzden
// hem status hem mesaj metnine bakılıyor (bkz. src/omni-video.js:
// isRegionUnavailable — aynı savunmacı yaklaşım).
function isLanguageUnavailable(data, httpStatus) {
  const status = String(data?.error?.status || "");
  const message = String(data?.error?.message || "").toLowerCase();
  if (!(httpStatus === 400 || httpStatus === 403 || status === "INVALID_ARGUMENT" || status === "FAILED_PRECONDITION")) return false;
  return /language|locale|tr-tr|turkish|desteklenmiyor|dil/.test(message);
}

async function readTtsJson(response, { model } = {}) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      const safeMessage = redact(data?.error?.message || "HTTP 429");
      throw new TtsApiError(`TTS modeli (${model}) için istek sınırına ulaşıldı. ${safeMessage}`, {
        code: "RATE_LIMITED",
        httpStatus: 429,
        model,
        providerStatus: data?.error?.status || null,
        retryAfter: parseRetryAfter(response, data),
        details: { message: safeMessage }
      });
    }
    if (isLanguageUnavailable(data, response.status)) {
      const safeMessage = redact(data?.error?.message || `HTTP ${response.status}`);
      throw new TtsApiError(`Türkçe (tr-TR) bu TTS modelinde desteklenmiyor. ${safeMessage}`, {
        code: "TURKISH_TTS_UNAVAILABLE",
        httpStatus: response.status,
        model,
        providerStatus: data?.error?.status || null,
        details: { message: safeMessage }
      });
    }
    throw new Error(redact(data.error?.message) || `TTS HTTP ${response.status}`);
  }
  return data;
}

// bkz. src/omni-video.js:extractOmniVideoOutput — aynı steps[]/model_output
// deseni, "video" yerine "audio" için.
function extractTtsOutput(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const modelOutputStep = steps.find((step) => step?.type === "model_output");
  if (!modelOutputStep) return { done: false };
  const parts = Array.isArray(modelOutputStep.content) ? modelOutputStep.content : [];
  const audioPart = parts.find((part) => part?.type === "audio");
  if (audioPart?.uri) return { done: true, uri: audioPart.uri, mimeType: audioPart.mime_type || null };
  if (audioPart?.data) return { done: true, base64Data: audioPart.data, mimeType: audioPart.mime_type || "audio/wav" };
  const textSummary = parts.find((part) => part?.type === "text")?.text;
  return { done: true, error: textSummary || "TTS model_output adımında ses bulunamadı." };
}

// WAV (RIFF/fmt/data) başlığından örnekleme hızı/kanal/bit derinliğini okuyup
// gerçek süreyi HESAPLAR — ffmpeg/ffprobe GEREKMEZ (Vercel serverless'ta
// ikisi de yok). Ham (container'sız) L16 PCM için mime_type'taki "rate="
// parametresi kullanılır. Tanınmayan bir format (örn. sıkıştırılmış mp3)
// için süre ölçülemez — tahmin ETMEK yerine açık bir hata fırlatılır.
export function measureAudioDurationSeconds(buffer, mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (buffer.length >= 44 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
    let offset = 12;
    let sampleRate = null, channels = null, bitsPerSample = null, dataSize = null;
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === "fmt ") {
        channels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        bitsPerSample = buffer.readUInt16LE(offset + 22);
      } else if (chunkId === "data") {
        dataSize = chunkSize;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (sampleRate && channels && bitsPerSample && dataSize) {
      return dataSize / (sampleRate * channels * (bitsPerSample / 8));
    }
  }
  const rateMatch = mime.match(/rate=(\d+)/);
  if (rateMatch && (mime.includes("l16") || mime.includes("pcm"))) {
    const sampleRate = Number(rateMatch[1]);
    return buffer.length / (sampleRate * 2); // L16 = 16-bit mono varsayımı
  }
  throw new Error(`Ses süresi ölçülemedi — tanınmayan format (mime_type: "${mimeType}"). WAV veya ham L16 PCM bekleniyor.`);
}

// text zorunlu. targetDurationSeconds verilirse (generate_video_narration'ın
// estimatedDurationSeconds'ı), gerçek ölçülen süre bunu aşarsa
// VOICEOVER_TOO_LONG hatası fırlatılır — kullanıcı isterse metni AI ile
// kısaltıp tekrar denemelidir (bkz. api/mcp.js açıklaması, madde 7).
// confirmed !== true ise HİÇBİR ağ isteği atılmadan reddedilir.
export async function generateTurkishVoiceover({ text, style, gender = "auto", targetDurationSeconds, voice, confirmed } = {}, env = process.env) {
  if (confirmed !== true) throw new Error("Türkçe seslendirme onay (confirmed:true) gerektirir — ücretli bir işlemdir.");
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  const narrationText = String(text || "").trim();
  if (!narrationText) throw new Error("text boş olamaz.");
  const resolvedVoice = typeof voice === "string" && voice.trim() ? voice.trim() : (VOICE_BY_GENDER[gender] || VOICE_BY_GENDER.auto);

  const response = await fetch(`${API_BASE}/interactions`, {
    method: "POST",
    headers: ttsHeaders(env),
    body: JSON.stringify({
      model: TTS_MODEL,
      input: [{ type: "text", text: narrationText }],
      response_format: { type: "audio", voice_name: resolvedVoice, language_code: TTS_LANGUAGE_CODE }
    })
  });
  const data = await readTtsJson(response, { model: TTS_MODEL });
  const output = extractTtsOutput(data);
  if (output.error) throw new Error(`Türkçe seslendirme tamamlandı ama ses üretmedi: ${output.error}`);
  if (!output.done) {
    return { provider: "gemini-tts", model: TTS_MODEL, status: "IN_PROGRESS", interactionId: String(data.id || data.name || ""), voice: resolvedVoice, language: TTS_LANGUAGE_CODE, narrationText };
  }

  let audioBuffer, mimeType;
  if (output.base64Data) {
    audioBuffer = Buffer.from(output.base64Data, "base64");
    mimeType = output.mimeType;
  } else {
    const audioResponse = await fetch(output.uri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
    if (!audioResponse.ok) throw new Error(`Ses indirilemedi (HTTP ${audioResponse.status}).`);
    audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    mimeType = output.mimeType || "audio/wav";
  }
  const durationSeconds = measureAudioDurationSeconds(audioBuffer, mimeType);
  if (typeof targetDurationSeconds === "number" && targetDurationSeconds > 0 && durationSeconds > targetDurationSeconds * 1.15) {
    const error = new Error(`Seslendirme (${durationSeconds.toFixed(1)}sn) hedef video süresinden (${targetDurationSeconds}sn) çok daha uzun çıktı.`);
    error.code = "VOICEOVER_TOO_LONG";
    error.durationSeconds = durationSeconds;
    error.targetDurationSeconds = targetDurationSeconds;
    throw error;
  }
  return { provider: "gemini-tts", model: TTS_MODEL, status: "COMPLETED", audioBuffer, mimeType, durationSeconds, voice: resolvedVoice, language: TTS_LANGUAGE_CODE, narrationText };
}

export async function turkishVoiceoverStatus(job, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.interactionId) throw new Error("TTS iş bilgisi eksik.");
  const response = await fetch(`${API_BASE}/interactions/${job.interactionId}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const data = await readTtsJson(response, { model: job.model });
  const output = extractTtsOutput(data);
  if (!output.done) return { ...job, status: "IN_PROGRESS" };
  if (output.error) throw new Error(`Türkçe seslendirme tamamlandı ama ses üretmedi: ${output.error}`);
  let audioBuffer, mimeType;
  if (output.base64Data) {
    audioBuffer = Buffer.from(output.base64Data, "base64");
    mimeType = output.mimeType;
  } else {
    const audioResponse = await fetch(output.uri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
    if (!audioResponse.ok) throw new Error(`Ses indirilemedi (HTTP ${audioResponse.status}).`);
    audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    mimeType = output.mimeType || "audio/wav";
  }
  return { ...job, status: "COMPLETED", audioBuffer, mimeType, durationSeconds: measureAudioDurationSeconds(audioBuffer, mimeType) };
}
