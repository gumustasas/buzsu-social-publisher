import test from "node:test";
import assert from "node:assert/strict";
import { videoJobPath, writeVideoJobStatus, readVideoJobStatus } from "../src/lib/video-jobs.js";

test("videoJobPath is deterministic and stable for the same jobId", () => {
  assert.equal(videoJobPath("job-1"), "video-jobs/job-1.json");
  assert.equal(videoJobPath("job-1"), videoJobPath("job-1"));
});

test("writeVideoJobStatus writes to the deterministic path with addRandomSuffix:false and merges jobId/updatedAt into the body", async () => {
  let capturedPath, capturedBody, capturedOptions;
  const putImpl = async (path, body, options) => {
    capturedPath = path; capturedBody = body; capturedOptions = options;
    return { url: `https://blob.example.com/${path}` };
  };
  await writeVideoJobStatus("job-abc", { status: "queued" }, { putImpl });
  assert.equal(capturedPath, "video-jobs/job-abc.json");
  assert.equal(capturedOptions.addRandomSuffix, false);
  assert.equal(capturedOptions.allowOverwrite, false);
  assert.equal(capturedOptions.contentType, "application/json");
  const parsed = JSON.parse(capturedBody);
  assert.equal(parsed.jobId, "job-abc");
  assert.equal(parsed.status, "queued");
  assert.ok(parsed.updatedAt);
});

test("writeVideoJobStatus passes allowOverwrite:true through for status updates (queued -> completed/failed)", async () => {
  let capturedOptions;
  const putImpl = async (path, body, options) => { capturedOptions = options; return { url: "https://blob.example.com/x" }; };
  await writeVideoJobStatus("job-abc", { status: "completed", videoUrl: "https://blob.example.com/v.mp4" }, { allowOverwrite: true, putImpl });
  assert.equal(capturedOptions.allowOverwrite, true);
});

test("readVideoJobStatus returns null when no matching blob exists yet (job never written / already expired)", async () => {
  const listImpl = async () => ({ blobs: [] });
  const result = await readVideoJobStatus("does-not-exist", { listImpl });
  assert.equal(result, null);
});

test("readVideoJobStatus fetches the exact matching blob (by pathname) and returns its parsed JSON content", async () => {
  const listImpl = async ({ prefix }) => {
    assert.equal(prefix, "video-jobs/job-xyz.json");
    return { blobs: [{ pathname: "video-jobs/job-xyz.json", url: "https://blob.example.com/video-jobs/job-xyz.json" }] };
  };
  const fetchImpl = async (url) => {
    assert.equal(url, "https://blob.example.com/video-jobs/job-xyz.json");
    return { ok: true, json: async () => ({ jobId: "job-xyz", status: "completed", videoUrl: "https://blob.example.com/v.mp4" }) };
  };
  const result = await readVideoJobStatus("job-xyz", { listImpl, fetchImpl });
  assert.equal(result.status, "completed");
  assert.equal(result.videoUrl, "https://blob.example.com/v.mp4");
});

test("readVideoJobStatus throws a clear error when the matched blob itself cannot be fetched", async () => {
  const listImpl = async () => ({ blobs: [{ pathname: "video-jobs/job-err.json", url: "https://blob.example.com/video-jobs/job-err.json" }] });
  const fetchImpl = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => readVideoJobStatus("job-err", { listImpl, fetchImpl }), /okunamadı/);
});

