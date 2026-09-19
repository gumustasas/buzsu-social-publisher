import test from "node:test";
import assert from "node:assert/strict";
import { compareProductVisuals } from "../src/visual-validation/gemini-compare.js";

const referenceBuffer = Buffer.from("reference-bytes");
const generatedBuffer = Buffer.from("generated-bytes");

test("compareProductVisuals: GEMINI_API_KEY yoksa hiçbir fetch atmadan hata fırlatır", async () => {
  let called = false;
  await assert.rejects(
    () => compareProductVisuals(
      { referenceBuffer, referenceMimeType: "image/png", generatedBuffer, generatedMimeType: "image/png" },
      {},
      { fetchImpl: async () => { called = true; throw new Error("çağrılmamalıydı"); } }
    ),
    /GEMINI_API_KEY/
  );
  assert.equal(called, false);
});

test("compareProductVisuals: iki görseli de inlineData olarak (referans önce, üretilen sonra) gönderir", async () => {
  let seenBody, seenHeaders;
  const result = await compareProductVisuals(
    { referenceBuffer, referenceMimeType: "image/png", generatedBuffer, generatedMimeType: "image/jpeg", productTitle: "UltraMag" },
    { GEMINI_API_KEY: "gkey" },
    {
      fetchImpl: async (url, options) => {
        seenHeaders = options.headers; seenBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: ["logo"], notes: "Logo farklı." }) }] } }] }) };
      }
    }
  );
  assert.equal(seenHeaders["x-goog-api-key"], "gkey");
  const parts = seenBody.contents[0].parts;
  assert.equal(parts[1].inlineData.mimeType, "image/png");
  assert.equal(parts[1].inlineData.data, referenceBuffer.toString("base64"));
  assert.equal(parts[2].inlineData.mimeType, "image/jpeg");
  assert.equal(parts[2].inlineData.data, generatedBuffer.toString("base64"));
  assert.deepEqual(result.failedChecks, ["logo"]);
  assert.equal(result.notes, "Logo farklı.");
});

test("compareProductVisuals: GEMINI_VISUAL_VALIDATION_MODEL override edilebilir", async () => {
  let seenUrl;
  await compareProductVisuals(
    { referenceBuffer, referenceMimeType: "image/png", generatedBuffer, generatedMimeType: "image/png" },
    { GEMINI_API_KEY: "gkey", GEMINI_VISUAL_VALIDATION_MODEL: "gemini-custom-model" },
    { fetchImpl: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) }; } }
  );
  assert.match(seenUrl, /models\/gemini-custom-model:generateContent/);
});

test("compareProductVisuals: HTTP hatası açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => compareProductVisuals(
      { referenceBuffer, referenceMimeType: "image/png", generatedBuffer, generatedMimeType: "image/png" },
      { GEMINI_API_KEY: "gkey" },
      { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota exceeded" } }) }) }
    ),
    /quota exceeded/
  );
});

test("compareProductVisuals: bozuk/JSON-olmayan bir yanıtı onarmaya çalışmadan 'hiçbir kontrol başarısız değil' gibi ele alır", async () => {
  const result = await compareProductVisuals(
    { referenceBuffer, referenceMimeType: "image/png", generatedBuffer, generatedMimeType: "image/png" },
    { GEMINI_API_KEY: "gkey" },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "bu json değil" }] } }] }) }) }
  );
  assert.deepEqual(result.failedChecks, []);
  assert.equal(result.notes, "");
});
