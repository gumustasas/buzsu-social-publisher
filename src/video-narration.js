// generate_video_narration — bir video senaryosundan, videonun süresine
// UYGUN uzunlukta Türkçe voice-over metni + o senaryodan türetilmiş bir
// müzik brief'i üretir. Ses/video API'lerine (TTS, Lyria, Omni, Veo) HİÇ
// dokunmaz — yalnızca metin üretimi, mevcut src/ai-providers.js'teki
// generateContent deseniyle aynı (bkz. generateCaption/generateSeoArticle).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Türkçe için belgelenmiş "kesin" bir konuşma hızı yok — bu, doğal, biraz
// yavaş bir reklam seslendirmesi için makul bir TAHMİNDİR (~150 kelime/dk,
// İngilizce reklam seslendirmesi için yaygın kabul edilen orana yakın).
// TTS sonrası GERÇEK ses süresi ölçülüp bu tahminle değil, gerçek değerle
// karşılaştırılır (bkz. src/turkish-tts.js) — bu sabit yalnızca ilk taslağın
// hedef kelime sayısını belirlemek için kullanılır.
export const TURKISH_WORDS_PER_SECOND = 2.5;

const STYLE_HINTS = {
  reklam: "Enerjik, satış odaklı, kısa ve çarpıcı bir reklam seslendirmesi tonu.",
  premium: "Sakin, güven veren, premium bir marka tonu — hızlı satış dili değil.",
  samimi: "Sıcak, samimi, günlük konuşma diline yakın bir aile reklamı tonu.",
  bilgilendirici: "Net, bilgilendirici, ürünün faydasını sakince açıklayan bir ton."
};
export const NARRATION_STYLES = Object.keys(STYLE_HINTS);

function narrationPrompt({ scenario, productName, durationSeconds, style, targetWordCount }) {
  const styleHint = STYLE_HINTS[style] || STYLE_HINTS.reklam;
  return `Aşağıdaki video senaryosu için TÜRKÇE bir voice-over (seslendirme) metni yaz.

SENARYO:
"""
${scenario}
"""
${productName ? `ÜRÜN ADI: ${productName}\n` : ""}
VİDEO SÜRESİ: ${durationSeconds} saniye.
TON: ${styleHint}

KURALLAR:
- Metin YAKLAŞIK ${targetWordCount} kelime olmalı (video süresine sığması için) — bundan çok daha uzun yazma.
- Doğal, konuşma diline uygun Türkçe kullan; yazı dili gibi resmi olma.
- Ürünün gerçek adını ve varsa somut bir faydasını geçir, uydurma teknik özellik ekleme.
- Fiyat, kampanya, indirim gibi iddialar ekleme.
- Yalnızca seslendirme metnini yaz — başlık, açıklama, tırnak işareti veya format ekleme.

Aşağıdaki JSON şemasıyla yanıt ver:
{
  "narrationText": "...",
  "musicBrief": {
    "mood": "...",
    "energy": "düşük | orta | yüksek",
    "tempo": "yavaş | orta | hızlı",
    "description": "Senaryoya uygun, İngilizce, Lyria'ya doğrudan verilebilecek kısa bir müzik açıklaması (örn. 'Clean modern premium commercial soundtrack, warm family feeling, subtle technology character, optimistic, instrumental, no vocals.')"
  }
}`;
}

function textFromGemini(data) {
  return (data.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text || "").join("");
}

function parseJson(raw) {
  const cleaned = String(raw || "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI yanıtı geçerli JSON değil.");
  }
}

export function estimateNarrationDurationSeconds(narrationText) {
  const wordCount = String(narrationText || "").trim().split(/\s+/).filter(Boolean).length;
  return wordCount / TURKISH_WORDS_PER_SECOND;
}

// scenario zorunlu, durationSeconds zorunlu (metnin hedef uzunluğunu
// belirler). productName/style isteğe bağlı. Ücretsizdir — confirmed
// gerektirmez (Veo/Omni gibi bir medya API'sine değil, yalnızca metin
// üretimine gider — bu depodaki diğer metin araçlarıyla (generate_caption
// vb.) aynı ücret profili).
export async function generateVideoNarration({ scenario, productName, durationSeconds, style }, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  const scenarioText = String(scenario || "").trim();
  if (!scenarioText) throw new Error("scenario boş olamaz.");
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("durationSeconds pozitif bir sayı olmalıdır.");
  const resolvedStyle = style && NARRATION_STYLES.includes(style) ? style : "reklam";
  const targetWordCount = Math.max(3, Math.round(duration * TURKISH_WORDS_PER_SECOND));

  const model = env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
  const response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: narrationPrompt({ scenario: scenarioText, productName, durationSeconds: duration, style: resolvedStyle, targetWordCount }) }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
  const parsed = parseJson(textFromGemini(data));
  const narrationText = String(parsed.narrationText || "").trim();
  if (!narrationText) throw new Error("AI seslendirme metni boş döndü.");
  const musicBriefRaw = parsed.musicBrief || {};
  const musicBrief = {
    mood: String(musicBriefRaw.mood || "").trim(),
    energy: String(musicBriefRaw.energy || "").trim(),
    tempo: String(musicBriefRaw.tempo || "").trim(),
    description: String(musicBriefRaw.description || "").trim()
  };
  return {
    narrationText,
    estimatedDurationSeconds: Math.round(estimateNarrationDurationSeconds(narrationText) * 10) / 10,
    language: "tr-TR",
    musicBrief
  };
}