// Gerçek Vercel Blob'un davranışını (addRandomSuffix:false -> sabit yol,
// allowOverwrite:false iken aynı yola ikinci bir yazım reddedilir,
// allowOverwrite:true iken içerik olduğu gibi değiştirilir) taklit eden bir
// bellek-içi sahte store ile queued -> rendering -> completed geçişinin
// GERÇEKTEN aynı kayda yazıp okunduğunu (yeni bir kayıt/çakışan URL
// oluşturmadığını) doğrular — bu, gerçek BLOB_READ_WRITE_TOKEN olmadan da
// worker'ın durum-güncelleme sözleşmesini test eder.
function createFakeBlobStore() {
  const store = new Map();
  const putImpl = async (path, body, options) => {
    if (store.has(path) && options.allowOverwrite !== true) {
      throw new Error(`Bu yolda zaten bir blob var ve allowOverwrite:true verilmedi: ${path}`);
    }
    store.set(path, body);
    return { url: `https://blob.example.com/${path}`, pathname: path };
  };
  const listImpl = async ({ prefix }) => ({
    blobs: store.has(prefix) ? [{ pathname: prefix, url: `https://blob.example.com/${prefix}` }] : []
  });
  const fetchImpl = async (url) => {
    const path = url.replace("https://blob.example.com/", "");
    return { ok: store.has(path), status: store.has(path) ? 200 : 404, json: async () => JSON.parse(store.get(path)) };
  };
  return { putImpl, listImpl, fetchImpl, store };
}

test("queued -> rendering -> completed transitions overwrite the SAME blob record end-to-end (no duplicate/stray record)", async () => {
  const { putImpl, listImpl, fetchImpl } = createFakeBlobStore();
  const jobId = "job-lifecycle";

  await writeVideoJobStatus(jobId, { status: "queued", payload: { mediaItems: [] } }, { putImpl });
  let current = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  assert.equal(current.status, "queued");

  // Gerçek Blob'da allowOverwrite:false iken aynı yola ikinci bir yazım
  // reddedilir — worker bunu bilerek yalnızca ilk "queued" yazımında
  // allowOverwrite'ı varsayılan (false) bırakır, sonraki tüm durum
  // güncellemelerinde açıkça true gönderir (bkz. render-product-video.mjs).
  await assert.rejects(
    () => writeVideoJobStatus(jobId, { status: "rendering" }, { putImpl }),
    /allowOverwrite/
  );

  await writeVideoJobStatus(jobId, { status: "rendering", payload: { mediaItems: [] } }, { allowOverwrite: true, putImpl });
  current = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  assert.equal(current.status, "rendering");

  await writeVideoJobStatus(jobId, { status: "completed", videoUrl: "https://blob.example.com/product-videos/job-lifecycle.mp4", durationSeconds: 5.8, width: 1080, height: 1920, fileSizeBytes: 123456 }, { allowOverwrite: true, putImpl });
  current = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  assert.equal(current.status, "completed");
  assert.equal(current.videoUrl, "https://blob.example.com/product-videos/job-lifecycle.mp4");
  // Yalnızca TEK bir kayıt bulunmalı (video-jobs/<jobId>.json sabit yolu) —
  // "unknown"/eski bir "queued" ile birlikte iki ayrı kayıt oluşmamalı.
  const { blobs } = await listImpl({ prefix: `video-jobs/${jobId}.json` });
  assert.equal(blobs.length, 1);
});

test("a worker failure at any stage can still mark the job 'failed' by overwriting whatever state it was in (queued or rendering)", async () => {
  const { putImpl, listImpl, fetchImpl } = createFakeBlobStore();
  const jobId = "job-fails-midway";

  await writeVideoJobStatus(jobId, { status: "queued", payload: { mediaItems: [] } }, { putImpl });
  await writeVideoJobStatus(jobId, { status: "rendering", payload: { mediaItems: [] } }, { allowOverwrite: true, putImpl });
  // ffmpeg/indirme/Blob-yükleme aşamalarından biri patlarsa worker'ın
  // markFailed() yardımcı fonksiyonu bunu yapar (bkz. render-product-video.mjs).
  await writeVideoJobStatus(jobId, { status: "failed", error: "ffmpeg exited with code 1" }, { allowOverwrite: true, putImpl });

  const current = await readVideoJobStatus(jobId, { listImpl, fetchImpl });
  assert.equal(current.status, "failed");
  assert.equal(current.error, "ffmpeg exited with code 1");
});
