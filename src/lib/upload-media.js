import dns from "node:dns/promises";
import net from "node:net";

// upload_media MCP aracının (bkz. api/mcp.js) hazır bir görseli (ChatGPT'de
// üretilmiş veya kullanıcının yüklediği) Vercel Blob'a almadan önce
// doğruladığı yer burasıdır. imageUrl verilirse sunucu bu URL'i kendisi
// indirir (server-side fetch) — bu yüzden SSRF koruması şart: dışarıdan
// verilen bir URL, sunucunun kendi iç ağına (localhost, özel IP aralıkları,
// bulut metadata endpoint'leri) istek yapmaya zorlayabilir.
export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1"]);
const MAX_REDIRECTS = 5;

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, 169.254.169.254 bulut metadata dahil
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // çözümlenemeyen/bilinmeyen biçim güvensiz kabul edilir
}

// URL'in hem söz dizimini (yalnızca HTTPS) hem de çözümlendiği IP'leri
// (özel/yerel olmadığını) doğrular. Yönlendirme zincirindeki her adım için
// tekrar çağrılmalıdır — ilk hedefin güvenli olması yönlendirdiği yerin de
// güvenli olacağı anlamına gelmez.
export async function assertPublicHttpsUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Geçersiz URL.");
  }
  if (url.protocol !== "https:") throw new Error("Yalnızca HTTPS URL kabul edilir.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new Error("Bu host'a erişim engellendi.");
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Özel/yerel IP adreslerine erişim engellendi.");
    return url;
  }
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error("Host adı çözümlenemedi.");
  }
  if (!addresses.length) throw new Error("Host adı çözümlenemedi.");
  if (addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("Bu host özel/yerel bir IP adresine çözümleniyor, engellendi.");
  return url;
}

// Herkese açık bir HTTPS görsel URL'ini güvenli şekilde indirir: her
// yönlendirme adımını yeniden SSRF kontrolünden geçirir, Content-Type'ın
// PNG/JPEG/WebP olduğunu ve boyutun sınırın altında kaldığını doğrular.
export async function fetchPublicImage(rawUrl, { maxBytes = MAX_MEDIA_BYTES, fetchImpl = fetch, lookup } = {}) {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpsUrl(currentUrl, lookup ? { lookup } : {});
    const response = await fetchImpl(url, { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("Yönlendirme hedefi eksik.");
      currentUrl = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Görsel indirilemedi (HTTP ${response.status}).`);
    const contentType = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
      throw new Error(`Desteklenmeyen görsel tipi: ${contentType || "bilinmiyor"}. Yalnızca PNG/JPEG/WebP kabul edilir.`);
    }
    const declaredLength = Number(response.headers?.get?.("content-length") || 0);
    if (declaredLength > maxBytes) throw new Error(`Görsel çok büyük (en fazla ${Math.round(maxBytes / 1024 / 1024)}MB).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Görsel çok büyük (en fazla ${Math.round(maxBytes / 1024 / 1024)}MB).`);
    return { buffer, mimeType: contentType };
  }
  throw new Error("Çok fazla yönlendirme.");
}

// ChatGPT/kullanıcı tarafından doğrudan base64 olarak gönderilen bir
// görseli doğrular ve arabelleğe çözer.
export function decodeImageBase64(base64, mimeType, { maxBytes = MAX_MEDIA_BYTES } = {}) {
  const normalizedMime = String(mimeType || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new Error(`Desteklenmeyen görsel tipi: ${mimeType || "belirtilmedi"}. Yalnızca PNG/JPEG/WebP kabul edilir.`);
  }
  const cleaned = String(base64 || "").replace(/\s/g, "");
  if (!cleaned || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) throw new Error("Geçerli bir base64 verisi değil.");
  const buffer = Buffer.from(cleaned, "base64");
  if (!buffer.length) throw new Error("Geçerli bir base64 verisi değil.");
  if (buffer.length > maxBytes) throw new Error(`Görsel çok büyük (en fazla ${Math.round(maxBytes / 1024 / 1024)}MB).`);
  return buffer;
}

export function imageExtensionFor(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}
