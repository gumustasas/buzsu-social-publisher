import { buildComparisonPrompt } from "./prompt.js";
import { VISUAL_VALIDATION_CHECKS } from "./checks.js";

// TASK-004: src/lib/scene-validation.js ile AYNI Gemini generateContent
// taşıması/uç noktası — ayrı bir HTTP mimarisi icat edilmedi. Buradaki fark,
// tek bir görsel + metin bağlamı değil, İKİ görsel (referans + üretilen)
// gönderilmesidir: model ikisini yan yana karşılaştırır.
const DEFAULT_MODEL = "gemini-3.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Gemini'nin structured-output desteği: failedChecks sabit
// VISUAL_VALIDATION_CHECKS enum'ına, notes ise string'e ZORLANIR. Bu yalnız
// bir İYİLEŞTİRMEDİR — şemayı desteklemeyen/yok sayan bir model ortamına
// karşı aşağıdaki fail-closed doğrulaması AYNEN uygulanır, bu şemaya
// güvenilerek atlanmaz.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    failedChecks: {
      type: "array",
      items: { type: "string", enum: [...VISUAL_VALIDATION_CHECKS] }
    },
    notes: { type: "string" }
  },
  required: ["failedChecks", "notes"]
};

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
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);

  const text = data.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;

  // FAIL-CLOSED (ROOT review, PR #103): scene-validation.js'in soft-fail
  // ilkesinden BİLİNÇLİ OLARAK FARKLI — bu birincil, açıkça çağrılan bir
  // doğrulama tool'udur, ikincil bir otomatik inceleme DEĞİLDİR. Boş/eksik
  // yanıt, bozuk JSON veya beklenen şekilde OLMAYAN bir failedChecks asla
  // "hiç kontrol başarısız olmadı" (passed:true) ile AYNI ŞEY DEĞİLDİR —
  // bozuk bir ürün görselini sessizce onaylayabilir. Bu durumların HİÇBİRİ
  // onarılmaya/varsayılana ÇEVRİLMEZ, açık bir hata fırlatılır.
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Gemini karşılaştırma yanıtı boş/eksik döndü — fail-closed: sonuç ASLA 'geçti' (passed:true) olarak değerlendirilmez.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini karşılaştırma yanıtı geçersiz JSON döndürdü — fail-closed: sonuç ASLA 'geçti' (passed:true) olarak değerlendirilmez.");
  }

  if (!Array.isArray(parsed.failedChecks)) {
    throw new Error("Gemini karşılaştırma yanıtı geçersiz şekilde döndü (failedChecks dizi değil) — fail-closed: sonuç ASLA 'geçti' (passed:true) olarak değerlendirilmez.");
  }

  return {
    failedChecks: parsed.failedChecks,
    notes: typeof parsed.notes === "string" ? parsed.notes : ""
  };
}
