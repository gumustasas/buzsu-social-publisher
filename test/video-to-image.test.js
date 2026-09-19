import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIDEO_TO_IMAGE_MODEL, VIDEO_TO_IMAGE_MODELS, generateImageFromVideo, isPublicYouTubeUrl } from "../src/video-to-image/index.js";

const imageResponse = () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }) });

test("YouTube direct input detection", () => {
  assert.equal(isPublicYouTubeUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isPublicYouTubeUrl("https://youtu.be/abc"), true);
  assert.equal(isPublicYouTubeUrl("https://www.youtube.com/shorts/abc"), true);
  assert.equal(isPublicYouTubeUrl("https://example.com/demo.mp4"), false);
});

test("confirmed:true is required before any network/discovery", async () => {
  let called = false;
  await assert.rejects(() => generateImageFromVideo(
    { videoUrl: "https://youtu.be/abc", prompt: "poster" },
    { GEMINI_API_KEY: "key" },
    { fetchImpl: async () => { called = true; throw new Error("no"); } }
  ), /confirmed:true/);
  assert.equal(called, false);
});

test("public YouTube URL is passed directly to Gemini", async () => {
  let body, downloaded = false;
  const result = await generateImageFromVideo(
    { videoUrl: "https://www.youtube.com/watch?v=abc", prompt: "poster", aspectRatio: "16:9", confirmed: true },
    { GEMINI_API_KEY: "key" },
    {
      listGeminiModelsImpl: async () => new Set(VIDEO_TO_IMAGE_MODELS),
      fetchPublicVideoImpl: async () => { downloaded = true; throw new Error("no"); },
      fetchImpl: async (url, options) => { body = JSON.parse(options.body); return imageResponse(); }
    }
  );
  assert.equal(downloaded, false);
  assert.equal(result.inputMethod, "youtube-url");
  assert.equal(result.model, DEFAULT_VIDEO_TO_IMAGE_MODEL);
  assert.equal(body.contents[0].parts[0].fileData.fileUri, "https://www.youtube.com/watch?v=abc");
  assert.equal(body.contents[0].parts[0].videoMetadata.fps, 0.5);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
});

test("non-YouTube URL is SSRF-safe fetched then uploaded through Files API", async () => {
  let downloads = 0;
  const result = await generateImageFromVideo(
    { videoUrl: "https://cdn.example.com/demo.mp4", prompt: "story cover", model: "gemini-3.1-flash-lite-image", confirmed: true },
    { GEMINI_API_KEY: "key" },
    {
      listGeminiModelsImpl: async () => new Set(VIDEO_TO_IMAGE_MODELS),
      fetchPublicVideoImpl: async () => { downloads++; return { buffer: Buffer.from("video"), mimeType: "video/mp4" }; },
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/upload/v1beta/files")) return { ok: true, headers: { get: (n) => n.toLowerCase() === "x-goog-upload-url" ? "https://upload.example/session" : null }, json: async () => ({}) };
        if (u === "https://upload.example/session") return { ok: true, json: async () => ({ file: { name: "files/v1", uri: "https://generativelanguage.googleapis.com/v1beta/files/v1", mimeType: "video/mp4", state: "PROCESSING" } }) };
        if (u.endsWith("/v1beta/files/v1")) return { ok: true, json: async () => ({ name: "files/v1", uri: "https://generativelanguage.googleapis.com/v1beta/files/v1", mimeType: "video/mp4", state: "ACTIVE" }) };
        if (u.includes(":generateContent")) return imageResponse();
        throw new Error("unexpected " + u);
      }
    }
  );
  assert.equal(downloads, 1);
  assert.equal(result.inputMethod, "files-api");
  assert.equal(result.model, "gemini-3.1-flash-lite-image");
});

test("unsupported model is rejected without silent fallback", async () => {
  await assert.rejects(() => generateImageFromVideo(
    { videoUrl: "https://youtu.be/abc", prompt: "poster", model: "gemini-3-pro-image", confirmed: true },
    { GEMINI_API_KEY: "key" },
    { listGeminiModelsImpl: async () => new Set(["gemini-3-pro-image"]) }
  ), /yalnız şu modellerde desteklenir/);
});

test("discovery-gated supported model cannot silently fall back", async () => {
  await assert.rejects(() => generateImageFromVideo(
    { videoUrl: "https://youtu.be/abc", prompt: "poster", model: DEFAULT_VIDEO_TO_IMAGE_MODEL, confirmed: true },
    { GEMINI_API_KEY: "key" },
    { listGeminiModelsImpl: async () => new Set(["gemini-3.1-flash-lite-image"]) }
  ), /discovery sonucunda bulunamadı/);
});
