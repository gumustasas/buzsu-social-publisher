import "dotenv/config";
import { getSession } from "../src/auth.js";
import { composeReelAudio, getReelAudioStatus } from "../src/reel-audio-compose.js";

// bkz. api/compose-video.js — aynı GET (durum sorgusu) / POST (işi başlat)
// deseni, video-jobs.js aracılığıyla Vercel Blob'dan okunan aynı jobId
// alanını paylaşır.
export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") {
      const jobId = new URL(request.url, "https://buzsu-social-publisher.vercel.app").searchParams.get("jobId");
      if (!jobId) return response.status(400).json({ error: "jobId gerekli." });
      const status = await getReelAudioStatus(jobId);
      return response.status(200).json(status);
    }
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const result = await composeReelAudio({
      videoUrl: body.videoUrl,
      voiceoverUrl: body.voiceoverUrl,
      musicUrl: body.musicUrl,
      musicVolume: body.musicVolume
    });
    return response.status(200).json(result);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
