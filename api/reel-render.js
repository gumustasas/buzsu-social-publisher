import "dotenv/config";
import { getSession } from "../src/auth.js";
import { baseProductTitle } from "../src/lib/product-title.js";

import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";

function authorized(request) { return Boolean(getSession(request)); }
function shotstackBase() { return process.env.SHOTSTACK_ENV === "stage" ? "https://api.shotstack.io/stage" : "https://api.shotstack.io/v1"; }

async function airtable() {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}?pageSize=100`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
}

function totalDuration(scenes) {
  const seconds = (scenes || []).reduce((sum, scene) => sum + Number(scene.seconds || 0), 0);
  return Math.min(30, Math.max(15, seconds || 20));
}

function editFor(product, reel) {
  const duration = totalDuration(reel.scenes);
  const scenes = reel.scenes?.length ? reel.scenes : [{ seconds: duration, on_screen_text: reel.hook || product.title }];
  let start = 0;
  const textClips = scenes.map((scene) => {
    const length = Math.min(Number(scene.seconds || 3), duration - start);
    const clip = { asset: { type: "text", text: String(scene.on_screen_text || scene.visual || product.title).slice(0, 100), font: { family: "Montserrat", size: 54, color: "#ffffff", weight: 600 }, background: { color: "#0b1f33", opacity: 0.86, borderRadius: 18, padding: 18 } }, start, length, width: 900, height: 300 };
    start += length;
    return clip;
  }).filter((clip) => clip.length > 0);
  return {
    timeline: {
      background: "#ffffff",
      tracks: [
        { clips: [{ asset: { type: "image", src: product.imageUrl }, start: 0, length: duration, fit: "crop", position: "center" }] },
        { clips: textClips },
        { clips: [{ asset: { type: "text", text: `${product.title}\\nwww.buzsu.com.tr`, font: { family: "Montserrat", size: 42, color: "#087ea4", weight: 600 }, background: { color: "#ffffff", opacity: 0.92, borderRadius: 12, padding: 14 } }, start: 0, length: duration, width: 900, height: 190, position: "bottom", offset: { y: 0.08 } }] }
      ]
    },
    output: { format: "mp4", size: { width: 1080, height: 1920 }, fps: 30, quality: "high" },
    callback: process.env.REEL_RENDER_CALLBACK_URL || undefined
  };
}

async function shotstack(path, options = {}) {
  const response = await fetch(`${shotstackBase()}${path}`, { ...options, headers: { "x-api-key": process.env.SHOTSTACK_API_KEY, "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.response?.error || data.response?.errors || data.error || data.message || data.response || `Render HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  if (request.method !== "POST" && request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  if (!process.env.SHOTSTACK_API_KEY) return response.status(400).json({ error: "MP4 render servisi yapılandırılmadı. Vercel Production ortamına SHOTSTACK_API_KEY ekleyin." });
  try {
    if (request.method === "GET") {
      const renderId = new URL(request.url, "https://buzsu-social-publisher.vercel.app").searchParams.get("renderId");
      if (!renderId) return response.status(400).json({ error: "renderId gerekli." });
      const data = await shotstack(`/render/${renderId}`, { method: "GET" });
      return response.status(200).json({ ok: true, render: data.response || data });
    }
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    if (!body.productId) return response.status(400).json({ error: "Ürün seçin." });
    const data = await airtable();
    const record = (data.records || []).find((item) => item.id === body.productId);
    const fields = record?.fields || {};
    if (!record || !fields["Kaynak URL"] || !fields["Görsel URL"]) return response.status(400).json({ error: "Ürün URL veya görsel bilgisi eksik." });
    const product = { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", url: fields["Kaynak URL"], imageUrl: fields["Görsel URL"] };
    const render = await shotstack("/render", { method: "POST", body: JSON.stringify(editFor(product, body.reel || {})) });
    return response.status(200).json({ ok: true, render: render.response || render, product: product.title });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
