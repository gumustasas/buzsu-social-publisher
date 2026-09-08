import test from "node:test";
import assert from "node:assert/strict";
import { validateSceneImage, SCENE_VALIDATION_CHECKS } from "../src/lib/scene-validation.js";

const tinyBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("validateSceneImage skips (checked:false, needsReview:false) without throwing when GEMINI_API_KEY is missing", async () => {
  const result = await validateSceneImage(tinyBuffer, { productTitle: "Test" }, {});
  assert.equal(result.checked, false);
  assert.equal(result.needsReview, false);
  assert.deepEqual(result.failedChecks, []);
});

test("validateSceneImage never throws when the Gemini call itself fails — it is report-only and must not block scene generation", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("network down"); };
  try {
    const result = await validateSceneImage(tinyBuffer, { productTitle: "Test" }, { GEMINI_API_KEY: "key" });
    assert.equal(result.checked, false);
    assert.equal(result.needsReview, false);
    assert.match(result.notes, /Doğrulama başarısız/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSceneImage sets needsReview:true and surfaces failedChecks when Gemini reports a failed check", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: ["fabricated_signage"], notes: "Duvarda sahte bir tabela var." }) }] } }] })
  });
  try {
    const result = await validateSceneImage(tinyBuffer, { usageContext: "technical_installation", sceneDescription: "boru hattı", productTitle: "UltraMag" }, { GEMINI_API_KEY: "key" });
    assert.equal(result.checked, true);
    assert.equal(result.needsReview, true);
    assert.deepEqual(result.failedChecks, ["fabricated_signage"]);
    assert.equal(result.notes, "Duvarda sahte bir tabela var.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSceneImage returns needsReview:false with an empty failedChecks array when Gemini reports no issues", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: [], notes: "" }) }] } }] })
  });
  try {
    const result = await validateSceneImage(tinyBuffer, { productTitle: "UltraMag" }, { GEMINI_API_KEY: "key" });
    assert.equal(result.checked, true);
    assert.equal(result.needsReview, false);
    assert.deepEqual(result.failedChecks, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSceneImage drops any failedChecks entry that is not one of the known check codes (defends against a hallucinated/malformed model response)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: ["fabricated_signage", "made_up_check", 42], notes: "" }) }] } }] })
  });
  try {
    const result = await validateSceneImage(tinyBuffer, { productTitle: "UltraMag" }, { GEMINI_API_KEY: "key" });
    assert.deepEqual(result.failedChecks, ["fabricated_signage"]);
    assert.equal(result.needsReview, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSceneImage tolerates a non-JSON/malformed model response by treating it as no failed checks", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "not valid json" }] } }] })
  });
  try {
    const result = await validateSceneImage(tinyBuffer, { productTitle: "UltraMag" }, { GEMINI_API_KEY: "key" });
    assert.equal(result.checked, true);
    assert.equal(result.needsReview, false);
    assert.deepEqual(result.failedChecks, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("SCENE_VALIDATION_CHECKS exposes exactly the four agreed criteria: product identity, part integrity, context match, fabricated signage", () => {
  assert.deepEqual([...SCENE_VALIDATION_CHECKS].sort(), ["context_match", "fabricated_signage", "part_integrity", "product_identity"]);
});
