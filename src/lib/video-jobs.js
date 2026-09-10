import { put, list } from "@vercel/blob";

// compose_product_video işlerinin durumu, GitHub'ın kendisinin sağlamadığı
// bir "run ID" beklemek yerine Vercel Blob'da öngörülebilir bir yola
// (video-jobs/<jobId>.json) yazılıp okunur:
//   1. api/mcp.js (compose_product_video) jobId üretir, "queued" durumunu
//      yazar, sonra GitHub Actions workflow_dispatch'i tetikler.
//   2. GitHub Actions runner'ı (scripts/render-product-video.mjs) aynı yola
//      "rendering" ve en sonunda "completed"/"failed" durumunu yazar.
//   3. get_video_render_status (api/mcp.js) aynı yolu okuyup olduğu gibi
//      döner — GitHub API'sine ikinci bir bağımlılık/token gerekmez.
// addRandomSuffix:false ile yol sabit tutulur (aksi hâlde her yazımda farklı
// bir URL üretilir ve okuyan taraf hangi URL'i arayacağını bilemez).
const JOB_PREFIX = "video-jobs/";

export function videoJobPath(jobId) {
  return `${JOB_PREFIX}${jobId}.json`;
}

export async function writeVideoJobStatus(jobId, status, { allowOverwrite = false, putImpl = put } = {}) {
  const body = JSON.stringify({ jobId, updatedAt: new Date().toISOString(), ...status });
  return putImpl(videoJobPath(jobId), body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite
  });
}

// list() ile yolu bulup gerçek Blob URL'inden okuyoruz — Blob store'un
// host adı (ör. <hash>.public.blob.vercel-storage.com) projeye özgü ve
// burada varsayılmıyor, sadece put()/list()'in kendi döndürdüğü URL
// kullanılıyor.
export async function readVideoJobStatus(jobId, { listImpl = list, fetchImpl = fetch } = {}) {
  const path = videoJobPath(jobId);
  const { blobs } = await listImpl({ prefix: path, limit: 1 });
  const match = blobs.find((blob) => blob.pathname === path);
  if (!match) return null;
  const response = await fetchImpl(match.url);
  if (!response.ok) throw new Error(`Video iş durumu okunamadı (HTTP ${response.status}).`);
  return response.json();
}
