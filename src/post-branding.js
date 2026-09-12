import sharp from "sharp";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const CANVAS_SIZE = 1024;
const BAR_HEIGHT = 210;
const LOGO_PATH = fileURLToPath(new URL("../assets/buzsu-logo.png", import.meta.url));
const CLOSING_BACKGROUND_PATH = fileURLToPath(new URL("../assets/closing-background.jpg", import.meta.url));

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

// --- compose_product_video (MCP aracı) için 9:16 video kare/kapanış üretimi ---
// composeBrandedPost'un (1024x1024 kare gönderi) video kardeşi: aynı
// wrapTitle/boldFont ölçüm mantığını paylaşır, yalnızca canvas boyutu
// (1080x1920) ve bant konumu farklıdır. compose_product_video her ürün
// görselini FFmpeg'e vermeden ÖNCE burada markalar — böylece FFmpeg'in işi
// yalnızca hareket/geçiş/encode olur, metin/font render'ı FFmpeg'in
// (kırılgan) drawtext filtresine değil, burada zaten test edilmiş
// sharp+opentype koduna kalır.
const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_BAR_HEIGHT = 170;
// Instagram Reels / YouTube Shorts oynatıcısı alt ~200-250px'i kendi
// arayüzüyle (altyazı, beğen/paylaş ikonları) kaplıyor — ürün adı bandı bu
// bölgenin üzerinde, "güvenli alanda" kalsın diye bu payı bırakıyoruz.
const VIDEO_SAFE_BOTTOM_MARGIN = 230;

function videoTitlePaths(title, barTop) {
  let size = 52;
  let lines = wrapTitle(title, size, VIDEO_WIDTH - 140, 1);
  if (boldFont.getAdvanceWidth(lines[0], size) > VIDEO_WIDTH - 140) {
    size = 40;
    lines = wrapTitle(title, size, VIDEO_WIDTH - 140, 2);
  }
  const lineHeight = size * 1.15;
  const startY = barTop + (lines.length === 1 ? 80 : 68);
  const centeredPath = (text, y) => {
    const width = boldFont.getAdvanceWidth(text, size);
    const x = (VIDEO_WIDTH - width) / 2;
    return `<path d="${boldFont.getPath(text, x, y, size).toPathData(2)}" fill="#ffffff"/>`;
  };
  return lines.map((line, i) => centeredPath(line, startY + i * lineHeight)).join("");
}

function videoTitleBarSvg(title, barTop) {
  return Buffer.from(`<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="vbar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#04102b" stop-opacity="0"/>
        <stop offset="0.4" stop-color="#04102b" stop-opacity="0.88"/>
        <stop offset="1" stop-color="#04102b" stop-opacity="0.94"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${barTop}" width="${VIDEO_WIDTH}" height="${VIDEO_BAR_HEIGHT}" fill="url(#vbar)"/>
    ${videoTitlePaths(escapeXml(title), barTop)}
  </svg>`);
}

