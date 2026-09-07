import test from "node:test";
import assert from "node:assert/strict";
import { uploadShort } from "../src/youtube-publish.js";

const ENV = { YOUTUBE_CLIENT_ID: "client-id", YOUTUBE_CLIENT_SECRET: "client-secret", YOUTUBE_REFRESH_TOKEN: "refresh-token" };

function fakeResponse({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  return { ok, status, json: async () => json, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

test("uploadShort rejects when YouTube env vars are missing, before any network call", async () => {
  await assert.rejects(() => uploadShort({ title: "Test", videoUrl: "https://example.com/v.mp4" }, {}), /YouTube için eksik ortam değişkenleri/);
});

test("uploadShort rejects a non-HTTPS video URL", async () => {
  await assert.rejects(() => uploadShort({ title: "Test", videoUrl: "not-a-url" }, ENV), /HTTPS/);
});

test("uploadShort rejects an empty title", async () => {
  await assert.rejects(() => uploadShort({ title: "  ", videoUrl: "https://example.com/v.mp4" }, ENV), /başlığı boş/);
});

test("uploadShort refreshes the access token, opens a resumable session, then PUTs the video bytes", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://example.com/v.mp4") return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    if (String(url) === "https://oauth2.googleapis.com/token") return fakeResponse({ json: { access_token: "access-123" } });
    if (String(url).startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) return fakeResponse({ headers: { location: "https://upload.example.com/session-xyz" } });
    if (String(url) === "https://upload.example.com/session-xyz") return fakeResponse({ json: { id: "yt_video_1" } });
    throw new Error(`beklenmeyen istek: ${url}`);
  };
  try {
    const id = await uploadShort({ title: "Ürün #Shorts", description: "açıklama", videoUrl: "https://example.com/v.mp4", tags: ["buzsu"] }, ENV);
    assert.equal(id, "yt_video_1");
    assert.equal(calls.length, 4);

    const tokenCall = calls.find((c) => c.url === "https://oauth2.googleapis.com/token");
    const tokenBody = new URLSearchParams(tokenCall.options.body);
    assert.equal(tokenBody.get("refresh_token"), "refresh-token");
    assert.equal(tokenBody.get("grant_type"), "refresh_token");

    const initCall = calls.find((c) => c.url.startsWith("https://www.googleapis.com/upload"));
    assert.equal(initCall.options.headers.Authorization, "Bearer access-123");
    assert.equal(initCall.options.headers["X-Upload-Content-Length"], "4");
    const initBody = JSON.parse(initCall.options.body);
    assert.equal(initBody.snippet.title, "Ürün #Shorts");
    assert.equal(initBody.status.privacyStatus, "public");

    const putCall = calls.find((c) => c.url === "https://upload.example.com/session-xyz");
    assert.equal(putCall.options.method, "PUT");
    assert.equal(putCall.options.body.length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test("uploadShort surfaces the YouTube API error message when the upload session cannot be opened", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url) === "https://example.com/v.mp4") return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    if (String(url) === "https://oauth2.googleapis.com/token") return fakeResponse({ json: { access_token: "access-123" } });
    return fakeResponse({ ok: false, status: 403, json: { error: { message: "The user is not enabled for live streaming." } } });
  };
  try {
    await assert.rejects(() => uploadShort({ title: "Test", videoUrl: "https://example.com/v.mp4" }, ENV), /not enabled for live streaming/);
  } finally {
    global.fetch = originalFetch;
  }
});
