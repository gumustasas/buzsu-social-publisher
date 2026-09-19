import { fetchMediaBytes } from "./media-fetch.js";

// TASK-002 — Google adapter. Gemini gerçekten multimodaldir: video/ses
// dosyasını inlineData olarak generateContent'e verip birebir transkript
// istemek yeterlidir (aynı GEMINI_API_KEY, aynı uç nokta — research/
// google-search.js/creative-providers/google.js ile aynı HTTP taşıması).
// Zaman damgaları/diarization STRUCTURED bir API alanı DEĞİLDİR — modelden
// yapılandırılmış JSON istenir (TAHMİNİ/best-effort, bkz. provider.js
// timestampAccuracy). GERÇEK PARA HARCAR — confirmed kontrolü çağıran
// tarafta (bkz. api/mcp.js) yapılır.
const TRANSCRIPT_SCHEMA_HINT = `{"language":"ISO-639-1 dil kodu (ör. tr)","text":"tam ve birebir transkript","segments":[{"startSeconds":0,"endSeconds":4,"text":"bu aralıkta söylenen","speaker":"varsa tahmini konuşmacı etiketi (ör. Speaker 1), yoksa null"}]}`;

function buildPrompt({ languageHint, vocabularyHints, diarization }) {
  const languageBlock = languageHint ? `\n\nBeklenen dil: ${languageHint} (yanlışsa gerçek algılanan dili "language" alanına yaz).` : "";
  const vocabBlock = vocabularyHints.length
    ? `\n\nBu terimler/markalar geçebilir, doğru yaz (uydurma, atlama): ${vocabularyHints.join(", ")}.`
    : "";
  const diarizationBlock = diarization
    ? "\n\nKonuşmacı değişimlerini fark et; her segment için tahmini bir \"speaker\" etiketi ver (ör. \"Speaker 1\"/\"Speaker 2\") — eminlik düşükse tek bir etiket kullan, uydurma isim verme."
    : "";
  return `Verilen ses/videoyu BİREBİR (kelime kelime, uydurma/özetleme YAPMADAN) transkribe et.${languageBlock}${vocabBlock}${diarizationBlock}\n\nYanıtı YALNIZCA şu JSON şemasına göre ver, başka açıklama ekleme: ${TRANSCRIPT_SCHEMA_HINT}`;
}

export async function transcribeWithGoogle({ mediaUrl, languageHint, vocabularyHints = [], diarization = false }, env = process.env, { fetchImpl = fetch, fetchMediaBytesImpl = fetchMediaBytes } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY tanımlı değil.");

  const model = env.GOOGLE_TRANSCRIBE_MODEL || env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
  const { buffer, mimeType } = await fetchMediaBytesImpl(mediaUrl, { fetchImpl });
  const prompt = buildPrompt({ languageHint, vocabularyHints, diarization });

  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType, data: buffer.toString("base64") } }, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);

  const raw = (data.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text || "").join("");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini yanıtı geçerli JSON değil.");
  }

  return {
    text: parsed.text || "",
    language: parsed.language || null,
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    diarizationApplied: diarization === true,
    timestampAccuracy: "best_effort"
  };
}
