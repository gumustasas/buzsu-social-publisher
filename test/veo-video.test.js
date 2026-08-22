import test from "node:test";
import assert from "node:assert/strict";
import { veoModel, submitVeoVideo, veoVideoStatus } from "../src/veo-video.js";

test("veoModel defaults to veo-3.1-fast-generate-preview and respects VEO_VIDEO_MODEL override", () => {
  assert.equal(veoModel({}), "veo-3.1-fast-generate-preview");
  assert.equal(veoModel({ VEO_VIDEO_MODEL: "veo-3.1-generate-preview" }), "veo-3.1-generate-preview");
});

test("submitVeoVideo rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => submitVeoVideo({ title: "Code Advantage", imageUrl: "https://example.com/x.jpg" }, {}),
    /GEMINI_API_KEY/
  );
});

test("submitVeoVideo rejects a non-HTTPS product image URL", async () => {
  await assert.rejects(
    () => submitVeoVideo({ title: "Code Advantage", imageUrl: "not-a-url" }, { GEMINI_API_KEY: "test" }),
    /HTTPS/
  );
});

test("veoVideoStatus rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => veoVideoStatus({ operationName: "operations/1" }, {}),
    /GEMINI_API_KEY/
  );
});

test("veoVideoStatus rejects when job has no operationName", async () => {
  await assert.rejects(
    () => veoVideoStatus({}, { GEMINI_API_KEY: "test" }),
    /iş bilgisi eksik/
  );
});
