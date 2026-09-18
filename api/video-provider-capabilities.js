import "dotenv/config";
import { getSession } from "../src/auth.js";
import { getVideoProviderCapabilities } from "../src/lib/video-provider-capabilities.js";

// Yalnızca oturum açmış (Editor/Admin) kullanıcılar erişebilir — diğer API
// route'larıyla aynı auth deseni (bkz. api/reels.js, api/omni-video.js).
// Yanıt HİÇBİR ZAMAN API key/secret/token İÇERMEZ, yalnızca available/models
// alanları döner.
export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  try {
    const capabilities = await getVideoProviderCapabilities(process.env);
    return response.status(200).json({ ok: true, ...capabilities });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
