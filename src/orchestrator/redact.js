// TASK-007: orkestratör 6 farklı capability'den (research/transcription/
// visual-validation/scene-image/video-to-image/knowledge) gelen hata
// mesajlarını TEK bir yerde caller'a döndürür — bu yüzden src/veo-video.js,
// src/turkish-tts.js, src/lyria-music.js, src/omni-video.js, src/lib/
// meta-connect.js'teki AYNI "redact()" ilkesinin GENEL (tüm bilinen secret
// env değişkenlerini kapsayan) bir sürümü burada gerekir — her capability
// kendi dar redact()'ini zaten uyguluyor olsa da, orkestratör KENDİ
// çıktısında (failureReason/blockedOrConfirmationReason) sızıntıya karşı
// SON bir savunma hattı olarak AYRICA redaksiyon uygular.
const SECRET_ENV_VAR_NAMES = [
  "AIRTABLE_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
  "GEMINI_API_KEY",
  "GITHUB_DISPATCH_TOKEN",
  "MCP_API_KEY",
  "META_ACCESS_TOKEN",
  "META_APP_SECRET",
  "META_CONNECT_MCP_PATH_SECRET",
  "META_FACEBOOK_PAGE_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_API_KEY",
  "ANTHROPIC_API_KEY",
  "REPLICATE_API_TOKEN",
  "SESSION_SECRET",
  "SHOTSTACK_API_KEY",
  "FAL_KEY",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "GA4_PRIVATE_KEY",
  "GA4_CLIENT_EMAIL"
];

// Mesaj içinde (herhangi bir capability'nin hata metnine sızmış olabilecek)
// tanımlı bir secret env değerinin ham hâli GEÇERSE onu [REDACTED]'e çevirir.
// Boş/tanımsız bir env değeri asla aranmaz (aksi halde boş string her yerde
// "eşleşir" ve mesajı anlamsızlaştırır).
export function redactSecrets(message, env = process.env) {
  let text = String(message ?? "");
  for (const name of SECRET_ENV_VAR_NAMES) {
    const value = env?.[name];
    if (typeof value === "string" && value.length >= 6) {
      text = text.split(value).join("[REDACTED]");
    }
  }
  return text;
}
