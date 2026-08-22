import "dotenv/config";
import { getSession } from "../src/auth.js";
import { ga4Configured, topViewedPages, topAddToCart, activeVisitors } from "../src/lib/ga4.js";

function authorized(request) { return Boolean(getSession(request)); }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
    if (!ga4Configured()) return response.status(200).json({ ok: true, connected: false });

    const [pages, addToCart, visitors] = await Promise.all([
      topViewedPages(process.env, { days: 7, limit: 8 }),
      topAddToCart(process.env, { days: 7, limit: 8 }),
      activeVisitors(process.env).catch(() => null)
    ]);

    return response.status(200).json({ ok: true, connected: true, pages, addToCart, activeVisitors: visitors });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
