// TASK-002 ROOT review (PR #101): önceki sürüm metni 20.000 karakterde,
// segment listesini 500 kayıtta SESSİZCE kesiyordu — hiçbir truncation
// sinyali dönmeden. transcribe_media BİREBİR bir transkript vaat eder;
// sessiz kesme bu vaadi ihlal eder ve çağıranın eksik/iç-tutarsız bir
// sonucu fark etmeden kullanmasına yol açar. Bu yüzden burada ARTIK hiçbir
// uzunluk sınırı YOKTUR — sağlayıcının döndürdüğü metin/segment listesi
// TAM olarak korunur (yalnızca trim + geçersiz zamanlı segmentlerin
// elenmesi gibi biçim normalizasyonu yapılır, İÇERİK kesilmez).
function cleanText(value) {
  return String(value ?? "").trim();
}

// google-transcribe.js/openai-transcribe.js'ten gelen ham çıktıyı (segment
// şekli sağlayıcıya göre farklı — start/end vs startSeconds/endSeconds) TEK
// bir ortak şekle indirger: {text, language, segments:[{startSeconds,
// endSeconds,text,speaker}]}. Süresi/sırası bozuk (endSeconds <= startSeconds)
// segmentler sessizce ATLANIR — uydurma bir zaman damgası ÜRETİLMEZ (bu,
// içerik kesme değil, geçersiz/kullanılamaz veriyi elemektir).
export function normalizeTranscript({ text, language, segments } = {}) {
  const normalizedSegments = [];
  for (const raw of Array.isArray(segments) ? segments : []) {
    const startSeconds = Number(raw?.startSeconds ?? raw?.start);
    const endSeconds = Number(raw?.endSeconds ?? raw?.end);
    const segmentText = cleanText(raw?.text);
    if (!segmentText) continue;
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) continue;
    normalizedSegments.push({
      startSeconds,
      endSeconds,
      text: segmentText,
      speaker: raw?.speaker != null ? cleanText(raw.speaker) : null
    });
  }

  return {
    text: cleanText(text),
    language: language ? cleanText(language) : null,
    segments: normalizedSegments
  };
}
