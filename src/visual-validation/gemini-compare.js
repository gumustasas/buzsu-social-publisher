import { buildComparisonPrompt } from "./prompt.js";

// TASK-004: src/lib/scene-validation.js ile AYNI Gemini generateContent
// taşıması/uç noktası — ayrı bir HTTP mimarisi icat edilmedi. Buradaki fark,
// tek bir görsel + metin bağlamı değil, İKİ görsel (referans + üretilen)
// gönderilmesidir: model ikisini yan yana karşılaştırır.
const DEFAULT_MODEL = "gemini-3.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// GERÇEK PARA HARCAR — confirmed kontrolü çağıran tarafta (bkz. api/mcp.js)
// yapılır, bu fonksiyon kendisi confirmed bilmez (research/transcription
// katmanlarıyla AYNI ayrım: MCP sınırındaki bir kavramdır).
export async function compareProductVisuals(
  { referenceBuffer, referenceMimeType, generatedBuffer, generatedMimeType, productTitle, sceneDescription },
  env = process.env,
  { fetchImpl = fetch } = {}
) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY tanımlı değil.");

  const model = env.GEMINI_VISUAL_VALIDATION_MODEL || DEFAULT_MODEL;
  const prompt = buildComparisonPrompt({ productTitle, sceneDescription });

  const response = await fetchImpl(`${API_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: referenceMimeType, data: referenceBuffer.toString("base64") } },
          { inlineData: { mimeType: generatedMimeType, data: generatedBuffer.toString("base64") } }
        ]
      }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);

  const text = data.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // scene-validation.js'in mevcut ilkesiyle AYNI: bozuk/JSON-olmayan bir
    // yanıt "hiç kontrol başarısız olmadı" gibi ele alınır — sanki model
    // failedChecks:[] demiş gibi. Bu bir onarım DEĞİLDİR, yalnızca boş bir
    // yanıtla aynı muameledir; JSON onarılmaya çalışılmaz.
    parsed = {};
  }

  return {
    failedChecks: Array.isArray(parsed.failedChecks) ? parsed.failedChecks : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : ""
  };
}
