import dns from "node:dns/promises";
import net from "node:net";
import sharp from "sharp";

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

// IPv6 adresini 8 adet 16-bit gruba açar (:: kısaltmasını ve gömülü
// noktalı-ondalık IPv4 kuyruğunu çözerek). ::ffff:127.0.0.1 ve
// ::ffff:7f00:1 aynı adresin iki farklı yazımıdır — ikisini de aynı
// normalize edilmiş forma getirip tek bir yoldan kontrol etmek gerekir,
// yoksa yalnızca noktalı-ondalık formu tanıyan bir regex hex formunu
// (SSRF koruma atlatması) kaçırır.
function expandIPv6(ip) {
  let addr = ip;
  const ipv4Tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Tail) {
    const parts = ipv4Tail[1].split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return null;
    const hex1 = ((parts[0] << 8) | parts[1]).toString(16);
    const hex2 = ((parts[2] << 8) | parts[3]).toString(16);
    addr = addr.slice(0, addr.length - ipv4Tail[1].length) + `${hex1}:${hex2}`;
  }
  const doubleColonCount = (addr.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;
  if (addr.includes("::")) {
    const [head, tail] = addr.split("::");
    const headParts = head ? head.split(":").filter(Boolean) : [];
    const tailParts = tail ? tail.split(":").filter(Boolean) : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    return [...headParts, ...new Array(missing).fill("0"), ...tailParts].map((g) => g.padStart(4, "0"));
  }
  const groups = addr.split(":");
  return groups.length === 8 ? groups.map((g) => g.padStart(4, "0")) : null;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  const groups = expandIPv6(lower);
  if (!groups) return true; // beklenmeyen/ayrıştırılamayan biçim güvensiz kabul edilir
  // ::ffff:0:0/96 — IPv4-mapped IPv6 (noktalı-ondalık veya hex grup yazımı fark etmeksizin)
  if (groups.slice(0, 5).every((g) => g === "0000") && groups[5] === "ffff") {
    const a = Number.parseInt(groups[6].slice(0, 2), 16), b = Number.parseInt(groups[6].slice(2, 4), 16);
    const c = Number.parseInt(groups[7].slice(0, 2), 16), d = Number.parseInt(groups[7].slice(2, 4), 16);
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
  }
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

// Content-Length yalan söylenirse veya hiç verilmezse response.arrayBuffer()
// tüm gövdeyi belleğe alır — sınırsız/çok büyük bir gövde bu kontrolü
// beklemeden bellek/süre tüketebilir. Bu yüzden akış hâlinde okuyup
// maxBytes aşılır aşılmaz durduruyoruz. Test amaçlı basit mock yanıtlarda
// (body.getReader yoksa) arrayBuffer()'a düşer.
async function readBodyWithLimit(response, maxBytes) {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Görsel çok büyük (en fazla ${Math.round(maxBytes / 1024 / 1024)}MB).`);
    return buffer;
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Görsel çok büyük (en fazla ${Math.round(maxBytes / 1024 / 1024)}MB).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
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
    const buffer = await readBodyWithLimit(response, maxBytes);
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

// Meta Graph API, kaynağı bizim üretmediğimiz görsellerde (Drive/ChatGPT
// gibi üçüncü taraf kaynaklar) "desteklenmeyen görsel formatı" hatası
// verebiliyor — gerçek sebep genelde CMYK renk uzayı, alışılmadık bir ICC
// profili, progressive JPEG kodlaması veya işlenmemiş EXIF döndürme bilgisi
// gibi Content-Type başlığından görünmeyen kodlama detaylarıdır. Bu yüzden
// Blob'a yüklemeden önce görseli HER ZAMAN temiz, sRGB, EXIF-düzeltilmiş bir
// JPEG/PNG'ye yeniden kodluyoruz — WebP de dahil (Meta'nın gönderi/hikâye
// için WebP desteği tutarsız, bu yüzden PNG'ye çeviriyoruz).
export async function normalizeImageForMeta(buffer, mimeType, { maxBytes = MAX_MEDIA_BYTES } = {}) {
  const image = sharp(buffer).rotate(); // EXIF orientation'ı piksellere göm, meta veri olarak bırakma
  const normalized = mimeType === "image/jpeg"
    ? { buffer: await image.toColourspace("srgb").jpeg({ quality: 92, mozjpeg: true }).toBuffer(), mimeType: "image/jpeg" }
    : { buffer: await image.toColourspace("srgb").png().toBuffer(), mimeType: "image/png" };
  if (normalized.buffer.length > maxBytes) {
    throw new Error(`Yeniden kodlanmış görsel çok büyük (en fazla ${Math.round(maxBytes / 1024 / 1024)}MB).`);
  }
  return normalized;
}

export function imageExtensionFor(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

// Google Drive paylaşım linkleri (ör. ChatGPT'de üretilip Drive'a kaydedilmiş
// bir görsel) doğrudan bir görsel dosyası URL'i DEĞİLDİR — bir HTML görüntüleyici
// sayfasına işaret eder. Dosya ID'sini tanınan biçimlerden çıkarır:
// /file/d/<ID>/view(?...) ve ?id=<ID> (open?id=..., uc?id=... dahil).
// Dönüş: bulunan ID (string) | "" (Drive linki ama ID çıkarılamadı) |
// null (Drive linki değil — hiç dokunulmamalı, normal HTTPS akışı sürer).
export function extractDriveFileId(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const fileMatch = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  return url.searchParams.get("id") || "";
}

// Tanınan bir Drive dosya ID'sini, mevcut assertPublicHttpsUrl/fetchPublicImage
// güvenlik ve içerik-tipi kontrollerinden geçirilebilecek doğrudan bir indirme
// URL'ine çevirir. Drive linki değilse (extractDriveFileId null döndürürse)
// rawUrl'i olduğu gibi geri verir — normal HTTPS görsel akışı hiç etkilenmez.
export function normalizeDriveUrl(rawUrl) {
  const fileId = extractDriveFileId(rawUrl);
  if (fileId === null) return rawUrl;
  if (!fileId) {
    throw new Error("Google Drive linki tanındı ama dosya ID'si çıkarılamadı. Desteklenen biçimler: https://drive.google.com/file/d/<ID>/view veya https://drive.google.com/open?id=<ID>.");
  }
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}
