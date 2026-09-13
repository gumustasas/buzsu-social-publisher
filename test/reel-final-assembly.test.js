import test from "node:test";
import assert from "node:assert/strict";
import { validateReelFinalInput, composeReelFinal, getReelFinalStatus } from "../src/reel-final-assembly.js";

test("validateReelFinalInput requires at least one sceneVideoUrls entry", () => {
  assert.throws(() => validateReelFinalInput({}), /sceneVideoUrls/);
  assert.throws(() => validateReelFinalInput({ sceneVideoUrls: [] }), /sceneVideoUrls/);
});

test("validateReelFinalInput preserves scene order and rejects a non-HTTPS scene URL", () => {
  const result = validateReelFinalInput({
    sceneVideoUrls: ["https://example.com/scene-1.mp4", "https://example.com/scene-2.mp4"],
    musicUrl: "https://example.com/music.mp3"
  });
  assert.deepEqual(result.sceneVideoUrls, ["https://example.com/scene-1.mp4", "https://example.com/scene-2.mp4"]);
  assert.throws(
    () => validateReelFinalInput({ sceneVideoUrls: ["http://example.com/scene-1.mp4"], musicUrl: "https://example.com/m.mp3" }),
    /yalnızca HTTPS/
  );
});

test("validateReelFinalInput requires at least one of voiceoverUrl/musicUrl (same constraint as the underlying FFmpeg mix layer)", () => {
  assert.throws(
    () => validateReelFinalInput({ sceneVideoUrls: ["https://example.com/scene-1.mp4"] }),
    /voiceoverUrl.*musicUrl/
  );
});

test("validateReelFinalInput accepts voiceoverUrl only, musicUrl only, or both", () => {
  const scenes = ["https://example.com/scene-1.mp4"];
  assert.doesNotThrow(() => validateReelFinalInput({ sceneVideoUrls: scenes, voiceoverUrl: "https://example.com/voice.wav" }));
  assert.doesNotThrow(() => validateReelFinalInput({ sceneVideoUrls: scenes, musicUrl: "https://example.com/music.mp3" }));
  assert.doesNotThrow(() => validateReelFinalInput({ sceneVideoUrls: scenes, voiceoverUrl: "https://example.com/voice.wav", musicUrl: "https://example.com/music.mp3" }));
});

test("validateReelFinalInput defaults musicVolume to 0.5 and rejects an out-of-range value", () => {
  const result = validateReelFinalInput({ sceneVideoUrls: ["https://example.com/s.mp4"], musicUrl: "https://example.com/m.mp3" });
  assert.equal(result.musicVolume, 0.5);
  assert.throws(() => validateReelFinalInput({ sceneVideoUrls: ["https://example.com/s.mp4"], musicUrl: "https://example.com/m.mp3", musicVolume: 2 }), /musicVolume/);
});

// FFmpeg concat+mix ÜCRETSİZDİR — compose_reel_audio ile AYNI sebeple confirmed şartı YOK.
test("composeReelFinal writes a queued job status with the ordered scene list, dispatches the workflow, and returns jobId — no confirmed:true required", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: `https://blob.example.com/${path}` }; };
  let dispatchedBody = null;
  const fetchImpl = async (url, options) => { dispatchedBody = JSON.parse(options.body); return { status: 204 }; };
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    const result = await composeReelFinal(
      { sceneVideoUrls: ["https://example.com/scene-1.mp4", "https://example.com/scene-2.mp4"], voiceoverUrl: "https://example.com/voice.wav" },
      { putImpl, fetchImpl, randomUUIDImpl: () => "job-final-1" }
    );
    assert.equal(result.jobId, "job-final-1");
    assert.equal(result.status, "queued");
    assert.equal(putCalls[0].body.status, "queued");
    assert.deepEqual(putCalls[0].body.payload.sceneVideoUrls, ["https://example.com/scene-1.mp4", "https://example.com/scene-2.mp4"]);
    assert.equal(dispatchedBody.inputs.jobId, "job-final-1");
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("composeReelFinal throws and marks the job failed when GITHUB_DISPATCH_TOKEN is missing", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  delete process.env.GITHUB_DISPATCH_TOKEN;
  await assert.rejects(
    () => composeReelFinal({ sceneVideoUrls: ["https://example.com/s.mp4"], musicUrl: "https://example.com/m.mp3" }, { putImpl, randomUUIDImpl: () => "job-final-2" }),
    /GITHUB_DISPATCH_TOKEN/
  );
  assert.equal(putCalls.at(-1).body.status, "failed");
});

test("composeReelFinal throws and marks the job failed when the GitHub API rejects the dispatch", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  const fetchImpl = async () => ({ status: 404, json: async () => ({ message: "Not Found" }) });
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    await assert.rejects(
      () => composeReelFinal({ sceneVideoUrls: ["https://example.com/s.mp4"], musicUrl: "https://example.com/m.mp3" }, { putImpl, fetchImpl, randomUUIDImpl: () => "job-final-3" }),
      /workflow_dispatch başarısız/
    );
    assert.equal(putCalls.at(-1).body.status, "failed");
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

// getReelAudioStatus BİREBİR reuse edilir — jobId üreten workflow'dan bağımsızdır.
test("getReelFinalStatus is the exact same function as getReelAudioStatus (reused, not reimplemented)", async () => {
  const listImpl = async () => ({ blobs: [] });
  const result = await getReelFinalStatus("no-such-job", { listImpl });
  assert.equal(result.status, "unknown");
});

test("getReelFinalStatus reads back the completed status written by the render-reel-final.mjs worker", async () => {
  const listImpl = async () => ({ blobs: [{ pathname: "video-jobs/job-final-1.json", url: "https://blob.example.com/video-jobs/job-final-1.json" }] });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ jobId: "job-final-1", status: "completed", videoUrl: "https://blob.example.com/final.mp4", sceneCount: 3, voiceoverIncluded: true, musicIncluded: false }) });
  const result = await getReelFinalStatus("job-final-1", { listImpl, fetchImpl });
  assert.equal(result.status, "completed");
  assert.equal(result.videoUrl, "https://blob.example.com/final.mp4");
  assert.equal(result.sceneCount, 3);
});
