import sharp from "sharp";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

// TASK-011 kendi font/metin render yolunu YÜKLÜYOR (post-branding.js'i
// DEĞİŞTİRMİYOR — compose_cinematic_reel, compose_product_video'dan
// mimari olarak tamamen bağımsız olmalı, bkz. manifest). Aynı DejaVuSans-Bold
// fontu tercih edildi çünkü Türkçe karakterleri (ç,ğ,ı,İ,ö,ş,ü) zaten
// kapsıyor VE compose_product_video'da (src/post-branding.js) üretimde
// doğrulanmış durumda — bu küçük bir kod tekrarı, ancak repodaki mevcut
// redact()/redactSecrets() kopyalama kuralıyla (bkz. PR geçmişi) tutarlı:
// bağımsız modüller arasında paylaşılan küçük yardımcıların tekrarı bu
// depoda kabul edilen bir konvansiyon.
const boldFont = opentype.loadSync(
  fileURLToPath(new URL("../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf", import.meta.url))
);

// FFmpeg'in KENDİSİ hiç metin görmez — metin burada, sharp+opentype ile
// (compose_product_video'da zaten üretimde test edilmiş AYNI teknik)
// vektör path'lere dönüştürülüp düz piksellere (PNG) çizilir. Bu yüzden
// başlık/alt başlık metni ASLA bir FFmpeg drawtext/filtergraph string'ine
// enjekte edilmez — TASK-011'in "no FFmpeg text/filter injection" güvenlik
// şartı, bu metin yolunun FFmpeg'e hiç ulaşmaması ile YAPISAL olarak
// garanti edilir (kaçış/escape mantığına güvenmek yerine).
function wrapText(text, size, maxWidth, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [""];
  for (const word of words) {
    const candidate = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
    if (boldFont.getAdvanceWidth(candidate, size) > maxWidth && lines.length < maxLines && lines[lines.length - 1]) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = candidate;
    }
  }
  return lines;
}

function centeredPath(text, y, size, width, fill) {
  const w = boldFont.getAdvanceWidth(text, size);
  const x = (width - w) / 2;
  return `<path d="${boldFont.getPath(text, x, y, size).toPathData(2)}" fill="${fill}"/>`;
}

// Manifest: "respect 9:16 safe areas" — Reels/Shorts oynatıcı arayüzü alt
// ~%10-12'yi kaplar; oran width/height'a göre hesaplanır ki 1:1/16:9
// çıktılarda da orantılı kalsın (post-branding.js'in sabit 230px'lik
// VIDEO_SAFE_BOTTOM_MARGIN'i yalnızca 1920px yükseklik varsayar).
export function safeBottomMargin(height) {
  return Math.round(height * 0.12);
}

// renderTitleOverlayPng: title/subtitle'ı, verilen canvas boyutunda SAYDAM
// arka planlı bir PNG'ye çizer (compose_product_video'nun videoTitleBarSvg'si
// ile aynı görsel dil: koyu yarı saydam bant + beyaz metin). Ağ/IO'suz saf
// fonksiyon (dosya sistemi yalnızca font yüklerken, modül import anında,
// bir kez kullanılır).
export async function renderTitleOverlayPng({ title, subtitle, width, height }) {
  const barHeight = Math.round(height * 0.11);
  const margin = safeBottomMargin(height);
  const barTop = height - margin - barHeight;

  const titleSize = Math.round(width * 0.048);
  const titleLines = wrapText(title, titleSize, width - width * 0.13, 1);
  const subtitleSize = Math.round(width * 0.032);
  const subtitleLines = subtitle ? wrapText(subtitle, subtitleSize, width - width * 0.13, 1) : [];

  const titleY = barTop + Math.round(barHeight * (subtitleLines.length ? 0.42 : 0.58));
  const subtitleY = titleY + Math.round(titleSize * 1.35);

  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="tbar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#04102b" stop-opacity="0"/>
        <stop offset="0.45" stop-color="#04102b" stop-opacity="0.86"/>
        <stop offset="1" stop-color="#04102b" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${barTop}" width="${width}" height="${barHeight + margin}" fill="url(#tbar)"/>
    ${titleLines.map((line) => centeredPath(line, titleY, titleSize, width, "#ffffff")).join("")}
    ${subtitleLines.map((line) => centeredPath(line, subtitleY, subtitleSize, width, "#e6ecff")).join("")}
  </svg>`);

  return {
    buffer: await sharp(svg).png().toBuffer(),
    barTop
  };
}

// buildTitleAnimationFilter: metin katmanının GİRİŞ animasyonu için FFmpeg
// filtre zinciri parçası üretir. Manifest varsayılanı: "opacity 0->1,
// y_offset 12-24px->0, ease-out". Ölçek (scale) animasyonu bilinçli olarak
// v1 kapsamı DIŞINDA bırakıldı (bkz. final_report known_limitations) —
// tek bir statik overlay PNG'de per-frame scale, ayrı bir scale2ref/zmq
// katmanı gerektirir ve "avoid TikTok-style exaggerated text motion"
// şartıyla orantısız bir karmaşıklık/render-süresi maliyeti getirirdi;
// opacity+y-offset zaten "kinetik ama ölçülü" bir giriş sağlıyor.
//
// KRİTİK: renderTitleOverlayPng zaten TAM canvas boyutunda (width x height)
// bir PNG üretir ve bandı kendi MUTLAK konumunda (barTop) çizer — yani
// overlay'in taban y konumu HER ZAMAN 0'dır (overlay=x=0:y=0 tam örtüşür).
// y'ye AYRICA barTop eklemek, zaten kendi içinde konumlanmış bandı bir kez
// daha barTop kadar aşağı kaydırıp kanvas dışına (2*barTop) iter — bu
// tam olarak smoke test sırasında yakalanan gerçek bir bug'dı (başlık hiç
// görünmüyordu). Bu yüzden y ifadesi yalnızca GİRİŞ ofsetini taşır, barTop
// İÇERMEZ.
//
// Yalnızca SAYISAL, önceden doğrulanmış sabitler (offsetPx,
// animDurationSeconds) FFmpeg ifadesine gömülür — hiçbir kullanıcı metni
// buraya ulaşmaz.
export function buildTitleAnimationFilter({
  textInputLabel,
  sceneInputLabel,
  outputLabel,
  offsetPx = 20,
  animDurationSeconds = 0.45
}) {
  const fadeLabel = `${textInputLabel}fade`;
  // ease-out'un tümleyeni: (1-easeOut(p))^2 formunun sadeleşmiş hâli olan
  // (1-p)^2 — offset, zaman ilerledikçe 0'a düşer (ease-out hissi).
  const yExpr = `${offsetPx}*(1-min(1,t/${animDurationSeconds}))^2`;
  return (
    `[${textInputLabel}]format=rgba,fade=t=in:st=0:d=${animDurationSeconds}:alpha=1[${fadeLabel}];` +
    `[${sceneInputLabel}][${fadeLabel}]overlay=x=0:y='${yExpr}':shortest=1[${outputLabel}]`
  );
}
