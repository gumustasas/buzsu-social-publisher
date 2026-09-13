import "dotenv/config";
import { put } from "@vercel/blob";
import { getSession } from "../src/auth.js";
import { generateTurkishVoiceover, turkishVoiceoverStatus } from "../src/turkish-tts.js";

export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});

    let result;
    if (body.action === "status") {
      result = await turkishVoiceoverStatus(body.job, process.env);
    } else {
      result = await generateTurkishVoiceover({
        text: body.text,
        style: body.style,
        gender: body.gender,
        voice: body.voice,
        targetDurationSeconds: body.targetDurationSeconds,
        confirmed: body.confirmed === true
      }, process.env);
    }

    if (result.status === "COMPLETED" && result.audioBuffer && !result.audioUrl) {
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const blob = await put(`turkish-voiceover/tts-${Date.now()}.wav`, result.audioBuffer, { access: "public", contentType: result.mimeType || "audio/wav" });
        result = { ...result, audioUrl: blob.url, audioBuffer: undefined };
      } else {
        result = { ...result, audioBuffer: undefined, downloadNote: "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için ses kalıcı bir bağlantı alamadı." };
      }
    }
    return response.status(200).json({ ok: true, tts: result });
  } catch (error) {
    console.error(error);
    if (error.code === "RATE_LIMITED") return response.status(429).json({ ok: false, ...error.toJSON() });
    if (error.code === "TURKISH_TTS_UNAVAILABLE") return response.status(error.httpStatus || 400).json({ ok: false, ...error.toJSON() });
    if (error.code === "VOICEOVER_TOO_LONG") return response.status(422).json({ ok: false, code: "VOICEOVER_TOO_LONG", error: error.message, durationSeconds: error.durationSeconds, targetDurationSeconds: error.targetDurationSeconds });
    return response.status(500).json({ ok: false, error: error.message });
  }
}
