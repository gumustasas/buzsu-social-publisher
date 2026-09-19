// TASK-003: Google'ın Gemini API'sinde model listeleme (GET /v1beta/models)
// ÜCRETSİZDİR — bir üretim/generation çağrısı DEĞİL, salt bir discovery
// isteğidir. video-provider-capabilities.js (Veo/Omni/Nano Banana 2/Lite/Pro)
// ve scene-image.js (Nano Banana Pro'nun generateSceneImage çağrısından ÖNCE
// gerçekten discovery'de listelenip listelenmediğini doğrulaması) AYNI bu
// fonksiyonu kullanır — provider discovery mantığı iki dosyada AYRI AYRI
// icat edilmez (bkz. TASK-003 goal: "without duplicating provider logic").
//
// Anahtar yoksa veya ağ isteği herhangi bir sebeple başarısız olursa
// (örn. bu ortamdan Google'a erişim engelli) sessizce null'a düşülür —
// çağıran taraf bu durumda "anahtar var mı" bilgisine geri düşer, hiçbir
// zaman bir hata fırlatmaz (video-provider-capabilities.js'in mevcut ilkesi,
// birebir korunur).
export async function listGeminiModels(env, { fetchImpl = fetch } = {}) {
  if (!env.GEMINI_API_KEY) return null;
  try {
    const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY }
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.models)) return null;
    return new Set(data.models.map((model) => String(model?.name || "").replace(/^models\//, "")));
  } catch {
    return null;
  }
}