// Ürün fotoğrafı çoğunlukla kare/yatay geliyor (site thumbnail'ları) — bunu
// doğrudan "cover" ile 9:16'ya sığdırmak görselin büyük bir kısmını KIRPARAK
// ortadaki dar bir dikey şeridi doldurur; bu hem ürünün "aşırı yakınlaşmış/
// kırpılmış" görünmesine hem de zaten küçük olan kaynağın daha da büyütülüp
// bulanıklaşmasına yol açar. Reels/Shorts araçlarının (vidIQ dahil) standart
// çözümü: görseli hiç kırpmadan ("contain") ortala, üstte/altta kalan boşluğu
// aynı görselin bulanıklaştırılmış/karartılmış büyük hâliyle doldur — hem
// hiçbir parça kaybolmaz hem de düz boşluk yerine ürünle uyumlu bir arka
// plan görünür. Kaynak zaten 9:16 ise (contain==cover) bu katman görünmez.
async function composeFramedBackground(imageBuffer) {
  const background = await sharp(imageBuffer)
    .resize(VIDEO_WIDTH, VIDEO_HEIGHT, { fit: "cover" })
    .blur(48)
    .modulate({ brightness: 0.55 })
    .toBuffer();
  // Kaynak (özellikle site thumbnail'ları) genelde 1080px'ten küçük olduğu
  // için "contain" büyütmesi kaçınılmaz bir miktar yumuşama getiriyor —
  // sharpen kayıp detayı geri getirmez, yalnızca kenar kontrastını artırıp
  // algılanan netliği bir miktar toparlar (endüstride FFmpeg'in unsharp
  // filtresiyle aynı amaçla kullanılan standart, ücretsiz bir teknik).
  const foreground = await sharp(imageBuffer)
    .resize(VIDEO_WIDTH, VIDEO_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  return sharp(background).composite([{ input: foreground }]).png().toBuffer();
}

// Ürün fotoğrafını 9:16 kareye kırpmadan sığdırır (bkz. composeFramedBackground);
// title verilirse alt güvenli alana markalı bir ürün adı bandı bindirir,
// verilmezse çıplak kareyi döner.
export async function composeVideoFrame(imageBuffer, { title } = {}) {
  const framed = await composeFramedBackground(imageBuffer);
  if (!title) return framed;
  const barTop = VIDEO_HEIGHT - VIDEO_SAFE_BOTTOM_MARGIN - VIDEO_BAR_HEIGHT;
  return sharp(framed).composite([{ input: videoTitleBarSvg(title, barTop) }]).png().toBuffer();
}

// compose_product_video'nun sabit kapanış sahnesi: marka arka plan fotoğrafı +
// ortalı başlık/alt başlık + Buzsu logosu. Hiçbir ürün fotoğrafı içermez.
//
// Logo (assets/buzsu-logo.png) açık zeminler için tasarlanmış koyu lacivert
// tonlarda — önceki düz koyu lacivert (#04102b) arka plan üzerinde neredeyse
// görünmez oluyordu (kullanıcı geri bildirimi + piksel analiziyle doğrulandı:
// logonun büyük kısmı arka planla aynı renk aralığında). Bu yüzden arka plan
// artık kullanıcının sağladığı açık/su temalı bir fotoğraf (closing-background.jpg)
// — logonun kendi renk paletiyle tasarlandığı zemine uygun — ve başlık/alt
// başlık metni de aynı sebeple koyu laciverte çevrildi (eskiden beyazdı,
// artık açık zeminde okunmuyordu).
export async function composeClosingScene({ title = "Buzsu – İhtiyacınıza uygun su çözümünü keşfedin", subtitle = "buzsu.com.tr" } = {}) {
  const logoTargetWidth = 220;
  const logoMeta = await sharp(LOGO_PATH).metadata();
  const logoHeight = Math.round((logoMeta.height / logoMeta.width) * logoTargetWidth);
  const logoBuffer = await sharp(LOGO_PATH).resize(logoTargetWidth, logoHeight).toBuffer();
  const logoLeft = Math.round((VIDEO_WIDTH - logoTargetWidth) / 2);
  const logoTop = Math.round(VIDEO_HEIGHT * 0.36);

  const titleSize = 46;
  const escapedTitle = escapeXml(title);
  const titleLines = wrapTitle(escapedTitle, titleSize, VIDEO_WIDTH - 140, 3);
  const titleLineHeight = titleSize * 1.25;
  const titleStartY = logoTop + logoHeight + 90;
  const subtitleSize = 34;
  const subtitleY = titleStartY + titleLines.length * titleLineHeight + 30;

  const textColor = "#04102b";
  const centeredPath = (text, y, size) => {
    const width = boldFont.getAdvanceWidth(text, size);
    const x = (VIDEO_WIDTH - width) / 2;
    return `<path d="${boldFont.getPath(text, x, y, size).toPathData(2)}" fill="${textColor}"/>`;
  };

  const textSvg = Buffer.from(`<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${titleLines.map((line, i) => centeredPath(line, titleStartY + i * titleLineHeight, titleSize)).join("")}
    ${centeredPath(escapeXml(subtitle), subtitleY, subtitleSize)}
  </svg>`);

  const background = await sharp(CLOSING_BACKGROUND_PATH)
    .resize(VIDEO_WIDTH, VIDEO_HEIGHT, { fit: "cover" })
    .toBuffer();

  return sharp(background)
    .composite([
      { input: logoBuffer, top: logoTop, left: logoLeft },
      { input: textSvg, top: 0, left: 0 }
    ])
    .png()
    .toBuffer();
}
