import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/youtube-status.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-youtube-status-handler";

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
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

function withEnv(vars, run) {
  const originals = {};
  for (const key of Object.keys(vars)) { originals[key] = process.env[key]; if (vars[key] === undefined) delete process.env[key]; else process.env[key] = vars[key]; }
  return run().finally(() => {
    for (const key of Object.keys(vars)) { if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key]; }
  });
}

test("youtube-status handler: no session → 401", async () => {
  const res = makeResponse();
  await handler(makeRequest(), res);
  assert.equal(res.statusCode, 401);
});

test("youtube-status handler: env vars missing → configured:false, connected:false, no network call", async () => {
  await withEnv({ YOUTUBE_CLIENT_ID: undefined, YOUTUBE_CLIENT_SECRET: undefined, YOUTUBE_REFRESH_TOKEN: undefined }, async () => {
    const originalFetch = global.fetch;
    let called = false;
    global.fetch = async () => { called = true; throw new Error("must not be called"); };
    try {
      const res = makeResponse();
      await handler(makeRequest({ cookie: sessionCookie() }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.configured, false);
      assert.equal(res.payload.connected, false);
      assert.equal(called, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("youtube-status handler: env vars present + Google refresh succeeds → configured:true, connected:true", async () => {
  await withEnv({ YOUTUBE_CLIENT_ID: "id", YOUTUBE_CLIENT_SECRET: "secret", YOUTUBE_REFRESH_TOKEN: "refresh-token" }, async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ access_token: "access-123" }) });
    try {
      const res = makeResponse();
      await handler(makeRequest({ cookie: sessionCookie() }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.configured, true);
      assert.equal(res.payload.connected, true);
      assert.equal(res.payload.error, null);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("youtube-status handler: env vars present but Google returns invalid_grant (expired/revoked) → configured:true, connected:false, with the Google error surfaced but no secret leaked", async () => {
  await withEnv({ YOUTUBE_CLIENT_ID: "id", YOUTUBE_CLIENT_SECRET: "super-secret-value", YOUTUBE_REFRESH_TOKEN: "super-secret-refresh-token" }, async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) });
    try {
      const res = makeResponse();
      await handler(makeRequest({ cookie: sessionCookie() }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.configured, true);
      assert.equal(res.payload.connected, false);
      assert.match(res.payload.error, /Token has been expired or revoked/);
      const serialized = JSON.stringify(res.payload);
      assert.equal(serialized.includes("super-secret-value"), false);
      assert.equal(serialized.includes("super-secret-refresh-token"), false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
