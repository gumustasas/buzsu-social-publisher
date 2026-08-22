// Doğal dille yazılan tek cümleyi ("UltraMag için apartman tesisatına takılı,
// teknik oda sahnesi; yarın 10:00'da Instagram gönderisi") composer'ın
// alanlarına (ürün, biçim, platform, zaman, sahne) ayrıştırır.
//
// AI yalnızca metni yorumlar; ürünü KESİN olarak seçmez. Dönen productQuery,
// bilinen ürün listesiyle burada — JS tarafında, deterministik olarak —
// eşleştirilir (matchProduct). Böylece AI'nin var olmayan bir ürün uydurması
// veya yanlış bir id döndürmesi riski ortadan kalkar.
import { baseProductTitle } from "./product-title.js";

function textFromOpenAI(data) { return data.output_text || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join(""); }
function textFromAnthropic(data) { return (data.content || []).filter((item) => item.type === "text").map((item) => item.text).join(""); }
function textFromGemini(data) { return (data.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text || "").join(""); }

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error?.type || `AI HTTP ${response.status}`);
  return data;
}

function parseJson(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new Error("AI yanıtı geçerli JSON değil."); }
}

const SCHEMA = `{"productQuery":"cümlede geçen ürün adı ifadesi, yoksa boş","format":"Gönderi veya Hikâye, belirtilmemişse boş","platforms":["Instagram","Facebook" içinden bahsedilenler; hiçbiri belirtilmemişse ikisi de],"sceneDescription":"sahne/görsel/ortam isteği varsa aynen, yoksa boş","removeFaucet":"tezgahta ayrı bir musluk isteniyorsa true, yoksa false","publishAt":"ISO 8601 tarih-saat, hesaplanabiliyorsa; hesaplanamıyorsa boş","wantsSceneImage":"sahne görseli isteniyorsa true, yoksa false"}`;

function intentPrompt(text, nowIso) {
  return `Bir sosyal medya içerik isteğini ayrıştır. Şu an: ${nowIso} (UTC, ISO 8601; Türkiye saati bu saatten 3 saat ileridir).

Kullanıcının cümlesi: "${text}"

Cümleyi yorumla ve YALNIZCA şu JSON şemasına göre yanıt ver, başka açıklama ekleme: ${SCHEMA}

Kurallar:
- productQuery: cümlede geçen ürün adını olabildiğince aynen al; ürün adı geçmiyorsa boş bırak.
- publishAt: "yarın 10:00", "bu akşam", "pazartesi sabahı" gibi göreli ifadeleri yukarıdaki "şu an" bilgisine göre Türkiye saatiyle gerçek bir ISO 8601 tarih-saate çevir (UTC olarak döndür). Emin değilsen boş bırak, tahmin etme.
- Cümlede hiç zaman geçmiyorsa publishAt'i boş bırak.
- sceneDescription: yalnızca kullanıcı sahne/görsel/ortam tarif ettiyse doldur; aksi halde boş bırak.`;
}

function isValidIso(value) {
  if (typeof value !== "string" || !value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export async function parseIntentFields(provider, text, env = process.env) {
  if (!["openai", "anthropic", "gemini"].includes(provider)) throw new Error("Desteklenmeyen AI sağlayıcısı.");
  const input = intentPrompt(text, new Date().toISOString());
  let raw;
  if (provider === "openai") {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_REEL_MODEL || "gpt-5.6", input, store: false }) });
    raw = textFromOpenAI(data);
  } else if (provider === "anthropic") {
    const data = await request("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: env.ANTHROPIC_REEL_MODEL || "claude-sonnet-4-20250514", max_tokens: 600, system: "Yanıtı yalnızca geçerli JSON olarak ver.", messages: [{ role: "user", content: input }] }) });
    raw = textFromAnthropic(data);
  } else {
    const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input }] }], generationConfig: { responseMimeType: "application/json" } }) });
    raw = textFromGemini(data);
  }
  const parsed = parseJson(raw);
  return {
    productQuery: String(parsed.productQuery || "").trim(),
    format: ["Gönderi", "Hikâye"].includes(parsed.format) ? parsed.format : "",
    platforms: Array.isArray(parsed.platforms) ? parsed.platforms.filter((p) => ["Instagram", "Facebook"].includes(p)) : [],
    sceneDescription: String(parsed.sceneDescription || "").trim(),
    removeFaucet: Boolean(parsed.removeFaucet),
    publishAt: isValidIso(parsed.publishAt) ? parsed.publishAt : "",
    wantsSceneImage: Boolean(parsed.wantsSceneImage)
  };
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Bilinen ürün listesiyle en iyi eşleşmeyi bulur — sırasıyla tam eşleşme,
// içerme ve kelime örtüşmesi denenir. AI'nin ürün adını birebir doğru
// yazmadığı (örn. "ultramag" vs "UltraMag Apartman Tipi Manyetik Kireç
// Önleyici") durumlarda bile makul bir eşleşme bulmak içindir.
export function matchProduct(query, products) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || !Array.isArray(products) || !products.length) return null;

  const exact = products.find((p) => normalize(baseProductTitle(p.title)) === normalizedQuery);
  if (exact) return exact;

  const contains = products.find((p) => {
    const title = normalize(baseProductTitle(p.title));
    return title && (title.includes(normalizedQuery) || normalizedQuery.includes(title));
  });
  if (contains) return contains;

  const queryWords = new Set(normalizedQuery.split(/\s+/).filter((w) => w.length > 2));
  if (!queryWords.size) return null;
  let best = null;
  let bestScore = 0;
  for (const product of products) {
    const titleWords = normalize(baseProductTitle(product.title)).split(/\s+/);
    const score = titleWords.filter((w) => queryWords.has(w)).length;
    if (score > bestScore) { bestScore = score; best = product; }
  }
  return bestScore > 0 ? best : null;
}

export async function parseIntent(provider, text, products, env = process.env) {
  const fields = await parseIntentFields(provider, text, env);
  const product = matchProduct(fields.productQuery, products);
  return {
    ...fields,
    platforms: fields.platforms.length ? fields.platforms : ["Instagram", "Facebook"],
    productId: product ? product.id : "",
    productTitle: product ? product.title : "",
    productImageUrl: product ? product.imageUrl : ""
  };
}
