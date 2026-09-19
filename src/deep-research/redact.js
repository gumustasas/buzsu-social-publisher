// TASK-008: src/veo-video.js, src/turkish-tts.js, src/lyria-music.js,
// src/omni-video.js, src/lib/meta-connect.js VE src/orchestrator/redact.js'teki
// AYNI ilke — bu depoda her modül KENDİ dar redact()'ini bağımsız olarak
// uygular (TASK-007'nin orchestrator'ına import bağımlılığı KURULMAZ, o
// bu görevin depends_on'unda değildir). deep-research 2 farklı capability'den
// (research_web/search_product_knowledge) gelen hata mesajlarını TEK bir
// yerde caller'a döndürdüğü için, bilinen secret env değerlerine karşı
// SON bir savunma hattı olarak burada AYRICA redaksiyon uygulanır.
const SECRET_ENV_VAR_NAMES = [
  "AIRTABLE_TOKEN",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_API_KEY",
  "ANTHROPIC_API_KEY",
  "MCP_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "GITHUB_DISPATCH_TOKEN",
  "CRON_SECRET",
  "META_ACCESS_TOKEN",
  "META_APP_SECRET",
  "META_CONNECT_MCP_PATH_SECRET",
  "META_FACEBOOK_PAGE_ACCESS_TOKEN",
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
