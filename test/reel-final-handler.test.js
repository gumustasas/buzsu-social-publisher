import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/reel-final.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-reel-final-handler";

function sessionCookie(user = { id: "u1", username: "test", role: "Admin" }) {
  const headers = {};
  const fakeResponse = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeResponse, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest({ method = "POST", body, url = "/api/reel-final", authorized = true } = {}) {
  return { method, url, headers: authorized ? { cookie: sessionCookie() } : {}, body: body ? JSON.stringify(body) : undefined };
}

function makeResponse() {
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

test("reel-final handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler(makeRequest({ authorized: false, body: { sceneVideoUrls: [] } }), res);
  assert.equal(res.statusCode, 401);
});

test("reel-final handler: GET jobId eksikse 400 döner", async () => {
  const res = makeResponse();
  await handler(makeRequest({ method: "GET" }), res);
  assert.equal(res.statusCode, 400);
});

test("reel-final handler: sceneVideoUrls boşsa 500 döner (composeReelFinal doğrulaması)", async () => {
  const res = makeResponse();
  await handler(makeRequest({ body: { sceneVideoUrls: [], musicUrl: "https://example.com/m.mp3" } }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /sceneVideoUrls/);
});

test("reel-final handler: hem voiceoverUrl hem musicUrl eksikse 500 döner", async () => {
  const res = makeResponse();
  await handler(makeRequest({ body: { sceneVideoUrls: ["https://example.com/s.mp4"] } }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /voiceoverUrl/);
});
