const reelSchema = `{"hook":"kısa açılış","voiceover":"Türkçe seslendirme metni","scenes":[{"seconds":3,"visual":"görsel açıklaması","on_screen_text":"ekran yazısı"}],"caption":"Instagram açıklaması","hashtags":["#Buzsu"],"cta":"kısa çağrı","disclaimer":"gerekirse sınırlama"}`;

function prompt(product) {
  return `Buzsu için 20-30 saniyelik dikey bir ürün Reels paketi hazırla. Ürün adı: ${product.title}. Ürün sayfası: ${product.url}. Görsel: ${product.imageUrl}. Sadece verilen ürün bilgisine dayan; sağlık, tedavi, kesin sonuç, en iyi ve kanıtsız garanti iddiaları kullanma. Türkçe yaz. 9:16 mobil video için sahneleri 2-5 saniyelik planla. Çıktıyı yalnızca şu JSON şemasına göre ver: ${reelSchema}`;
}

function parseJson(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new Error("AI yanıtı geçerli JSON değil."); }
}

function textFromOpenAI(data) { return data.output_text || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join(""); }
function textFromAnthropic(data) { return (data.content || []).filter((item) => item.type === "text").map((item) => item.text).join(""); }
function textFromGemini(data) { return (data.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text || "").join(""); }

async function request(url, options) {
  const response = await fetch(url, options); const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error?.type || `AI HTTP ${response.status}`);
  return data;
}

export function availableProviders(env = process.env) {
  return ["openai", "anthropic", "gemini", "fal"].filter((provider) => Boolean(env[provider === "openai" ? "OPENAI_API_KEY" : provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "gemini" ? "GEMINI_API_KEY" : "FAL_KEY"]));
}

function scenePlanPrompt(product) {
  return `Buzsu için "${product.title}" ürününün sosyal medya sahne görseli üretiminde kullanılacak bir sahne açıklaması yaz. Aşağıdaki kurulum şablonunu birebir takip et, sadece küçük ayrıntıları (aile üyelerinin duruşu, ışık, dekor detayları) değiştirerek doğal bir varyasyon üret:

- Cihaz, mutfak tezgahı ALTINDAKİ dolabın içinde; dolap kapakları açık, cihaz görünüyor.
- Cihazın kendi üzerinde veya hemen yanında HİÇBİR musluk yok.
- Tezgah ÜSTÜNDE, ayrı ve bağımsız 3 yollu bir su arıtma musluğu var; su bu musluktan akıyor.
- Mutlu bir aile sahnesi: bir çocuk musluktan bardağa su dolduruyor, diğer çocuk suyunu içiyor, anne ve baba ellerinde berrak, duru su dolu bardaklarla gülümsüyor.
- Sıcak, doğal mutfak ışığı; gerçekçi, reklam kalitesinde bir sahne.

Yalnızca sahnenin kendisini tarif eden, 2-4 cümlelik tek bir Türkçe paragraf yaz — talimat cümlesi ("şunu koru" gibi) veya ürün marka adı/teknik özellik ekleme, sadece ortamı ve insanları tarif et. Başka açıklama, başlık veya tırnak işareti ekleme, yalnızca sahne metnini döndür.`;
}

export async function generateScenePlan(provider, product, env = process.env) {
  const input = scenePlanPrompt(product);
  let raw;
  if (provider === "openai") {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_REEL_MODEL || "gpt-5.6", input, store: false }) });
    raw = textFromOpenAI(data);
  } else if (provider === "gemini") {
    const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input }] }] }) });
    raw = textFromGemini(data);
  } else throw new Error("Desteklenmeyen AI sağlayıcısı.");
  const plan = raw.trim();
  if (!plan) throw new Error("AI sahne planı boş döndü.");
  return plan;
}

export async function generateReelPackage(provider, product, env = process.env) {
  const input = prompt(product);
  let raw;
  if (provider === "openai") {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_REEL_MODEL || "gpt-5.6", input, store: false }) });
    raw = textFromOpenAI(data);
  } else if (provider === "anthropic") {
    const data = await request("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: env.ANTHROPIC_REEL_MODEL || "claude-sonnet-4-20250514", max_tokens: 1800, system: "Yanıtı yalnızca geçerli JSON olarak ver.", messages: [{ role: "user", content: input }] }) });
    raw = textFromAnthropic(data);
  } else if (provider === "gemini") {
    const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input }] }], generationConfig: { responseMimeType: "application/json" } }) });
    raw = textFromGemini(data);
  } else throw new Error("Desteklenmeyen AI sağlayıcısı.");
  return { provider, product: product.title, generatedAt: new Date().toISOString(), ...parseJson(raw) };
}
