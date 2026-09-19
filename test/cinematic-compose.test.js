import test from "node:test";
import assert from "node:assert/strict";
import { composeCinematicReel, getCinematicRenderStatus } from "../src/cinematic-compose.js";

const SCENE = (n) => ({ imageUrl: `https://example.com/p${n}.png`, durationSeconds: 3 });

test("composeCinematicReel writes a queued job status, dispatches the cinematic workflow with the jobId, and returns jobId — no confirmed:true gate (render is free)", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: `https://blob.example.com/${path}` }; };
  let dispatchedUrl, dispatchedBody;
  const fetchImpl = async (url, options) => { dispatchedUrl = url; dispatchedBody = JSON.parse(options.body); return { status: 204 }; };
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    const result = await composeCinematicReel(
      { scenes: [SCENE(1), SCENE(2)] },
      { putImpl, fetchImpl, randomUUIDImpl: () => "cin-job-1" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.jobId, "cin-job-1");
    assert.equal(result.status, "queued");
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].path, "video-jobs/cin-job-1.json", "compose_product_video ile AYNI paylaşılan video-jobs/ alanı kullanılmalı");
    assert.equal(putCalls[0].body.payload.scenes.length, 2);
    assert.match(dispatchedUrl, /\/actions\/workflows\/render-cinematic-reel\.yml\/dispatches$/);
    assert.equal(dispatchedBody.inputs.jobId, "cin-job-1");
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("composeCinematicReel rejects invalid input before any network/Blob write", async () => {
  const putImpl = async () => { throw new Error("must not be called"); };
  await assert.rejects(() => composeCinematicReel({ scenes: [SCENE(1)] }, { putImpl }), /en az 2/);
});

test("composeCinematicReel throws and marks the job failed when GITHUB_DISPATCH_TOKEN is missing", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  delete process.env.GITHUB_DISPATCH_TOKEN;
  await assert.rejects(
    () => composeCinematicReel({ scenes: [SCENE(1), SCENE(2)] }, { putImpl, randomUUIDImpl: () => "cin-job-2" }),
    /GITHUB_DISPATCH_TOKEN/
  );
  assert.equal(putCalls[0].body.status, "queued");
  assert.equal(putCalls[1].body.status, "failed");
  assert.equal(putCalls[1].options.allowOverwrite, true);
});

test("getCinematicRenderStatus requires a jobId", async () => {
  await assert.rejects(() => getCinematicRenderStatus(""), /jobId gereklidir/);
});

test("getCinematicRenderStatus returns status:'unknown' when no job record exists", async () => {
  const listImpl = async () => ({ blobs: [] });
  const result = await getCinematicRenderStatus("missing-job", { listImpl });
  assert.equal(result.status, "unknown");
});

test("getCinematicRenderStatus returns the stored job status (including cinematic-specific output metadata) when found", async () => {
  const listImpl = async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: "https://blob.example.com/video-jobs/cin-1.json" }] });
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      jobId: "cin-1", status: "completed", videoUrl: "https://blob.example.com/v.mp4",
      durationSeconds: 9.1, width: 1080, height: 1920, fps: 30, fileSizeBytes: 3500000,
      sceneCount: 2, appliedEffects: ["camera_push_in", "color_grade_clean-tech"], fallbacks: [], warnings: []
    })
  });
  const result = await getCinematicRenderStatus("cin-1", { listImpl, fetchImpl });
  assert.equal(result.status, "completed");
  assert.equal(result.sceneCount, 2);
  assert.ok(Array.isArray(result.appliedEffects));
});
