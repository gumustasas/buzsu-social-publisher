import { fetchProductContext } from "./lib/product-context.js";

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

// OPENAI_API_KEY'in kredisi tükendi (bkz. src/scene-image.js'teki kredili
// OPENAI_IMAGE_API_KEY ayrımı) — tüm OpenAI metin çağrıları da artık aynı
// kredili anahtarı kullanır; ayrı bir metin anahtarına gerek yok.
function openaiTextApiKey(env) {
  return env.OPENAI_IMAGE_API_KEY || env.OPENAI_API_KEY;
}

// Panelde AI sağlayıcısı dropdown'u sahne GÖRSELİ (gemini/openai/openai-low/
// composite — bkz. src/scene-image.js, src/scene-composite.js) ile sahne
// planı/başlık METNİ arasında paylaşılıyor. "openai-low" ve "composite"
// yalnızca görsel üretim seçenekleridir (composite Gemini tabanlı), metin
// üretiminde sırasıyla "openai"/"gemini" ile aynı şekilde çalışmalı.
function normalizeTextProvider(provider) {
  if (provider === "openai-low") return "openai";
  if (provider === "composite") return "gemini";
  return provider;
}

export function availableProviders(env = process.env) {
  return [
    openaiTextApiKey(env) && "openai",
    env.ANTHROPIC_API_KEY && "anthropic",
    env.GEMINI_API_KEY && "gemini",
    env.FAL_KEY && "fal",
    env.GEMINI_API_KEY && "veo"
  ].filter(Boolean);
}

function scenePlanPrompt(product, context) {
  const grounding = context
    ? `Ürün hakkında buzsu.com.tr'den alınan gerçek bilgi:\n"""\n${context}\n"""\n\nÖnce bu bilgiye göre ürünün GERÇEKTE ne olduğunu ve nerede/nasıl kullanıldığını anla.`
    : `Ürün hakkında ek bilgi bulunamadı; ürün adından mantıklı bir çıkarım yap.`;
  return `Buzsu için "${product.title}" ürününün sosyal medya sahne görseli üretiminde kullanılacak bir sahne açıklaması yaz.

${grounding}

Sahneyi ürünün gerçek kullanım ortamına göre kurgula. ÖRNEĞİN ürün mutfakta kullanılan, içme suyu veren bir cihazsa (mutfak altı/üstü su arıtma cihazı gibi) şu şablonu kullanabilirsin:
- Cihaz, mutfak tezgahı ALTINDAKİ dolabın içinde; dolap kapakları açık, cihaz görünüyor.
- Cihazın kendi üzerinde veya hemen yanında HİÇBİR musluk yok.
- Tezgah ÜSTÜNDE, ayrı ve bağımsız 3 yollu bir su arıtma musluğu var; su bu musluktan akıyor.
- Mutlu bir aile sahnesi: bir çocuk musluktan bardağa su dolduruyor, diğer çocuk suyunu içiyor, anne ve baba ellerinde berrak, duru su dolu bardaklarla gülümsüyor.

Ama ürün bu değilse (örneğin bina/apartman su girişine veya boruya takılan bir kireç önleyici, bir sayaç, bir filtre kartuşu, dışarıda kullanılan bir ekipman vb.) BU ŞABLONU ZORLAMA — ürünün gerçekte kurulduğu/kullanıldığı yeri (teknik oda, bodrum, su sayacı yanı, boru hattı, bahçe vb.) gerçekçi şekilde tarif et; mutfak veya aile sahnesi sadece ürün gerçekten mutfakta/içme suyunda kullanılıyorsa uygun olur.

Her durumda: sıcak, doğal ışık; gerçekçi, reklam kalitesinde bir sahne olsun. Yalnızca sahnenin kendisini tarif eden, 2-4 cümlelik tek bir Türkçe paragraf yaz — talimat cümlesi ("şunu koru" gibi) veya ürün marka adı/teknik özellik ekleme, sadece ortamı ve (varsa) insanları tarif et. Başka açıklama, başlık veya tırnak işareti ekleme, yalnızca sahne metnini döndür.`;
}

export async function generateScenePlan(provider, product, env = process.env) {
  provider = normalizeTextProvider(provider);
  if (provider !== "openai" && provider !== "gemini") throw new Error("Desteklenmeyen AI sağlayıcısı.");
  const context = await fetchProductContext(product);
  const input = scenePlanPrompt(product, context);
  let raw;
  if (provider === "openai") {
    // Kısa bir sahne açıklaması için gpt-5.6 gibi pahalı bir model gerekmez;
    // düşük maliyetli ama stabil gpt-5.4-nano'ya sabit.
    const model = env.OPENAI_SCENE_PLAN_MODEL || "gpt-5.4-nano";
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openaiTextApiKey(env)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input, store: false }) });
    raw = textFromOpenAI(data);
  } else {
    const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input }] }] }) });
    raw = textFromGemini(data);
  }
  const plan = raw.trim();
  if (!plan) throw new Error("AI sahne planı boş döndü.");
  return plan;
}

