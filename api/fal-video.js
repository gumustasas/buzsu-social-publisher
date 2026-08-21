import "dotenv/config";
import { getSession } from "../src/auth.js";
import { falVideoStatus } from "../src/fal-video.js";

export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    return response.status(200).json({ ok: true, fal: await falVideoStatus(body.job) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
