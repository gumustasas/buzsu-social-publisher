import test from "node:test";
import assert from "node:assert/strict";
import { validateComposeInput, composeProductVideo, getVideoRenderStatus } from "../src/video-compose.js";

const VALID_ITEM = (n) => ({ imageUrl: `https://example.com/p${n}.jpg`, title: `Ürün ${n}` });

test("validateComposeInput rejects fewer than 2 mediaItems", () => {
  assert.throws(() => validateComposeInput({ mediaItems: [VALID_ITEM(1)] }), /en az 2/);
});

test("validateComposeInput rejects more than 10 mediaItems", () => {
  const mediaItems = Array.from({ length: 11 }, (_, i) => VALID_ITEM(i));
  assert.throws(() => validateComposeInput({ mediaItems }), /en fazla 10/);
});

test("validateComposeInput accepts 2-10 mediaItems and applies defaults", () => {
  const result = validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)] });
  assert.equal(result.mediaItems.length, 2);
  assert.equal(result.durationPerImageSeconds, 1.8);
  assert.equal(result.transition, "fade");
  assert.equal(result.transitionDurationSeconds, 0.4);
  assert.equal(result.musicUrl, undefined);
  assert.equal(result.upscaleImages, false, "upscaleImages must default to false — a paid step must never trigger silently");
});

test("validateComposeInput passes through upscaleImages:true", () => {
  const result = validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], upscaleImages: true });
  assert.equal(result.upscaleImages, true);
});

test("validateComposeInput rejects a non-HTTPS imageUrl", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [{ imageUrl: "http://example.com/p1.jpg" }, VALID_ITEM(2)] }),
    /yalnızca HTTPS/
  );
});

test("validateComposeInput rejects a malformed imageUrl", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [{ imageUrl: "not-a-url" }, VALID_ITEM(2)] }),
    /geçerli bir URL değil/
  );
});

test("validateComposeInput rejects an out-of-range durationPerImageSeconds", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], durationPerImageSeconds: 5 }),
    /durationPerImageSeconds/
  );
});

test("validateComposeInput rejects an unknown transition", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], transition: "spin" }),
    /transition/
  );
});

test("validateComposeInput rejects transitionDurationSeconds >= durationPerImageSeconds", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], durationPerImageSeconds: 1.2, transitionDurationSeconds: 1.2 }),
    /transitionDurationSeconds/
  );
});

test("validateComposeInput rejects a title longer than 60 characters", () => {
  const longTitle = "x".repeat(61);
  assert.throws(
    () => validateComposeInput({ mediaItems: [{ imageUrl: "https://example.com/p1.jpg", title: longTitle }, VALID_ITEM(2)] }),
    /en fazla 60 karakter/
  );
});

test("validateComposeInput rejects a non-HTTPS musicUrl but accepts a valid one with default volume", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], musicUrl: "http://example.com/song.mp3" }),
    /musicUrl/
  );
  const result = validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], musicUrl: "https://example.com/song.mp3" });
  assert.equal(result.musicUrl, "https://example.com/song.mp3");
  assert.equal(result.musicVolume, 0.5);
});

test("validateComposeInput rejects musicVolume outside 0-1", () => {
  assert.throws(
    () => validateComposeInput({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], musicUrl: "https://example.com/song.mp3", musicVolume: 1.5 }),
    /musicVolume/
  );
});

