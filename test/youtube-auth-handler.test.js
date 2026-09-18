import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/youtube-auth.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-youtube-auth-handler";

function sessionCookie(user = { id: "u1", username: "test", role: "Admin" }) {
  const headers = {};
  const fakeResponse = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeResponse, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest({ cookie } = {}) {
  return { method: "GET", headers: cookie ? { cookie } : {} };
}

function makeResponse() {
  const res = { statusCode: null, headers: {}, body: null, ended: false };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.writeHead = (code, headers = {}) => { res.statusCode = code; Object.assign(res.headers, headers); return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

test("youtube-auth handler: no session → 401, never redirects to Google", async () => {
  const res = makeResponse();
  await handler(makeRequest(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers.Location, undefined);
});

test("youtube-auth handler: session present but YOUTUBE_CLIENT_ID missing → 400, never redirects", async () => {
  const original = process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_CLIENT_ID;
  try {
    const res = makeResponse();
    await handler(makeRequest({ cookie: sessionCookie() }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers.Location, undefined);
  } finally {
    if (original !== undefined) process.env.YOUTUBE_CLIENT_ID = original;
  }
});

test("youtube-auth handler: authorized + configured → 302 redirect to Google with access_type=offline, prompt=consent, the upload scope, and the exact callback redirect_uri", async () => {
  process.env.YOUTUBE_CLIENT_ID = "test-client-id";
  process.env.YOUTUBE_CLIENT_SECRET = "test-client-secret";
  const res = makeResponse();
  await handler(makeRequest({ cookie: sessionCookie() }), res);
  assert.equal(res.statusCode, 302);
  assert.ok(res.ended);
  const location = new URL(res.headers.Location);
  assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(location.searchParams.get("client_id"), "test-client-id");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("access_type"), "offline");
  assert.equal(location.searchParams.get("prompt"), "consent");
  assert.equal(location.searchParams.get("scope"), "https://www.googleapis.com/auth/youtube.upload");
  assert.equal(location.searchParams.get("redirect_uri"), "https://buzsu-social-publisher.vercel.app/api/youtube-callback");
  // client_secret'in bu URL'de HİÇ görünmemesi gerekir — yalnızca callback
  // aşamasında (sunucu-sunucu POST) kullanılır, tarayıcıya asla gitmez.
  assert.equal(location.searchParams.has("client_secret"), false);
});
