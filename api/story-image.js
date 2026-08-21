import sharp from "sharp";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const MAX_BYTES = 15 * 1024 * 1024;
const fontPath = fileURLToPath(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", import.meta.url));
const font = opentype.loadSync(fontPath);
const boldFont = opentype.loadSync(fileURLToPath(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf", import.meta.url)));

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function overlaySvg(query) {
  const title = String(query.title || "Buzsu Su Arıtma");
  const subtitle = String(query.subtitle || "Ürün bilgileri için inceleyin.");
  const footer = String(query.footer || "www.buzsu.com.tr");
  const path = (text, x, baseline, size, color) => `<path d="${font.getPath(text, x, baseline, size).toPathData(2)}" fill="${color}"/>`;
  const centeredPath = (text, baseline, size, color) => {
    const width = boldFont.getAdvanceWidth(text, size);
    return `<path d="${boldFont.getPath(text, Math.max(92, (1080 - width) / 2), baseline, size).toPathData(2)}" fill="${color}"/>`;
  };
  const subtitleWords = subtitle.split(/\s+/);
  const subtitleLines = [""];
  for (const word of subtitleWords) {
    const candidate = subtitleLines[subtitleLines.length - 1] ? `${subtitleLines[subtitleLines.length - 1]} ${word}` : word;
    if (font.getAdvanceWidth(candidate, 30) > 900 && subtitleLines.length < 3) subtitleLines.push(word);
    else subtitleLines[subtitleLines.length - 1] = candidate;
  }
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <rect x="48" y="1400" width="984" height="390" rx="24" fill="#ffffff" fill-opacity="0.94"/>
    <rect x="48" y="1400" width="10" height="390" rx="5" fill="#138a9b"/>
    ${path(title, 92, 1480, 42, "#0b2740")}
    ${path(subtitleLines[0], 92, 1550, 30, "#27455b")}
    ${subtitleLines[1] ? path(subtitleLines[1], 92, 1602, 30, "#27455b") : ""}
    ${subtitleLines[2] ? path(subtitleLines[2], 92, 1654, 30, "#27455b") : ""}
    ${centeredPath(footer, 1770, 46, "#0b63b6")}
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
