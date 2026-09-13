// Airtable base/tablo ID'leri ve Meta Graph API sürümü için tekil kaynak.
// Önceden bu değerler ~15 dosyada literal fallback olarak tekrarlanıyordu;
// ikinci bir marka/hesap eklenmesi ya da base değişimi tek yerden yönetilsin
// diye buraya toplandı. Her export, aynı isimdeki env değişkeniyle override
// edilebilir.

export const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
export const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
export const AIRTABLE_SETTINGS_TABLE_ID = process.env.AIRTABLE_SETTINGS_TABLE_ID || "tblcoBjEWj7UbQ0wr";
export const AIRTABLE_AUTOPILOT_RECORD_ID = process.env.AIRTABLE_AUTOPILOT_RECORD_ID || "recserXsAErwqHUbZ";
export const AIRTABLE_USER_TABLE_ID = process.env.AIRTABLE_USER_TABLE_ID || "tblH84os6uOYsy4AK";

// Meta, Graph API sürümlerini yaklaşık 2 yılda bir sonlandırıyor
// (https://developers.facebook.com/docs/graph-api/changelog). Bu sabit
// yalnızca META_GRAPH_VERSION env'de tanımlı değilken devreye giren bir
// yedektir; periyodik olarak güncel tutulmalı, kalıcı bir çözüm değildir.
export const DEFAULT_META_GRAPH_VERSION = "v25.0";
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION;

// Meta, v20.0 öncesi tüm sürümleri resmi olarak sonlandırdı (v18.0/v19.0
// dahil — https://developers.facebook.com/docs/graph-api/changelog). Sabit
// bir liste yerine sayısal bir eşik kullanılıyor; aksi halde listede
// unutulmuş, ondan da eski bir sürüm (örn. v14.0) sessizce geçerdi.
const MINIMUM_SUPPORTED_META_GRAPH_VERSION = 20.0;

function parseMetaGraphVersionNumber(version) {
  const match = /^v?(\d+(?:\.\d+)?)$/.exec(String(version || "").trim());
  return match ? Number.parseFloat(match[1]) : null;
}

// compose_product_video, render işini kendi projesinde değil (Vercel'in
// süre/bellek sınırları riskli olduğu için) GitHub Actions'ın ücretsiz kuyruğunda
// çalıştırır (bkz. src/video-compose.js, .github/workflows/render-product-video.yml).
// Varsayılanlar bu deponun kendisine işaret eder; farklı bir fork/repo'da
// çalıştırılıyorsa env ile override edilmelidir.
export const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || "gumustasas";
export const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || "buzsu-social-publisher";
export const VIDEO_RENDER_WORKFLOW_FILE = process.env.VIDEO_RENDER_WORKFLOW_FILE || "render-product-video.yml";
export const VIDEO_RENDER_REF = process.env.VIDEO_RENDER_REF || "main";

// compose_reel_audio (bkz. src/reel-audio-compose.js), aynı sebeple
// (Vercel süre/bellek sınırları) render-product-video.yml'nin AYRI, kendi
// job şekline (video+seslendirme+müzik, medya listesi değil) sahip bir
// eşleniğini kullanır.
export const REEL_AUDIO_RENDER_WORKFLOW_FILE = process.env.REEL_AUDIO_RENDER_WORKFLOW_FILE || "render-reel-audio.yml";

export function assertMetaGraphVersionCurrent() {
  const parsed = parseMetaGraphVersionNumber(META_GRAPH_VERSION);
  if (parsed === null) {
    throw new Error(`META_GRAPH_VERSION="${META_GRAPH_VERSION}" tanınabilir bir Meta Graph API sürümü değil (örn. ${DEFAULT_META_GRAPH_VERSION}).`);
  }
  if (parsed < MINIMUM_SUPPORTED_META_GRAPH_VERSION) {
    throw new Error(
      `META_GRAPH_VERSION=${META_GRAPH_VERSION} Meta tarafından sonlandırıldı (v${MINIMUM_SUPPORTED_META_GRAPH_VERSION} öncesi sürümler artık desteklenmiyor). .env dosyasında güncel bir sürüme (örn. ${DEFAULT_META_GRAPH_VERSION}) yükseltin.`
    );
  }
}
