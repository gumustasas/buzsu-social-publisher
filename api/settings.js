import "dotenv/config";
import { getSession } from "../src/auth.js";
import { getAutopilotEnabled, setAutopilotEnabled } from "../src/lib/settings.js";

function authorized(request) { return Boolean(getSession(request)); }

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") {
      return response.status(200).json({ ok: true, autopilot: await getAutopilotEnabled() });
    }
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    if (typeof body.autopilot !== "boolean") return response.status(400).json({ error: "autopilot (true/false) gerekli." });
    await setAutopilotEnabled(body.autopilot);
    return response.status(200).json({ ok: true, autopilot: body.autopilot });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
