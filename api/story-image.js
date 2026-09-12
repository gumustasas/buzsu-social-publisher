import sharp from "sharp";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const MAX_BYTES = 15 * 1024 * 1024;
const fontPath = fileURLToPath(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", import.meta.url));
export const font = opentype.loadSync(fontPath);
const boldFont = opentype.loadSync(fileURLToPath(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf", import.meta.url)));

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const CARD_X = 48;
const CARD_WIDTH = 984;
const TEXT_X = 92;
export const MAX_TEXT_WIDTH = 900;
const TITLE_SIZE = 42;
const TITLE_SIZE_SMALL = 32;
const SUBTITLE_SIZE = 30;
const FOOTER_SIZE = 46;
// Kartın büyüyebileceği üst sınır burada — alt metin ne kadar uzun olursa
// olsun en fazla bu kadar satıra sarılır (sığmayan kısım "…" ile kesilir),
// böylece kart fotoğrafın giderek daha büyük bir kısmını kaplamaz.
const MAX_SUBTITLE_LINES = 2;
// Kart her zaman kanvas altına sabit bir mesafede durur (BOX_BOTTOM_MARGIN);
// yükseklik içerik satır sayısına göre değiştiğinde kart yalnızca yukarı
// büyür/küçülür, alt kenarı hep aynı yerde kalır.
const BOX_BOTTOM_MARGIN = 130;
const BOTTOM_PADDING = 20;
const FIRST_TITLE_BASELINE_OFFSET = 80;
const TITLE_TO_SUBTITLE_GAP = 70;
const SUBTITLE_LINE_HEIGHT = 52;
const SUBTITLE_TO_FOOTER_GAP = 116;

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Bir satır maxWidth'i aşıyorsa (maxLines'a ulaşıldıktan sonra sığmayan
// kelimeler o satıra eklenmeye devam ettiğinde olur) üç nokta ile keser —
// gerçek ölçümle, karakter tahminiyle değil.
function truncateToWidth(text, fontObj, size, maxWidth) {
  if (fontObj.getAdvanceWidth(text, size) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && fontObj.getAdvanceWidth(`${truncated}…`, size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated.trimEnd()}…`;
}

// src/post-branding.js'teki wrapTitle() ile aynı desen: karakter sayısı
// tahmini değil, gerçek font ölçümüyle (fontObj.getAdvanceWidth) satır sarma.
// maxLines'a ulaşıldıktan sonra sığmayan kelimeler son satıra eklenmeye
// devam eder — bu yüzden her satır sonunda genişlik yeniden doğrulanıp
// gerekirse kesiliyor (aksi halde taşma başlıkta 2. satıra kayardı, kartın
// dışına taşmaya devam ederdi).
export function wrapLines(text, fontObj, size, maxWidth, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [""];
  for (const word of words) {
    const candidate = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
    if (fontObj.getAdvanceWidth(candidate, size) > maxWidth && lines.length < maxLines) lines.push(word);
    else lines[lines.length - 1] = candidate;
  }
  return lines.map((line) => truncateToWidth(line, fontObj, size, maxWidth));
}

// Kartın yüksekliğini ve konumunu, başlık/alt başlığın gerçekte kapladığı
// satır sayısına göre hesaplar (eskiden sabit x/y/height'tı — kısa metinde
// boş alan, uzun metinde taşma vardı). Başlık da (alt başlık gibi) tek
// satıra sığmazsa küçültülüp iki satıra sarılır.
export function computeStoryLayout({ title, subtitle }) {
  let titleSize = TITLE_SIZE;
  let maxTitleLines = 1;
  // Küçültüp iki satıra sarma kararı, wrapLines'ın (artık kırpılmış) çıktısı
  // yerine ham başlık metninin gerçek genişliğine bakarak veriliyor — aksi
  // halde wrapLines'ın kendi taşma-kırpması bu denetimi hep "sığıyor"
  // gösterirdi.
  if (font.getAdvanceWidth(title, titleSize) > MAX_TEXT_WIDTH) {
    titleSize = TITLE_SIZE_SMALL;
    maxTitleLines = 2;
  }
  let titleLines = wrapLines(title, font, titleSize, MAX_TEXT_WIDTH, maxTitleLines);
  const titleLineHeight = Math.round(titleSize * 1.15);
  const subtitleLines = wrapLines(subtitle, font, SUBTITLE_SIZE, MAX_TEXT_WIDTH, MAX_SUBTITLE_LINES);

  const lastTitleOffset = FIRST_TITLE_BASELINE_OFFSET + (titleLines.length - 1) * titleLineHeight;
  const firstSubtitleOffset = lastTitleOffset + TITLE_TO_SUBTITLE_GAP;
  const lastSubtitleOffset = firstSubtitleOffset + (subtitleLines.length - 1) * SUBTITLE_LINE_HEIGHT;
  const footerOffset = lastSubtitleOffset + SUBTITLE_TO_FOOTER_GAP;
  const boxHeight = footerOffset + BOTTOM_PADDING;
  const boxY = CANVAS_HEIGHT - BOX_BOTTOM_MARGIN - boxHeight;

  return {
    titleLines,
    titleSize,
    subtitleLines,
    boxY,
    boxHeight,
    titleBaselines: titleLines.map((_, i) => boxY + FIRST_TITLE_BASELINE_OFFSET + i * titleLineHeight),
    subtitleBaselines: subtitleLines.map((_, i) => boxY + firstSubtitleOffset + i * SUBTITLE_LINE_HEIGHT),
    footerBaseline: boxY + footerOffset
  };
}

function overlaySvg(query) {
  const title = String(query.title || "Buzsu Su Arıtma");
  const subtitle = String(query.subtitle || "Ürün bilgileri için inceleyin.");
  const footer = String(query.footer || "www.buzsu.com.tr");
  const layout = computeStoryLayout({ title, subtitle });
  const path = (text, x, baseline, size, color) => `<path d="${font.getPath(text, x, baseline, size).toPathData(2)}" fill="${color}"/>`;
  const centeredPath = (text, baseline, size, color) => {
    const width = boldFont.getAdvanceWidth(text, size);
    return `<path d="${boldFont.getPath(text, Math.max(TEXT_X, (CANVAS_WIDTH - width) / 2), baseline, size).toPathData(2)}" fill="${color}"/>`;
  };
  const titlePaths = layout.titleLines.map((line, i) => path(line, TEXT_X, layout.titleBaselines[i], layout.titleSize, "#0b2740")).join("\n");
  const subtitlePaths = layout.subtitleLines.map((line, i) => path(line, TEXT_X, layout.subtitleBaselines[i], SUBTITLE_SIZE, "#27455b")).join("\n");
  return Buffer.from(`<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${CARD_X}" y="${layout.boxY}" width="${CARD_WIDTH}" height="${layout.boxHeight}" rx="24" fill="#ffffff" fill-opacity="0.94"/>
    <rect x="${CARD_X}" y="${layout.boxY}" width="10" height="${layout.boxHeight}" rx="5" fill="#138a9b"/>
    ${titlePaths}
    ${subtitlePaths}
    ${centeredPath(footer, layout.footerBaseline, FOOTER_SIZE, "#0b63b6")}
  </svg>`);
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const source = typeof request.query?.src === "string" ? request.query.src : "";
  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    return response.status(400).json({ error: "Geçerli bir görsel URL'si gerekli." });
  }
  if (sourceUrl.protocol !== "https:") {
    return response.status(400).json({ error: "Görsel URL'si HTTPS olmalı." });
  }

  const upstream = await fetch(sourceUrl, { redirect: "follow" });
  if (!upstream.ok) return response.status(502).json({ error: "Kaynak görsel alınamadı." });
  const contentLength = Number(upstream.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) return response.status(413).json({ error: "Görsel boyutu çok büyük." });

  const input = Buffer.from(await upstream.arrayBuffer());
  if (input.length > MAX_BYTES) return response.status(413).json({ error: "Görsel boyutu çok büyük." });

  const output = await sharp(input)
    .rotate()
    .resize(1080, 1920, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .composite([{ input: overlaySvg(request.query || {}) }])
    .jpeg({ quality: 88, progressive: true })
    .toBuffer();

  response.setHeader("Content-Type", "image/jpeg");
  response.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  return response.status(200).send(output);
}