test("composeProductVideo writes a queued job status, dispatches the workflow with the jobId, and returns jobId", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: `https://blob.example.com/${path}` }; };
  let dispatchedBody, dispatchedUrl;
  const fetchImpl = async (url, options) => {
    dispatchedUrl = url; dispatchedBody = JSON.parse(options.body);
    return { status: 204 };
  };
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    const result = await composeProductVideo(
      { mediaItems: [VALID_ITEM(1), VALID_ITEM(2)] },
      { putImpl, fetchImpl, randomUUIDImpl: () => "job-123" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.jobId, "job-123");
    assert.equal(result.status, "queued");
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].path, "video-jobs/job-123.json");
    assert.equal(putCalls[0].body.status, "queued");
    assert.equal(putCalls[0].body.payload.mediaItems.length, 2);
    assert.match(dispatchedUrl, /\/actions\/workflows\/render-product-video\.yml\/dispatches$/);
    assert.equal(dispatchedBody.inputs.jobId, "job-123");
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("composeProductVideo throws and marks the job failed when GITHUB_DISPATCH_TOKEN is missing", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  delete process.env.GITHUB_DISPATCH_TOKEN;
  await assert.rejects(
    () => composeProductVideo({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)] }, { putImpl, randomUUIDImpl: () => "job-456" }),
    /GITHUB_DISPATCH_TOKEN/
  );
  assert.equal(putCalls.length, 2);
  assert.equal(putCalls[0].body.status, "queued");
  assert.equal(putCalls[1].body.status, "failed");
  assert.equal(putCalls[1].options.allowOverwrite, true);
});

test("composeProductVideo throws and marks the job failed when the GitHub API rejects the dispatch", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  const fetchImpl = async () => ({ status: 404, json: async () => ({ message: "Not Found" }) });
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    await assert.rejects(
      () => composeProductVideo({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)] }, { putImpl, fetchImpl, randomUUIDImpl: () => "job-789" }),
      /workflow_dispatch başarısız/
    );
    assert.equal(putCalls[1].body.status, "failed");
    assert.match(putCalls[1].body.error, /Not Found|404/);
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("composeProductVideo throws before dispatching/writing any job when upscaleImages:true is sent without confirmed:true", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  const fetchImpl = async () => { throw new Error("dispatchRenderWorkflow must not be called"); };
  await assert.rejects(
    () => composeProductVideo({ mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], upscaleImages: true }, { putImpl, fetchImpl, randomUUIDImpl: () => "job-999" }),
    /confirmed:true/
  );
  assert.equal(putCalls.length, 0, "no job record should be written when the paid opt-in is rejected");
});

test("composeProductVideo proceeds when upscaleImages:true is paired with confirmed:true", async () => {
  const putCalls = [];
  const putImpl = async (path, body, options) => { putCalls.push({ path, body: JSON.parse(body), options }); return { url: "https://blob.example.com/x" }; };
  const fetchImpl = async () => ({ status: 204 });
  process.env.GITHUB_DISPATCH_TOKEN = "test-token";
  try {
    const result = await composeProductVideo(
      { mediaItems: [VALID_ITEM(1), VALID_ITEM(2)], upscaleImages: true, confirmed: true },
      { putImpl, fetchImpl, randomUUIDImpl: () => "job-999" }
    );
    assert.equal(result.ok, true);
    assert.equal(putCalls[0].body.payload.upscaleImages, true);
  } finally {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  }
});

test("getVideoRenderStatus requires a jobId", async () => {
  await assert.rejects(() => getVideoRenderStatus(""), /jobId gereklidir/);
});

test("getVideoRenderStatus returns status:'unknown' when no job record exists", async () => {
  const listImpl = async () => ({ blobs: [] });
  const result = await getVideoRenderStatus("missing-job", { listImpl });
  assert.equal(result.status, "unknown");
});

test("getVideoRenderStatus returns the stored job status when found", async () => {
  const listImpl = async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: "https://blob.example.com/video-jobs/job-1.json" }] });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ jobId: "job-1", status: "completed", videoUrl: "https://blob.example.com/v.mp4", durationSeconds: 8.2, width: 1080, height: 1920, fileSizeBytes: 4200000 }) });
  const result = await getVideoRenderStatus("job-1", { listImpl, fetchImpl });
  assert.equal(result.status, "completed");
  assert.equal(result.videoUrl, "https://blob.example.com/v.mp4");
  assert.equal(result.width, 1080);
});