function captionPrompt(product, context) {
  const grounding = context
    ? `Ürün hakkında buzsu.com.tr'den alınan gerçek bilgi:\n"""\n${context}\n"""\n\nMetni bu gerçek bilgiye dayandır, uydurma özellik ekleme.`
    : `Ürün hakkında ek bilgi bulunamadı; yalnızca ürün adına dayanarak genel geçer bir metin yaz, uydurma teknik özellik ekleme.`;
  return `Buzsu için "${product.title}" ürününün Instagram ve Facebook gönderisi için SEO ve satış odaklı, samimi bir Türkçe metin yaz.

${grounding}

2-4 emoji kullan, aşırıya kaçma. Ürünün genel faydasından bahset ama sağlık, tedavi, kesin sonuç, garanti gibi kanıtsız iddialar veya "en iyi" gibi abartılı üstünlük ifadeleri kullanma. Instagram ve Facebook için birbirine yakın ama ayrı iki versiyon yaz (Facebook biraz daha bilgilendirici olabilir). Ayrıca 4-6 adet ilgili Türkçe hashtag üret (# ile başlasın, aralarında boşluk, #Buzsu mutlaka olsun). Metinlerin sonuna link veya "Detaylar:" gibi bir bağlantı satırı EKLEME, link ayrıca otomatik eklenecek. Çıktıyı yalnızca şu JSON şemasına göre ver: {"instagramText":"...","facebookText":"...","hashtags":"#Buzsu #..."}`;
}

export async function generateCaption(provider, product, env = process.env) {
  provider = normalizeTextProvider(provider);
  if (provider !== "openai" && provider !== "gemini") throw new Error("Desteklenmeyen AI sağlayıcısı.");
  const context = await fetchProductContext(product);
  const input = captionPrompt(product, context);
  let raw;
  if (provider === "openai") {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openaiTextApiKey(env)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_REEL_MODEL || "gpt-5.6", input, store: false }) });
    raw = textFromOpenAI(data);
  } else {
    const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input }] }], generationConfig: { responseMimeType: "application/json" } }) });
    raw = textFromGemini(data);
  }
  const parsed = parseJson(raw);
  const instagramText = String(parsed.instagramText || "").trim();
  const facebookText = String(parsed.facebookText || "").trim();
  if (!instagramText || !facebookText) throw new Error("AI metni boş döndü.");
  return { instagramText, facebookText, hashtags: String(parsed.hashtags || "#Buzsu").trim() };
}

function motionPlanPrompt(sceneDescription) {
  const scene = String(sceneDescription || "").trim();
  const context = scene ? `Sahne: "${scene}".` : `Sahne açıklaması verilmedi; genel bir ürün sahnesi olduğunu varsay.`;
  return `${context} Bu sahnenin fotoğrafından 9:16 dikey bir reklam videosu üretilecek. Bu sahne için 1-2 cümlelik, doğal ve sinematik bir KAMERA/HAREKET planı yaz (kimin ne yaptığı, kameranın nasıl hareket ettiği gibi). Sahneyi yeniden tarif etme, sadece hareketi anlat. Türkçe yaz, yalnızca hareket cümlesini döndür — başka açıklama, tırnak işareti veya başlık ekleme.`;
}

// Kullanıcı "Video hareketi" alanını boş bırakırsa, sahne açıklamasından bu
// fonksiyonla kısa bir hareket planı türetilir (bkz. api/reels.js önizleme
// dalı). generateScenePlan ile aynı openai/gemini deseni kullanılıyor.
export async function generateMotionPlan(provider, sceneDescription, env = process.env) {
  provider = normalizeTextProvider(provider);
  if (provider !== "openai" && provider !== "gemini") throw new Error("Desteklenmeyen AI sağlayıcısı.");
  const input = motionPlanPrompt(sceneDescription);
  let raw;
  if (provider === "openai") {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openaiTextApiKey(env)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_REEL_MODEL || "gpt-5.6", input, store: false }) });
    raw = textFromOpenAI(data);
  } else {
    const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input }] }] }) });
    raw = textFromGemini(data);
  }
  const motion = raw.trim();
  if (!motion) throw new Error("AI hareket planı boş döndü.");
  return motion;
}

export async function generateReelPackage(provider, product, env = process.env) {
  const input = prompt(product);
  let raw;
  if (provider === "openai") {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openaiTextApiKey(env)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_REEL_MODEL || "gpt-5.6", input, store: false }) });
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
