import "dotenv/config";
import { put } from "@vercel/blob";
import { getSession } from "../src/auth.js";
import { generateLyriaMusic, lyriaMusicStatus } from "../src/lyria-music.js";

export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});

    let result;
    if (body.action === "status") {
      result = await lyriaMusicStatus(body.job, process.env);
    } else {
      result = await generateLyriaMusic({
        scenario: body.scenario,
        musicBrief: body.musicBrief,
        musicPrompt: body.musicPrompt,
        durationSeconds: body.durationSeconds,
        tier: body.tier || "clip",
        confirmed: body.confirmed === true
      }, process.env);
    }

    if (result.status === "COMPLETED" && result.audioBuffer && !result.musicUrl) {
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const blob = await put(`lyria-music/lyria-${Date.now()}.mp3`, result.audioBuffer, { access: "public", contentType: result.mimeType || "audio/mpeg" });
        result = { ...result, musicUrl: blob.url, audioBuffer: undefined };
      } else {
        result = { ...result, audioBuffer: undefined, downloadNote: "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için müzik kalıcı bir bağlantı alamadı." };
      }
    }
    return response.status(200).json({ ok: true, lyria: result });
  } catch (error) {
    console.error(error);
    if (error.code === "RATE_LIMITED") return response.status(429).json({ ok: false, ...error.toJSON() });
    return response.status(500).json({ ok: false, error: error.message });
  }
}
