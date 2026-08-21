import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableProviders, generateCaption } from "../src/ai-providers.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
function authorized(request) { return Boolean(getSession(request)); }
async function airtable(path = "") { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const providers = availableProviders().filter((provider) => provider === "openai" || provider === "gemini");
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const provider = providers.includes(body.provider) ? body.provider : providers[0];
    if (!provider) return response.status(400).json({ error: "OPENAI_API_KEY veya GEMINI_API_KEY Vercel Production ortamında tanımlı değil." });

    const data = await airtable();
    const record = (data.records || []).find((item) => item.id === body.productId);
    const fields = record?.fields || {};
    if (!record) return response.status(400).json({ error: "Ürün seçilmedi." });

    const product = { title: fields.Başlık || "Buzsu ürünü", url: fields["Kaynak URL"] || "" };
    const caption = await generateCaption(provider, product, process.env);
    return response.status(200).json({ ok: true, caption });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
