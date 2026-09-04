import sharp from "sharp";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const CANVAS_SIZE = 1024;
const BAR_HEIGHT = 210;
const LOGO_PATH = fileURLToPath(new URL("../assets/buzsu-logo.png", import.meta.url));

const boldFont = opentype.loadSync(
  fileURLToPath(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf", import.meta.url))
);

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapTitle(title, size, maxWidth, maxLines) {
  const words = String(title || "").trim().split(/\s+/);
  const lines = [""];
  for (const word of words) {
    const candidate = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
    if (boldFont.getAdvanceWidth(candidate, size) > maxWidth && lines.length < maxLines) lines.push(word);
    else lines[lines.length - 1] = candidate;
  }
  return lines;
}

function titleSvg(title) {
  // Uzun ürün adları tek satıra sığmazsa yazı boyutunu küçültüp iki satıra
  // sarıyoruz — sığdırmak için tahmin yerine gerçek font genişliği ölçülüyor.
  let size = 46;
  let lines = wrapTitle(title, size, CANVAS_SIZE - 120, 1);
  if (boldFont.getAdvanceWidth(lines[0], size) > CANVAS_SIZE - 120) {
    size = 36;
    lines = wrapTitle(title, size, CANVAS_SIZE - 120, 2);
  }
  const lineHeight = size * 1.15;
  const startY = lines.length === 1 ? 68 : 58;
  const centeredPath = (text, y) => {
    const width = boldFont.getAdvanceWidth(text, size);
    const x = (CANVAS_SIZE - width) / 2;
    return `<path d="${boldFont.getPath(text, x, y, size).toPathData(2)}" fill="#ffffff"/>`;
  };
  return lines.map((line, i) => centeredPath(line, startY + i * lineHeight)).join("");
}

function barSvg(title) {
  return Buffer.from(`<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#04102b" stop-opacity="0.72"/>
        <stop offset="0.35" stop-color="#04102b" stop-opacity="0.94"/>
        <stop offset="1" stop-color="#04102b" stop-opacity="0.97"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${CANVAS_SIZE - BAR_HEIGHT}" width="${CANVAS_SIZE}" height="${BAR_HEIGHT}" fill="url(#bar)"/>
    <g transform="translate(0, ${CANVAS_SIZE - BAR_HEIGHT})">
      ${titleSvg(escapeXml(title))}
    </g>
  </svg>`);
}

// Sahne görselinin (kare, 1024x1024) alt kısmına yarı saydam koyu bir bant,
// bandın üstüne ürün adı ve bandın altına Buzsu logosunu bindirir. AI sahne
// üretiminden farklı bir aşama: bu saf Sharp/SVG kompozisyonu, marka
// tutarlılığı görsel üretimin (ve olası model değişikliklerinin) insafına
// bırakılmasın diye ayrı tutuluyor.
export async function composeBrandedPost(scenePngBuffer, { title } = {}) {
  const base = sharp(scenePngBuffer).resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "cover" });

  const logoTargetWidth = 260;
  const logoMeta = await sharp(LOGO_PATH).metadata();
  const logoHeight = Math.round((logoMeta.height / logoMeta.width) * logoTargetWidth);
  const logoBuffer = await sharp(LOGO_PATH).resize(logoTargetWidth, logoHeight).toBuffer();
  const logoLeft = Math.round((CANVAS_SIZE - logoTargetWidth) / 2);
  const logoTop = CANVAS_SIZE - Math.round(logoHeight * 1.35);

  return base
    .composite([
      { input: barSvg(title), top: 0, left: 0 },
      { input: logoBuffer, top: logoTop, left: logoLeft }
    ])
    .png()
    .toBuffer();
}
