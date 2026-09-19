// TASK-002: mediaUrl'den ham byte'ları indiren TEK ortak yardımcı —
// google-transcribe.js ve openai-transcribe.js AYNI fonksiyonu kullanır,
// ikisi de kendi fetch/boyut mantığını AYRI AYRI icat etmez.
//
// FFmpeg ile ses ayıklama KASITLI olarak YOKTUR: Gemini generateContent
// (inlineData) ve OpenAI /v1/audio/transcriptions (bkz. openai-transcribe.js)
// video container'larını (mp4/mov/webm) DOĞRUDAN kabul eder — sağlayıcı
// ses parçasını kendi tarafında ayıklar, bu depoda ayrı bir adım gerekmez.
// Dosya bu MAX_BYTES sınırını aşarsa (Vercel serverless fonksiyonunun
// bellek/süre sınırları + Whisper'ın ~25MB API limiti) SESSİZCE küçültme/
// dönüştürme YAPILMAZ — açık bir hata döner. Bu durumda mevcut GitHub
// Actions FFmpeg render kuyruğu (bkz. src/lib/ffmpeg-command.js,
// src/reel-audio-compose.js) yeniden kullanılmalı — yeni bir senkron FFmpeg
// alt sistemi bu task kapsamında EKLENMEMİŞTİR (bkz. tasks/TASK-002
// acceptance: "no duplicate FFmpeg subsystem").
export const MAX_MEDIA_BYTES = 24 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac"
};

function guessMimeFromPath(pathname) {
  const ext = String(pathname || "").split(".").pop()?.toLowerCase();
  return MIME_BY_EXTENSION[ext] || "application/octet-stream";
}

export async function fetchMediaBytes(mediaUrl, { fetchImpl = fetch, maxBytes = MAX_MEDIA_BYTES } = {}) {
  let url;
  try {
    url = new URL(String(mediaUrl || ""));
  } catch {
    throw new Error("mediaUrl geçerli bir URL değil.");
  }
  if (url.protocol !== "https:") throw new Error("mediaUrl yalnızca HTTPS olabilir.");

  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`mediaUrl indirilemedi (HTTP ${response.status}).`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > maxBytes) {
    throw new Error(
      `Medya dosyası çok büyük (${(buffer.length / 1024 / 1024).toFixed(1)}MB > ${(maxBytes / 1024 / 1024).toFixed(0)}MB). ` +
      "Bu task kapsamında senkron bir ön-küçültme/ayıklama adımı YOKTUR (bkz. media-fetch.js) — " +
      "gerekiyorsa mevcut GitHub Actions FFmpeg render kuyruğu yeniden kullanılmalı, yeni bir alt sistem icat edilmemeli."
    );
  }

  const headerMime = response.headers?.get?.("content-type")?.split(";")[0]?.trim();
  const mimeType = headerMime && headerMime !== "application/octet-stream" ? headerMime : guessMimeFromPath(url.pathname);
  return { buffer, mimeType };
}
