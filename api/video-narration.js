import "dotenv/config";
import { getSession } from "../src/auth.js";
import { generateVideoNarration } from "../src/video-narration.js";

export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const narration = await generateVideoNarration(
      { scenario: body.scenario, productName: body.productName, durationSeconds: body.durationSeconds, style: body.style },
      process.env
    );
    return response.status(200).json({ ok: true, narration });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
