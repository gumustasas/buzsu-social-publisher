import "dotenv/config";
import { getSession } from "../src/auth.js";
import { composeReelFinal, getReelFinalStatus } from "../src/reel-final-assembly.js";

// bkz. api/reel-audio.js — AYNI GET (durum sorgusu) / POST (işi başlat)
// deseni. getReelFinalStatus zaten getReelAudioStatus'un kendisidir (bkz.
// src/reel-final-assembly.js) — durum sorgusu için ayrı bir mekanizma YOK.
export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") {
      const jobId = new URL(request.url, "https://buzsu-social-publisher.vercel.app").searchParams.get("jobId");
      if (!jobId) return response.status(400).json({ error: "jobId gerekli." });
      const status = await getReelFinalStatus(jobId);
      return response.status(200).json(status);
    }
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const result = await composeReelFinal({
      sceneVideoUrls: body.sceneVideoUrls,
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
