import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableProviders, generateReelPackage } from "../src/ai-providers.js";
import { submitFalVideo } from "../src/fal-video.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }
export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    const providers = availableProviders();
    if (request.method === "GET") return response.status(200).json({ ok: true, providers });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    if (!providers.includes(body.provider)) return response.status(400).json({ error: "Seçilen AI sağlayıcısının API anahtarı Vercel'de tanımlı değil." });
    const data = await airtable(); const record = (data.records || []).find((item) => item.id === body.productId); const fields = record?.fields || {};
    if (!record || !fields["Kaynak URL"] || !fields["Görsel URL"]) return response.status(400).json({ error: "Ürün URL veya görsel bilgisi eksik." });
    const product = { title: fields.Başlık || "Buzsu ürünü", url: fields["Kaynak URL"], imageUrl: fields["Görsel URL"] };
    if (body.provider === "fal") return response.status(200).json({ ok: true, fal: await submitFalVideo(product) });
    const reel = await generateReelPackage(body.provider, product);
    return response.status(200).json({ ok: true, reel });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
