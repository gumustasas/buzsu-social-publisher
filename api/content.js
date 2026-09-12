import "dotenv/config";
import { buildDraft } from "../src/content-worker.js";
import { getSession } from "../src/auth.js";
import { listProducts, createDraftRecord } from "../src/lib/products.js";

function authorized(request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(getSession(request)) || Boolean(expected && request.headers.authorization === `Bearer ${expected}`);
}

function validDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") {
      // Cache-Control: no-store ve if-none-match/if-modified-since'i silmek
      // de yetmedi — canlıda doğrulandı ki response.json()/send() Vercel'in
      // Node.js köprüsünde otomatik zayıf bir ETag üretip isteği bununla
      // karşılaştırıyor ve eşleşirse yanıtı 304'e düşürüyor; bu, .json()'ın
      // kendi içinde olan bir davranış ve bizim üstteki Cache-Control'ümüzü
      // veya request nesnesindeki başlık silmemizi hiç görmüyor (başka bir
      // uçtaki .json() çağrısı üzerinde curl ile doğrulandı: hiç Cache-
      // Control vermediğimiz bir yanıtta bile Vercel kendiliğinden
      // "public, max-age=0, must-revalidate" + weak ETag ekliyordu). Çözüm:
      // .json()/.send() hiç çağrılmıyor; ham response.end() ile yazılıyor,
      // bu da o otomatik ETag/koşullu-istek mantığını tamamen atlıyor.
      const payload = JSON.stringify({ ok: true, products: await listProducts() });
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      return response.end(payload);
    }
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const products = await listProducts();
    const matchedProduct = products.find((item) => item.id === body.productId);
    const sceneImageUrl = typeof body.imageUrl === "string" && /^https:\/\//i.test(body.imageUrl) ? body.imageUrl : "";
    const videoUrl = typeof body.videoUrl === "string" && /^https:\/\//i.test(body.videoUrl) ? body.videoUrl : "";
    const product = matchedProduct && (sceneImageUrl || videoUrl) ? { ...matchedProduct, ...(sceneImageUrl ? { imageUrl: sceneImageUrl } : {}), ...(videoUrl ? { videoUrl } : {}) } : matchedProduct;
    const platforms = Array.isArray(body.platforms) ? body.platforms.filter((item) => ["Instagram", "Facebook", "X", "YouTube"].includes(item)) : [];
    const format = ["Gönderi", "Hikâye", "Reel"].includes(body.format) ? body.format : "Gönderi";
    if (!product) return response.status(400).json({ error: "Ürün seçilmedi veya görsel/URL eksik." });
    if (!platforms.length) return response.status(400).json({ error: "En az bir platform seçin." });
    if (!validDate(body.publishAt)) return response.status(400).json({ error: "Geçerli bir yayın zamanı seçin." });
    const aiCaption = body.aiCaption && typeof body.aiCaption.instagramText === "string" && typeof body.aiCaption.facebookText === "string" ? body.aiCaption : null;
    const draft = buildDraft(product, { format, platforms, variant: Number(body.variant || 0), publishAt: body.publishAt, captionOverride: aiCaption });
    if (body.action === "preview") return response.status(200).json({ ok: true, draft });
    if (!draft.valid) return response.status(400).json({ error: draft.warnings.join(" ") });
    const note = (() => {
      const aiParts = [sceneImageUrl && "sahne görseli", videoUrl && "Reel videosu", aiCaption && "gönderi metni"].filter(Boolean);
      return aiParts.length
        ? `Panelden oluşturuldu (AI ile üretilmiş ${aiParts.join(" ve ")}); önizleme ve kullanıcı onayı bekleniyor.`
        : "Panelden oluşturuldu; önizleme ve kullanıcı onayı bekleniyor.";
    })();
    const record = await createDraftRecord({ product, draft, format, platforms, publishAt: body.publishAt, note });
    return response.status(201).json({ ok: true, id: record.id, status: record.fields?.Durum || "Taslak" });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
