import test from "node:test";
import assert from "node:assert/strict";
import { generateLyriaMusic, lyriaMusicStatus, buildLyriaPrompt, LyriaApiError, LYRIA_MODELS } from "../src/lyria-music.js";

function mockInteractionsResponse(base64Data, mimeType = "audio/mpeg") {
  return { ok: true, json: async () => ({ id: "v1_lyria_xyz", steps: [{ type: "model_output", content: [{ type: "audio", data: base64Data, mime_type: mimeType }] }] }) };
}

test("buildLyriaPrompt uses musicBrief.description verbatim (appending the instrumental clause only if missing)", () => {
  const withInstrumental = buildLyriaPrompt("scenario", { description: "Warm soundtrack. Instrumental only. No vocals." });
  assert.equal(withInstrumental, "Warm soundtrack. Instrumental only. No vocals.");
  const withoutInstrumental = buildLyriaPrompt("scenario", { description: "Warm soundtrack." });
  assert.match(withoutInstrumental, /Instrumental only\. No vocals\.$/);
});

test("buildLyriaPrompt derives a prompt from scenario + mood/energy/tempo when no description is given", () => {
  const prompt = buildLyriaPrompt("Modern mutfakta Buzsu Code Advantage ile temiz su hazırlanıyor.", { mood: "sıcak aile", energy: "orta", tempo: "orta" });
  assert.match(prompt, /Modern mutfakta Buzsu Code Advantage/);
  assert.match(prompt, /mood: sıcak aile/);
  assert.match(prompt, /Instrumental only\. No vocals\.$/);
});

test("generateLyriaMusic rejects without confirmed:true, before any network call", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(
      () => generateLyriaMusic({ scenario: "test", confirmed: false }, { GEMINI_API_KEY: "test" }),
      /confirmed:true/
    );
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic rejects when GEMINI_API_KEY is missing", async () => {
  await assert.rejects(() => generateLyriaMusic({ scenario: "test", confirmed: true }, {}), /GEMINI_API_KEY/);
});

test("generateLyriaMusic rejects an unsupported tier", async () => {
  await assert.rejects(
    () => generateLyriaMusic({ scenario: "test", tier: "ultra", confirmed: true }, { GEMINI_API_KEY: "test" }),
    /tier/
  );
});

test("generateLyriaMusic rejects when neither scenario nor musicPrompt is given", async () => {
  await assert.rejects(
    () => generateLyriaMusic({ confirmed: true }, { GEMINI_API_KEY: "test" }),
    /scenario.*musicPrompt/
  );
});

test("generateLyriaMusic does NOT require the user to supply a musicPrompt — it auto-derives one from scenario", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => { capturedBody = JSON.parse(options.body); return mockInteractionsResponse(Buffer.from("audio").toString("base64")); };
  try {
    const result = await generateLyriaMusic({ scenario: "Modern mutfakta su arıtma reklamı", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(capturedBody.model, LYRIA_MODELS.clip);
    assert.match(capturedBody.input[0].text, /Modern mutfakta su arıtma reklamı/);
    assert.match(result.generatedPrompt, /Instrumental only/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic uses the Pro model when tier:'pro' is given", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => { capturedBody = JSON.parse(options.body); return mockInteractionsResponse(Buffer.from("audio").toString("base64")); };
  try {
    await generateLyriaMusic({ scenario: "test", tier: "pro", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(capturedBody.model, LYRIA_MODELS.pro);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic always appends the instrumental-only clause even to a user-supplied musicPrompt", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => { capturedBody = JSON.parse(options.body); return mockInteractionsResponse(Buffer.from("audio").toString("base64")); };
  try {
    await generateLyriaMusic({ musicPrompt: "Upbeat corporate track", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.match(capturedBody.input[0].text, /Instrumental only\. No vocals\./);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic returns COMPLETED with the decoded audio buffer", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockInteractionsResponse(Buffer.from("fake-mp3-bytes").toString("base64"));
  try {
    const result = await generateLyriaMusic({ scenario: "test", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.audioBuffer.toString(), "fake-mp3-bytes");
    assert.equal(result.tier, "clip");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic returns IN_PROGRESS when no model_output step exists yet", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "v1_lyria_xyz", steps: [] }) });
  try {
    const result = await generateLyriaMusic({ scenario: "test", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(result.status, "IN_PROGRESS");
    assert.equal(result.interactionId, "v1_lyria_xyz");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic classifies HTTP 429 as LyriaApiError with code RATE_LIMITED, and never retries automatically", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => { callCount++; return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) }; };
  try {
    const error = await generateLyriaMusic({ scenario: "test", confirmed: true }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.ok(error instanceof LyriaApiError);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateLyriaMusic: a 500 stays a plain Error, not misclassified (regression guard)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({ error: { message: "boom" } }) });
  try {
    const error = await generateLyriaMusic({ scenario: "test", confirmed: true }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.equal(error.code, undefined);
    assert.equal(error.message, "boom");
  } finally {
    global.fetch = originalFetch;
  }
});

test("lyriaMusicStatus polls GET /interactions/{id} and returns COMPLETED once ready", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => { requestedUrl = String(url); return mockInteractionsResponse(Buffer.from("bytes").toString("base64")); };
  try {
    const result = await lyriaMusicStatus({ interactionId: "v1_lyria_xyz", model: LYRIA_MODELS.clip }, { GEMINI_API_KEY: "test" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/interactions/v1_lyria_xyz");
    assert.equal(result.status, "COMPLETED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("lyriaMusicStatus rejects when job has no interactionId", async () => {
  await assert.rejects(() => lyriaMusicStatus({}, { GEMINI_API_KEY: "test" }), /iş bilgisi eksik/);
});
