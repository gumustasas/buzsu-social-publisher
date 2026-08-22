import "dotenv/config";
import { put } from "@vercel/blob";
import { getSession } from "../src/auth.js";

function authorized(request) { return Boolean(getSession(request)); }

// Vercel serverless fonksiyonlarında istek gövdesi ~4.5MB ile sınırlı;
// base64 kodlama ham boyutu ~%33 büyüttüğü için ham dosyayı güvenli tarafta
// kalacak şekilde 3MB'la sınırlıyoruz (base64 hali ~4MB, JSON zarfıyla
// birlikte 4.5MB sınırının altında kalır).
const MAX_RAW_BYTES = 3 * 1024 * 1024;

// Katalog ürünlerinin (bkz. src/lib/product-catalog.js) veya Airtable'da
// "Görsel URL" alanı boş bırakılmış ürünlerin fotoğrafı yok; kullanıcı
// panelden bir URL yapıştırmak yerine telefonundaki fotoğrafı doğrudan
// yükleyebilsin diye bu uç nokta var. Yüklenen görsel geçici bir kaynak
// fotoğraftır — sahne üretiminde girdi olarak kullanılır, kalıcı bir ürün
// kaydı değildir.
export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return response.status(400).json({ error: "BLOB_READ_WRITE_TOKEN Vercel Production ortamında tanımlı değil." });
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const dataUrl = String(body.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return response.status(400).json({ error: "Geçerli bir görsel dosyası değil." });
    const [, mimeType, base64] = match;
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_RAW_BYTES) return response.status(413).json({ error: `Görsel boyutu çok büyük (en fazla ${Math.round(MAX_RAW_BYTES / 1024 / 1024)}MB). Daha küçük bir fotoğraf seçin.` });
    const extension = (mimeType.split("/")[1] || "jpg").split("+")[0];
    const blob = await put(`manual-uploads/${Date.now()}.${extension}`, buffer, { access: "public", contentType: mimeType });
    return response.status(200).json({ ok: true, url: blob.url });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
