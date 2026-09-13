// AI Reels V2 PR-B: Creative Provider abstraction — model DISCOVERY katmanı.
// Google Gemini'nin GET /v1beta/models uç noktası ÜCRETSİZDİR (envanter
// okuma) — bu modül SADECE bu uç noktayı çağırır, hiçbir generateContent
// isteği atmaz. GEMINI_API_KEY reuse edilir (bkz. src/ai-providers.js,
// src/veo-video.js) — yeni bir env değişkeni icat edilmedi.
//
// Google, OpenAI'nin aksine GERÇEK bir capability sinyali döner:
// supportedGenerationMethods (ör. "generateContent") — bu yüzden buradaki
// filtre OpenAI'ninkinden daha güvenilirdir. Ama görsel/TTS/Veo/Lyria gibi
// generateContent destekleyebilen (ör. gemini-3.1-flash-lite-image, bkz.
// scene-image.js) ama metin-senaryo modeli OLMAYAN aileleri elemek için
// yine de bir isim deny-list'i gerekir.
const NON_TEXT_NAME_PATTERNS = [/image/i, /^imagen/i, /veo-/i, /lyria-/i, /embedding/i, /\baqa\b/i, /-tts(-|$)/i, /live-/i];
const MAX_PAGES = 5; // Gemini'nin model sayısı küçük (~onlarca) — sonsuz sayfalama döngüsüne karşı güvenlik sınırı.

export function stripModelsPrefix(name) {
  return String(name || "").replace(/^models\//, "");
}

export function isGoogleTextModel(model) {
  const supportsGenerateContent = Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent");
  if (!supportsGenerateContent) return false;
  const id = stripModelsPrefix(model.name);
  return !NON_TEXT_NAME_PATTERNS.some((pattern) => pattern.test(id));
}

// available:false + reason ile döner, ASLA throw etmez (bkz. openai.js aynı sözleşme).
export async function listGoogleModels(env = process.env, { fetchImpl = fetch } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { provider: "google", available: false, reason: "missing_api_key", models: [] };

  const collected = [];
  let pageToken = "";
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetchImpl(url.toString(), { headers: { "x-goog-api-key": apiKey } });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        return { provider: "google", available: false, reason: "list_models_failed", error: data?.error?.message || `HTTP ${response.status}`, models: [] };
      }
      collected.push(...(data.models || []));
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
  } catch (error) {
    return { provider: "google", available: false, reason: "list_models_failed", error: error.message, models: [] };
  }

  const models = collected
    .filter(isGoogleTextModel)
    .map((item) => ({
      provider: "google",
      model: stripModelsPrefix(item.name),
      displayName: item.displayName || stripModelsPrefix(item.name),
      capabilities: ["text"],
      available: true
    }));

  return { provider: "google", available: true, models };
}
