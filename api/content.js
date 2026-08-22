import "dotenv/config";
import { buildDraft } from "../src/content-worker.js";
import { getSession } from "../src/auth.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { listCatalogProducts, catalogProductId } from "../src/lib/product-catalog.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";

function authorized(request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(getSession(request)) || Boolean(expected && request.headers.authorization === `Bearer ${expected}`);
}

async function airtable(path = "", options = {}) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
}

// \u00dcr\u00fcn listesi iki kayna\u011f\u0131n birle\u015fimidir: (1) Airtable'daki mevcut Sosyal
// Medya Takvimi kay\u0131tlar\u0131 \u2014 bunlar daha \u00f6nce payla\u015f\u0131lm\u0131\u015f/taslak \u00fcr\u00fcnlerdir
// ve genelde bir G\u00f6rsel URL'e sahiptir; (2) buzsu.com.tr'nin llms-full.txt
// katalo\u011fundaki, hen\u00fcz hi\u00e7 Airtable kayd\u0131 olmayan \u00fcr\u00fcnler \u2014 bunlar\u0131n
// imageUrl'i bo\u015ftur ve panelde elle girilmesi gerekir (bkz. dashboard.html).
// G\u00f6rsel URL zorunlulu\u011fu art\u0131k burada de\u011fil, kay\u0131t s\u0131ras\u0131nda buildDraft()
// i\u00e7inde kontrol edilir; b\u00f6ylece g\u00f6rseli eksik \u00fcr\u00fcnler listeden tamamen
// kaybolmak yerine "elle gir" se\u00e7ene\u011fiyle g\u00f6r\u00fcn\u00fcr kal\u0131r.
async function listProducts() {
  const data = await airtable("?pageSize=100");
  const seen = new Set();
  const airtableProducts = (data.records || []).map((record) => {
    const fields = record.fields || {};
    return { id: record.id, title: baseProductTitle(fields.Ba\u015fl\u0131k) || "Ba\u015fl\u0131ks\u0131z", url: fields["Kaynak URL"] || "", imageUrl: fields["G\u00f6rsel URL"] || "", instagramText: fields["Instagram Metni"] || "", facebookText: fields["Facebook Metni"] || "" };
  }).filter((product) => {
    const key = product.url || product.id;
    if (!product.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const catalog = await listCatalogProducts();
  const catalogProducts = catalog.map((item) => ({ id: catalogProductId(item.url), title: item.title, url: item.url, imageUrl: "", instagramText: "", facebookText: "" })).filter((product) => {
    if (seen.has(product.url)) return false;
    seen.add(product.url);
    return true;
  });
  return [...airtableProducts, ...catalogProducts];
}

function validDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") return response.status(200).json({ ok: true, products: await listProducts() });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const products = await listProducts();
    const matchedProduct = products.find((item) => item.id === body.productId);
    const sceneImageUrl = typeof body.imageUrl === "string" && /^https:\/\//i.test(body.imageUrl) ? body.imageUrl : "";
    const product = matchedProduct && sceneImageUrl ? { ...matchedProduct, imageUrl: sceneImageUrl } : matchedProduct;
    const platforms = Array.isArray(body.platforms) ? body.platforms.filter((item) => ["Instagram", "Facebook"].includes(item)) : [];
    const format = ["Gönderi", "Hikâye"].includes(body.format) ? body.format : "Gönderi";
    if (!product) return response.status(400).json({ error: "Ürün seçilmedi veya görsel/URL eksik." });
    if (!platforms.length) return response.status(400).json({ error: "En az bir platform seçin." });
    if (!validDate(body.publishAt)) return response.status(400).json({ error: "Geçerli bir yayın zamanı seçin." });
    const aiCaption = body.aiCaption && typeof body.aiCaption.instagramText === "string" && typeof body.aiCaption.facebookText === "string" ? body.aiCaption : null;
    const draft = buildDraft(product, { format, platforms, variant: Number(body.variant || 0), publishAt: body.publishAt, captionOverride: aiCaption });
    if (body.action === "preview") return response.status(200).json({ ok: true, draft });
    if (!draft.valid) return response.status(400).json({ error: draft.warnings.join(" ") });
    const content = draft;
    // draft.title (from buildDraft) already ends with " | {format}" — do not
    // append format again here, or the title doubles up on every save.
    const record = await airtable("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: {
      "Başlık": content.title,
      "İçerik Türü": "Ürün",
      "Kaynak URL": product.url,
      "Görsel URL": product.imageUrl,
      "Instagram Metni": content.instagramText,
      "Facebook Metni": content.facebookText,
      Hashtagler: content.hashtags,
      Platform: platforms,
      "Yayın Biçimi": format,
      "Yayın Zamanı": body.publishAt,
      Durum: "Taslak",
      Not: (() => {
        const aiParts = [sceneImageUrl && "sahne görseli", aiCaption && "gönderi metni"].filter(Boolean);
        return aiParts.length
          ? `Panelden oluşturuldu (AI ile üretilmiş ${aiParts.join(" ve ")}); önizleme ve kullanıcı onayı bekleniyor.`
          : "Panelden oluşturuldu; önizleme ve kullanıcı onayı bekleniyor.";
      })(),
      "Deneme Sayısı": 0,
      "Hata Mesajı": ""
    } }) });
    return response.status(201).json({ ok: true, id: record.id, status: record.fields?.Durum || "Taslak" });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
