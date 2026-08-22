import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableProviders, generateReelPackage } from "../src/ai-providers.js";
import { submitFalVideo } from "../src/fal-video.js";
import { submitVeoVideo } from "../src/veo-video.js";
import { baseProductTitle } from "../src/lib/product-title.js";

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
    // Kompozerde önceden bir AI sahne görseli üretilip kalıcı bir URL aldıysa
    // (bkz. api/scene-image.js), video bunun üzerinden üretilsin — kullanıcı
    // önizlediği sahneyi baz almak istiyor, ham ürün fotoğrafını değil.
    const sceneImageUrl = typeof body.sceneImageUrl === "string" && /^https:\/\//i.test(body.sceneImageUrl) ? body.sceneImageUrl : null;
    const sceneDescription = sceneImageUrl && typeof body.sceneDescription === "string" ? body.sceneDescription : undefined;
    const userIntent = sceneImageUrl && typeof body.userIntent === "string" ? body.userIntent : undefined;
    const product = { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", url: fields["Kaynak URL"], imageUrl: sceneImageUrl || fields["Görsel URL"] };
    if (body.provider === "fal") return response.status(200).json({ ok: true, fal: await submitFalVideo(product, process.env, { sceneDescription, userIntent }) });
    if (body.provider === "veo") return response.status(200).json({ ok: true, veo: await submitVeoVideo(product, process.env, { sceneDescription, userIntent }) });
    const reel = await generateReelPackage(body.provider, product);
    return response.status(200).json({ ok: true, reel });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
