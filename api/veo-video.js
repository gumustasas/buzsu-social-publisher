import "dotenv/config";
import { put } from "@vercel/blob";
import { getSession } from "../src/auth.js";
import { veoVideoStatus, downloadVeoVideo } from "../src/veo-video.js";

export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    let job = await veoVideoStatus(body.job);
    if (job.status === "COMPLETED" && job.fileUri && !job.videoUrl) {
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const videoBuffer = await downloadVeoVideo(job.fileUri);
        const blob = await put(`ai-reels/veo-${Date.now()}.mp4`, videoBuffer, { access: "public", contentType: "video/mp4" });
        job = { ...job, videoUrl: blob.url };
      } else {
        job = { ...job, downloadNote: "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için video kalıcı bir bağlantı alamadı." };
      }
    }
    return response.status(200).json({ ok: true, veo: job });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
