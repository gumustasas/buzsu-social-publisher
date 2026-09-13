import "dotenv/config";
import { put } from "@vercel/blob";
import { getSession } from "../src/auth.js";
import { submitOmniVideoEdit, omniInteractionStatus, downloadOmniVideo } from "../src/omni-video.js";

export default async function handler(request, response) {
  if (!getSession(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});

    let job;
    if (body.action === "status") {
      job = await omniInteractionStatus(body.job);
    } else {
      job = await submitOmniVideoEdit(body.existingVideoUrl, process.env, {
        referenceImageUrl: body.referenceImageUrl,
        editPrompt: body.editPrompt,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        confirmed: body.confirmed === true
      });
    }
    if (job.status === "COMPLETED" && job.fileUri && !job.videoUrl) {
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const videoBuffer = await downloadOmniVideo(job.fileUri, process.env);
        const blob = await put(`ai-omni/omni-${Date.now()}.mp4`, videoBuffer, { access: "public", contentType: "video/mp4" });
        job = { ...job, videoUrl: blob.url };
      } else {
        job = { ...job, downloadNote: "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için video kalıcı bir bağlantı alamadı." };
      }
    }
    return response.status(200).json({ ok: true, omni: job });
  } catch (error) {
    console.error(error);
    // RATE_LIMITED ve REGION_UNAVAILABLE (bkz. src/omni-video.js:OmniApiError)
    // gerçek HTTP kodlarıyla ve code/model gibi alanlarla dönüyor — dashboard
    // bu sayede "kota doldu" / "bölgede yok" durumlarını 500'den ayırt
    // edebilir. Diğer tüm hatalar eskisi gibi 500. Hiçbir durumda otomatik
    // tekrar/model değişimi burada YAPILMAZ.
    if (error.code === "RATE_LIMITED") return response.status(429).json({ ok: false, ...error.toJSON() });
    if (error.code === "REGION_UNAVAILABLE") return response.status(error.httpStatus || 403).json({ ok: false, ...error.toJSON() });
    return response.status(500).json({ ok: false, error: error.message });
  }
}
