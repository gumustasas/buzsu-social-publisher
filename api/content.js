import "dotenv/config";
import { buildDraft } from "../src/content-worker.js";
import { getSession } from "../src/auth.js";

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

async function listProducts() {
  const data = await airtable("?pageSize=100");
  const seen = new Set();
  return (data.records || []).map((record) => {
    const fields = record.fields || {};
    return { id: record.id, title: fields.Ba\u015fl\u0131k || "Ba\u015fl\u0131ks\u0131z", url: fields["Kaynak URL"] || "", imageUrl: fields["G\u00f6rsel URL"] || "", instagramText: fields["Instagram Metni"] || "", facebookText: fields["Facebook Metni"] || "" };
  }).filter((product) => {
    const key = product.url || product.id;
    if (!product.url || !product.imageUrl || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") return response.status(200).json({ ok: true, products: await listProducts() });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const products = await listProducts();
    const product = products.find((item) => item.id === body.productId);
    const platforms = Array.isArray(body.platforms) ? body.platforms.filter((item) => ["Instagram", "Facebook"].includes(item)) : [];
    const format = ["Gönderi", "Hikâye"].includes(body.format) ? body.format : "Gönderi";
    if (!product) return response.status(400).json({ error: "Ürün seçilmedi veya görsel/URL eksik." });
    if (!platforms.length) return response.status(400).json({ error: "En az bir platform seçin." });
    if (!validDate(body.publishAt)) return response.status(400).json({ error: "Geçerli bir yayın zamanı seçin." });
    const draft = buildDraft(product, { format, platforms, variant: Number(body.variant || 0), publishAt: body.publishAt });
    if (body.action === "preview") return response.status(200).json({ ok: true, draft });
    if (!draft.valid) return response.status(400).json({ error: draft.warnings.join(" ") });
    const content = draft;
    const record = await airtable("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: {
      "Başlık": `${content.title} | ${format}`,
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
      Not: "Panelden oluşturuldu; önizleme ve kullanıcı onayı bekleniyor.",
      "Deneme Sayısı": 0,
      "Hata Mesajı": ""
    } }) });
    return response.status(201).json({ ok: true, id: record.id, status: record.fields?.Durum || "Taslak" });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
