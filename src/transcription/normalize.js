const MAX_SEGMENTS = 500;
const MAX_TEXT_LENGTH = 20000;
const MAX_SEGMENT_TEXT_LENGTH = 1000;

function cleanText(value, maxLength) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

// google-transcribe.js/openai-transcribe.js'ten gelen ham çıktıyı (segment
// şekli sağlayıcıya göre farklı — start/end vs startSeconds/endSeconds) TEK
// bir ortak şekle indirger: {text, language, segments:[{startSeconds,
// endSeconds,text,speaker}]}. Süresi/sırası bozuk (endSeconds <= startSeconds)
// segmentler sessizce ATLANIR — uydurma bir zaman damgası ÜRETİLMEZ.
export function normalizeTranscript({ text, language, segments } = {}) {
  const normalizedSegments = [];
  for (const raw of Array.isArray(segments) ? segments : []) {
    const startSeconds = Number(raw?.startSeconds ?? raw?.start);
    const endSeconds = Number(raw?.endSeconds ?? raw?.end);
    const segmentText = cleanText(raw?.text, MAX_SEGMENT_TEXT_LENGTH);
    if (!segmentText) continue;
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) continue;
    normalizedSegments.push({
      startSeconds,
      endSeconds,
      text: segmentText,
      speaker: raw?.speaker != null ? cleanText(raw.speaker, 60) : null
    });
    if (normalizedSegments.length >= MAX_SEGMENTS) break;
  }

  return {
    text: cleanText(text, MAX_TEXT_LENGTH),
    language: language ? cleanText(language, 20) : null,
    segments: normalizedSegments
  };
}
