import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { publishTweet } from "../src/x-publish.js";

const ENV = { X_CONSUMER_KEY: "consumer-key", X_CONSUMER_SECRET: "consumer-secret", X_ACCESS_TOKEN: "access-token", X_ACCESS_TOKEN_SECRET: "access-secret" };

function parseOAuthHeader(header) {
  const params = {};
  for (const part of header.replace(/^OAuth /, "").split(", ")) {
    const [key, value] = part.split("=");
    params[key] = decodeURIComponent(value.slice(1, -1));
  }
  return params;
}

function expectedSignature(method, url, oauthParams, consumerSecret, tokenSecret) {
  const encode = (v) => encodeURIComponent(v).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const baseString = [method, encode(url), encode(Object.keys(oauthParams).sort().map((k) => `${encode(k)}=${encode(oauthParams[k])}`).join("&"))].join("&");
  const signingKey = `${encode(consumerSecret)}&${encode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

test("publishTweet rejects when X env vars are missing, before any network call", async () => {
  await assert.rejects(() => publishTweet({ text: "merhaba" }, {}), /X için eksik ortam değişkenleri/);
});

test("publishTweet rejects empty text", async () => {
  await assert.rejects(() => publishTweet({ text: "  " }, ENV), /X metni boş/);
});

test("publishTweet posts text-only when no imageUrl is given, with a correctly signed OAuth 1.0a header", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ data: { id: "tweet_123" } }) };
  };
  try {
    const id = await publishTweet({ text: "merhaba dünya" }, ENV);
    assert.equal(id, "tweet_123");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.x.com/2/tweets");
    assert.deepEqual(JSON.parse(calls[0].options.body), { text: "merhaba dünya" });
    const oauth = parseOAuthHeader(calls[0].options.headers.Authorization);
    assert.equal(oauth.oauth_consumer_key, "consumer-key");
    assert.equal(oauth.oauth_token, "access-token");
    const signature = oauth.oauth_signature;
    delete oauth.oauth_signature;
    assert.equal(signature, expectedSignature("POST", "https://api.x.com/2/tweets", oauth, ENV.X_CONSUMER_SECRET, ENV.X_ACCESS_TOKEN_SECRET));
  } finally {
    global.fetch = originalFetch;
  }
});

test("publishTweet uploads the image first (multipart, not counted in the OAuth signature) then posts the tweet with media_ids", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://example.com/scene.jpg") return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    if (url === "https://upload.twitter.com/1.1/media/upload.json") return { ok: true, json: async () => ({ media_id_string: "media_456" }) };
    return { ok: true, json: async () => ({ data: { id: "tweet_789" } }) };
  };
  try {
    const id = await publishTweet({ text: "sahne", imageUrl: "https://example.com/scene.jpg" }, ENV);
    assert.equal(id, "tweet_789");
    assert.equal(calls.length, 3);
    assert.ok(calls[1].options.body instanceof FormData, "medya multipart/form-data ile gönderilmeli");
    assert.deepEqual(JSON.parse(calls[2].options.body), { text: "sahne", media: { media_ids: ["media_456"] } });
  } finally {
    global.fetch = originalFetch;
  }
});

test("publishTweet surfaces the X API error message when the tweet request fails", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ detail: "Forbidden: write scope missing" }) });
  try {
    await assert.rejects(() => publishTweet({ text: "merhaba" }, ENV), /Forbidden: write scope missing/);
  } finally {
    global.fetch = originalFetch;
  }
});
