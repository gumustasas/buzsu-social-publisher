import "dotenv/config";
import { getSession } from "../src/auth.js";

const MAX_BYTES = 200 * 1024 * 1024;
// Video linkleri farklı origin'lerden geliyor (Vercel Blob, fal.ai CDN) ve
// Safari cross-origin <a download> özniteliğini genelde yok sayıp linki
// yeni sekmede/oynatıcıda açıyor — kullanıcı telefonda "indirilen" dosyayı
// bulamıyor. Bu uç nokta videoyu sunucu tarafında indirip aynı origin'den
// Content-Disposition: attachment ile geri veriyor; bu şekilde tarayıcı
// gerçek bir indirme başlatıyor.
const ALLOWED_HOST_PATTERNS = [/(^|\.)vercel-storage\.com$/i, /(^|\.)fal\.media$/i, /(^|\.)fal\.ai$/i];

function authorized(request) { return Boolean(getSession(request)); }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });

  const source = typeof request.query?.url === "string" ? request.query.url : "";
  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    return response.status(400).json({ error: "Geçerli bir video URL'si gerekli." });
  }
  if (sourceUrl.protocol !== "https:" || !ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(sourceUrl.hostname))) {
    return response.status(400).json({ error: "Bu adresten indirme desteklenmiyor." });
  }

  const upstream = await fetch(sourceUrl, { redirect: "follow" });
  if (!upstream.ok) return response.status(502).json({ error: "Video kaynağı alınamadı." });
  const contentLength = Number(upstream.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) return response.status(413).json({ error: "Video boyutu çok büyük." });

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length > MAX_BYTES) return response.status(413).json({ error: "Video boyutu çok büyük." });

  response.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
  response.setHeader("Content-Disposition", `attachment; filename="buzsu-reel-${Date.now()}.mp4"`);
  return response.status(200).send(buffer);
}
