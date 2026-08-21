import "dotenv/config";
import { getSession } from "../src/auth.js";
import { generateSceneImage } from "../src/scene-image.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") return response.status(200).json({ ok: true, available: Boolean(process.env.OPENAI_API_KEY) });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    if (!process.env.OPENAI_API_KEY) return response.status(400).json({ error: "OPENAI_API_KEY Vercel Production ortamında tanımlı değil." });

    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const data = await airtable();
    const record = (data.records || []).find((item) => item.id === body.productId);
    const fields = record?.fields || {};
    if (!record || !fields["Görsel URL"]) return response.status(400).json({ error: "Ürün görseli eksik." });

    const product = { title: fields.Başlık || "Buzsu ürünü", imageUrl: fields["Görsel URL"] };
    const scene = await generateSceneImage(product, body.sceneDescription, process.env, { removeFaucet: Boolean(body.removeFaucet) });
    return response.status(200).json({ ok: true, scene });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
