import "dotenv/config";
import { getSession } from "../src/auth.js";
import { availableProviders } from "../src/ai-providers.js";
import { parseIntent } from "../src/lib/intent-parser.js";
import { listProducts } from "../src/lib/products.js";

function authorized(request) { return Boolean(getSession(request)); }

function intentProviders(env = process.env) {
  return availableProviders(env).filter((provider) => provider === "openai" || provider === "anthropic" || provider === "gemini");
}

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") return response.status(200).json({ ok: true, providers: intentProviders() });
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });

    const providers = intentProviders();
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const provider = providers.includes(body.provider) ? body.provider : providers[0];
    if (!provider) return response.status(400).json({ error: "OPENAI_API_KEY, ANTHROPIC_API_KEY veya GEMINI_API_KEY Vercel Production ortamında tanımlı değil." });

    const text = String(body.text || "").trim();
    if (!text) return response.status(400).json({ error: "Bir istek yazın." });

    const products = await listProducts();
    const intent = await parseIntent(provider, text, products, process.env);
    return response.status(200).json({ ok: true, intent });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
