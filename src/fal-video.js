import { buildVideoPrompt } from "./lib/video-prompt.js";

const DEFAULT_MODEL = "fal-ai/minimax-video/image-to-video";

function falHeaders(env) {
  return { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json" };
}

async function readJson(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.detail || `fal.ai HTTP ${response.status}`);
  return data;
}

export function falModel(env = process.env) { return env.FAL_VIDEO_MODEL || DEFAULT_MODEL; }

export async function submitFalVideo(product, env = process.env, { sceneDescription, userIntent } = {}) {
  if (!env.FAL_KEY) throw new Error("FAL_KEY Vercel Production ortamında tanımlı değil.");
  const imageUrl = String(product.imageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("fal.ai için ürün görseli herkese açık HTTPS URL olmalı.");
  const prompt = buildVideoPrompt(product.title, sceneDescription, userIntent);
  const model = falModel(env);
  const response = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: falHeaders(env), body: JSON.stringify({ prompt, image_url: imageUrl }) });
  const data = await readJson(response);
  return { provider: "fal", model, requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url, queuePosition: data.queue_position ?? null, product: product.title, imageUrl, prompt, createdAt: new Date().toISOString() };
}

export async function falVideoStatus(job, env = process.env) {
  if (!env.FAL_KEY) throw new Error("FAL_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.statusUrl || !job?.responseUrl) throw new Error("fal.ai iş bilgisi eksik.");
  const statusResponse = await fetch(`${job.statusUrl}${job.statusUrl.includes("?") ? "&" : "?"}logs=1`, { headers: { Authorization: `Key ${env.FAL_KEY}` } });
  const status = await readJson(statusResponse);
  if (status.status !== "COMPLETED") return { ...job, status: status.status, queuePosition: status.queue_position ?? job.queuePosition, logs: status.logs || [] };
  const resultResponse = await fetch(job.responseUrl, { headers: { Authorization: `Key ${env.FAL_KEY}` } });
  const result = await readJson(resultResponse);
  const videoUrl = result.video?.url || result.video_url || result.output?.video?.url || result.url || null;
  return { ...job, status: "COMPLETED", videoUrl, result, logs: status.logs || [] };
}
