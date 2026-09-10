import test from "node:test";
import assert from "node:assert/strict";
import { upscaleImage } from "../src/lib/image-upscale.js";

const SAMPLE_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test("upscaleImage throws before any network call when no API token is configured", async () => {
  let called = false;
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "", fetchImpl: async () => { called = true; } }),
    /REPLICATE_API_TOKEN/
  );
  assert.equal(called, false, "fetchImpl must not be invoked without a token");
});

test("upscaleImage throws for an empty/invalid buffer without calling the network", async () => {
  let called = false;
  await assert.rejects(
    () => upscaleImage(Buffer.alloc(0), "image/png", { apiToken: "tok", fetchImpl: async () => { called = true; } }),
    /arabelleği/
  );
  assert.equal(called, false);
});

test("upscaleImage returns the output URL for a synchronous 'succeeded' response (Prefer: wait path)", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ status: "succeeded", output: "https://replicate.delivery/out.png" });
  };
  const result = await upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "tok", fetchImpl });
  assert.equal(result, "https://replicate.delivery/out.png");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.replicate\.com\/v1\/models\/nightmareai\/real-esrgan\/predictions$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].options.headers.Prefer, "wait=30");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.input.scale, 4);
  assert.equal(body.input.face_enhance, false);
  assert.match(body.input.image, /^data:image\/png;base64,/);
});

test("upscaleImage returns the first URL when output is an array", async () => {
  const fetchImpl = async () => jsonResponse({ status: "succeeded", output: ["https://replicate.delivery/a.png", "https://replicate.delivery/b.png"] });
  const result = await upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "tok", fetchImpl });
  assert.equal(result, "https://replicate.delivery/a.png");
});

test("upscaleImage polls urls.get until a terminal status is reached", async () => {
  let pollCount = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/predictions")) {
      return jsonResponse({ status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/abc" } });
    }
    pollCount += 1;
    if (pollCount < 3) return jsonResponse({ status: "processing", urls: { get: "https://api.replicate.com/v1/predictions/abc" } });
    return jsonResponse({ status: "succeeded", output: "https://replicate.delivery/done.png" });
  };
  const result = await upscaleImage(SAMPLE_BUFFER, "image/png", {
    apiToken: "tok",
    fetchImpl,
    sleepImpl: async () => {}
  });
  assert.equal(result, "https://replicate.delivery/done.png");
  assert.equal(pollCount, 3);
});

test("upscaleImage throws with the failure reason when the prediction ends in 'failed'", async () => {
  const fetchImpl = async () => jsonResponse({ status: "failed", error: "NSFW content detected" });
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "tok", fetchImpl }),
    /NSFW content detected/
  );
});

test("upscaleImage throws on a non-OK HTTP response, including any detail message", async () => {
  const fetchImpl = async () => jsonResponse({ detail: "Invalid token." }, { ok: false, status: 401 });
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "bad-tok", fetchImpl }),
    /HTTP 401.*Invalid token\./s
  );
});

test("upscaleImage retries a 429 rate-limit response, waiting the seconds Replicate reports, then succeeds", async () => {
  let attempts = 0;
  const sleepCalls = [];
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) {
      return jsonResponse(
        { detail: "Request was throttled. Your rate limit for creating predictions is reduced to 6 requests per minute with a burst of 1 requests while you have less than $5.0 in credit. Your rate limit resets in ~7s." },
        { ok: false, status: 429 }
      );
    }
    return jsonResponse({ status: "succeeded", output: "https://replicate.delivery/retried.png" });
  };
  const result = await upscaleImage(SAMPLE_BUFFER, "image/png", {
    apiToken: "tok",
    fetchImpl,
    sleepImpl: async (ms) => { sleepCalls.push(ms); }
  });
  assert.equal(result, "https://replicate.delivery/retried.png");
  assert.equal(attempts, 2, "must retry the POST after the 429, not give up immediately");
  assert.deepEqual(sleepCalls, [7000], "must wait the ~7s Replicate reported before retrying");
});

test("upscaleImage falls back to a default wait when the 429 detail has no parseable reset time", async () => {
  let attempts = 0;
  const sleepCalls = [];
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return jsonResponse({ detail: "Request was throttled." }, { ok: false, status: 429 });
    return jsonResponse({ status: "succeeded", output: "https://replicate.delivery/retried.png" });
  };
  await upscaleImage(SAMPLE_BUFFER, "image/png", {
    apiToken: "tok",
    fetchImpl,
    sleepImpl: async (ms) => { sleepCalls.push(ms); }
  });
  assert.deepEqual(sleepCalls, [5000]);
});

test("upscaleImage gives up after exhausting rate-limit retries and throws the 429 detail", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return jsonResponse({ detail: "Your rate limit resets in ~7s." }, { ok: false, status: 429 });
  };
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", {
      apiToken: "tok",
      fetchImpl,
      sleepImpl: async () => {},
      maxRateLimitRetries: 1
    }),
    /HTTP 429.*resets in ~7s/s
  );
  assert.equal(attempts, 2, "1 initial attempt + 1 retry, then give up");
});

test("upscaleImage throws if a non-terminal prediction has no poll URL", async () => {
  const fetchImpl = async () => jsonResponse({ status: "starting" });
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "tok", fetchImpl, sleepImpl: async () => {} }),
    /poll URL/
  );
});

test("upscaleImage throws on timeout when polling never reaches a terminal status", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/predictions")) {
      return jsonResponse({ status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/abc" } });
    }
    return jsonResponse({ status: "processing", urls: { get: "https://api.replicate.com/v1/predictions/abc" } });
  };
  let simulatedNow = 0;
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", {
      apiToken: "tok",
      fetchImpl,
      sleepImpl: async () => { simulatedNow += 10000; },
      nowImpl: () => simulatedNow,
      timeoutMs: 15000,
      pollIntervalMs: 10000
    }),
    /zaman aşımına/
  );
});

test("upscaleImage throws when the succeeded response has no output URL", async () => {
  const fetchImpl = async () => jsonResponse({ status: "succeeded", output: null });
  await assert.rejects(
    () => upscaleImage(SAMPLE_BUFFER, "image/png", { apiToken: "tok", fetchImpl }),
    /çıktı URL/
  );
});
