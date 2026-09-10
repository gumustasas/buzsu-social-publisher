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
