import test from "node:test";
import assert from "node:assert/strict";
import { validateReelAudioInput, composeReelAudio, getReelAudioStatus } from "../src/reel-audio-compose.js";

test("validateReelAudioInput requires a videoUrl", () => {
  assert.throws(() => validateReelAudioInput({}), /videoUrl/);
});

test("validateReelAudioInput requires at least one of voiceoverUrl/musicUrl", () => {
  assert.throws(() => validateReelAudioInput({ videoUrl: "https://example.com/v.mp4" }), /voiceoverUrl.*musicUrl/);
});

test("validateReelAudioInput accepts voiceoverUrl only, musicUrl only, or both", () => {
  assert.doesNotThrow(() => validateReelAudioInput({ videoUrl: "https://example.com/v.mp4", voiceoverUrl: "https://example.com/voice.wav" }));
  assert.doesNotThrow(() => validateReelAudioInput({ videoUrl: "https://example.com/v.mp4", musicUrl: "https://example.com/music.mp3" }));
  assert.doesNotThrow(() => validateReelAudioInput({ videoUrl: "https://example.com/v.mp4", voiceoverUrl: "https://example.com/voice.wav", musicUrl: "https://example.com/music.mp3" }));
});

test("validateReelAudioInput rejects a non-HTTPS videoUrl", () => {
  assert.throws(() => validateReelAudioInput({ videoUrl: "http://example.com/v.mp4", voiceoverUrl: "https://example.com/v.wav" }), /yalnızca HTTPS/);
});

test("validateReelAudioInput defaults musicVolume to 0.5 and rejects an out-of-range value", () => {
  const result = validateReelAudioInput({ videoUrl: "https://example.com/v.mp4", musicUrl: "https://example.com/m.mp3" });
  assert.equal(result.musicVolume, 0.5);
  assert.throws(() => validateReelAudioInput({ videoUrl: "https://example.com/v.mp4", musicUrl: "https://example.com/m.mp3", musicVolume: 1.5 }), /musicVolume/);
});

// compose_reel_audio ÜCRETSİZDİR (yalnızca FFmpeg) — compose_product_video'daki
// upscaleImages gibi bir confirmed şartı YOK.
test("composeReelAudio writes a queued job status, dispatches the workflow with the jobId, and returns jobId — no confirmed:true required", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: `https://blob.example.com/${path}` }; };
  let dispatchedBody = null;
  const fetchImpl = async (url, options) => { dispatchedBody = JSON.parse(options.body); return { status: 204 }; };
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    const result = await composeReelAudio(
      { videoUrl: "https://example.com/v.mp4", voiceoverUrl: "https://example.com/voice.wav", musicUrl: "https://example.com/music.mp3" },
      { putImpl, fetchImpl, randomUUIDImpl: () => "job-audio-1" }
    );
    assert.equal(result.jobId, "job-audio-1");
    assert.equal(result.status, "queued");
    assert.equal(putCalls[0].body.status, "queued");
    assert.equal(putCalls[0].body.payload.videoUrl, "https://example.com/v.mp4");
    assert.equal(dispatchedBody.inputs.jobId, "job-audio-1");
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("composeReelAudio throws and marks the job failed when GITHUB_DISPATCH_TOKEN is missing", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  delete process.env.GITHUB_DISPATCH_TOKEN;
  await assert.rejects(
    () => composeReelAudio({ videoUrl: "https://example.com/v.mp4", musicUrl: "https://example.com/m.mp3" }, { putImpl, randomUUIDImpl: () => "job-audio-2" }),
    /GITHUB_DISPATCH_TOKEN/
  );
  assert.equal(putCalls.at(-1).body.status, "failed");
});

test("composeReelAudio throws and marks the job failed when the GitHub API rejects the dispatch", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  const fetchImpl = async () => ({ status: 404, json: async () => ({ message: "Not Found" }) });
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    await assert.rejects(
      () => composeReelAudio({ videoUrl: "https://example.com/v.mp4", musicUrl: "https://example.com/m.mp3" }, { putImpl, fetchImpl, randomUUIDImpl: () => "job-audio-3" }),
      /workflow_dispatch başarısız/
    );
    assert.equal(putCalls.at(-1).body.status, "failed");
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("getReelAudioStatus returns an 'unknown' status for an unrecognized jobId, instead of throwing", async () => {
  const listImpl = async () => ({ blobs: [] });
  const result = await getReelAudioStatus("no-such-job", { listImpl });
  assert.equal(result.status, "unknown");
});

test("getReelAudioStatus requires a jobId", async () => {
  await assert.rejects(() => getReelAudioStatus(""), /jobId/);
});

test("getReelAudioStatus reads back the completed status written by the worker", async () => {
  const listImpl = async () => ({ blobs: [{ pathname: "video-jobs/job-audio-1.json", url: "https://blob.example.com/video-jobs/job-audio-1.json" }] });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ jobId: "job-audio-1", status: "completed", videoUrl: "https://blob.example.com/final.mp4", durationSeconds: 8.2, voiceoverIncluded: true, musicIncluded: true }) });
  const result = await getReelAudioStatus("job-audio-1", { listImpl, fetchImpl });
  assert.equal(result.status, "completed");
  assert.equal(result.videoUrl, "https://blob.example.com/final.mp4");
  assert.equal(result.voiceoverIncluded, true);
});
