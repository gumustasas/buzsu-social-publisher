import test from "node:test";
import assert from "node:assert/strict";
import { generateLyriaMusic } from "../src/lyria-music.js";

function mockInteractionsResponse(base64Data, mimeType = "audio/mpeg") {
  return {
    ok: true,
    json: async () => ({
      id: "v1_lyria_schema",
      steps: [{
        type: "model_output",
        content: [{ type: "audio", data: base64Data, mime_type: mimeType }]
      }]
    })
  };
}

test("Lyria Interactions request uses only supported audio response_format", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return mockInteractionsResponse(Buffer.from("audio").toString("base64"));
  };

  try {
    await generateLyriaMusic({
      scenario: "Buzsu reklam filmi",
      durationSeconds: 8,
      confirmed: true
    }, { GEMINI_API_KEY: "test" });

    assert.deepEqual(capturedBody.response_format, { type: "audio" });
    assert.equal("instrumental" in capturedBody.response_format, false);
    assert.equal("duration_seconds" in capturedBody.response_format, false);
    assert.match(capturedBody.input[0].text, /Instrumental only\. No vocals\./);
    assert.match(capturedBody.input[0].text, /approximately 8 seconds/i);
  } finally {
    global.fetch = originalFetch;
  }
});
