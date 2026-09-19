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
//
// PR #102 ROOT review (blocker 3): Gemini'nin /v1beta/models uç noktası
// yalnızca bir sayfa (varsayılan sayfa boyutu) döner ve `nextPageToken` ile
// devam eder — creative-providers/google.js:listGoogleModels'ın ZATEN
// uyguladığı AYNI sayfalama deseni burada da uygulanır (MAX_PAGES güvenlik
// sınırıyla). Yalnızca ilk sayfa okunursa, sonraki sayfalardaki modeller
// (ör. Nano Banana Pro'nun hesaba göre farklı bir sayfada görünmesi) SESSİZCE
// "mevcut değil" sanılabilirdi — bu, discovery-gating'in asıl amacını
// (gerçekten var olanı raporlamak) ihlal eder.
const MAX_PAGES = 5;

export async function listGeminiModels(env, { fetchImpl = fetch } = {}) {
  if (!env.GEMINI_API_KEY) return null;
  const collected = [];
  let pageToken = "";
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetchImpl(url.toString(), { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.models)) return null;
      collected.push(...data.models);
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
  } catch {
    return null;
  }
  return new Set(collected.map((model) => String(model?.name || "").replace(/^models\//, "")));
}
