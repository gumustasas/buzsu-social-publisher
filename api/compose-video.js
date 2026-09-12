import "dotenv/config";
import { getSession } from "../src/auth.js";
import { composeProductVideo, getVideoRenderStatus, MIN_MEDIA_ITEMS, MAX_MEDIA_ITEMS } from "../src/video-compose.js";

function authorized(request) { return Boolean(getSession(request)); }

// Dashboard'daki "Ücretsiz slayt videosu (FFmpeg)" bölümü için ince bir
// sarmalayıcı — asıl doğrulama/iş kuyruğa alma mantığı zaten compose_product_video
// MCP aracıyla paylaşılan src/video-compose.js'de; burada yalnızca oturum
// kontrolü ve HTTP şekli eklenir (bkz. api/reel-render.js aynı GET/POST deseni).
export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") {
      const jobId = new URL(request.url, "https://buzsu-social-publisher.vercel.app").searchParams.get("jobId");
      if (!jobId) return response.status(400).json({ error: "jobId gerekli." });
      const status = await getVideoRenderStatus(jobId);
      return response.status(200).json(status);
    }
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    if (!Array.isArray(body.mediaItems) || body.mediaItems.length < MIN_MEDIA_ITEMS || body.mediaItems.length > MAX_MEDIA_ITEMS) {
      return response.status(400).json({ error: `${MIN_MEDIA_ITEMS}-${MAX_MEDIA_ITEMS} arasında ürün seçin.` });
    }
    const result = await composeProductVideo({
      mediaItems: body.mediaItems,
      transition: body.transition,
      musicMood: body.musicMood || undefined,
      upscaleImages: body.upscaleImages === true,
      confirmed: body.confirmed === true
    });
    return response.status(200).json(result);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
