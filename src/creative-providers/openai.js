import { openaiTextApiKey } from "../ai-providers.js";

// AI Reels V2 PR-B: Creative Provider abstraction — model DISCOVERY katmanı.
// OpenAI'nin GET /v1/models uç noktası ÜCRETSİZDİR (envanter okuma,
// generation/inference DEĞİL) — bu modül SADECE bu uç noktayı çağırır,
// hiçbir completion/responses isteği atmaz. Amaç: model-registry.js'e
// gerçekten erişilebilir model kimliklerini vermek — TAHMİNİ/uydurma bir
// model adı ASLA registry'ye eklenmez.
//
// BİLİNEN SINIRLAMA: OpenAI'nin /v1/models yanıtı {id, created, owned_by,
// object} dışında hiçbir capability/tip alanı DÖNDÜRMEZ (Google'ın
// supportedGenerationMethods'ının bir eşdeğeri yok). Bu yüzden görsel/TTS/
// embedding/moderation/transkripsiyon/gerçek-zamanlı-ses gibi metin-dışı
// aileleri bilinen ID kalıplarına göre bir DENYLIST ile eliyoruz — bu
// DOĞRULANMIŞ bir capability alanı değil, en iyi tahmin bir sezgiseldir.
// Registry'nin asıl güvenlik ağı bu sezgisel filtre değil, tier'ların
// env override + gerçek discovery eşleşmesiyle doğrulanmasıdır (bkz.
// model-registry.js resolveTier) — bu filtre yalnızca ham listeyi
// kabaca temizler.
const NON_TEXT_ID_PATTERNS = [
  /dall-e/i, /gpt-image/i, /whisper/i, /^tts-/i, /-tts(-|$)/i, /embedding/i,
  /moderation/i, /realtime/i, /audio/i, /\bsora\b/i, /computer-use/i, /transcribe/i,
  /^babbage/i, /^davinci/i, /^ada(-|$)/i, /^curie(-|$)/i
];

export function isOpenAiTextModel(id) {
  return !NON_TEXT_ID_PATTERNS.some((pattern) => pattern.test(String(id || "")));
}

// available:false + reason ile döner, ASLA throw etmez — bir provider'ın
// key'i yoksa veya API'si geçici olarak başarısızsa diğer provider'ın
// discovery'sini (bkz. model-registry.js discoverCreativeModels) etkilememeli.
export async function listOpenAiModels(env = process.env, { fetchImpl = fetch } = {}) {
  const apiKey = openaiTextApiKey(env);
  if (!apiKey) return { provider: "openai", available: false, reason: "missing_api_key", models: [] };

  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (error) {
    return { provider: "openai", available: false, reason: "list_models_failed", error: error.message, models: [] };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    return { provider: "openai", available: false, reason: "list_models_failed", error: data?.error?.message || `HTTP ${response.status}`, models: [] };
  }

  const models = (data.data || [])
    .filter((item) => isOpenAiTextModel(item.id))
    // OpenAI ayrı bir "displayName" alanı döndürmez — id ile aynı bırakılır
    // (Google'daki gibi insan-okunur bir isim burada YOKTUR, uydurulmadı).
    .map((item) => ({ provider: "openai", model: item.id, displayName: item.id, capabilities: ["text"], available: true }));

  return { provider: "openai", available: true, models };
}
