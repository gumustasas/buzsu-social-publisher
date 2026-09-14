import test from "node:test";
import assert from "node:assert";
import handler from "../api/diagnostic.js";
import { setSession } from "../src/auth.js";

test("Diagnostic Endpoint Tests", async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  t.afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function createAuthCookie(role = "Admin") {
    process.env.SESSION_SECRET = "test-secret-key-123";
    const mockResponse = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    setSession(mockResponse, { id: "1", username: role.toLowerCase(), role });
    return mockResponse.headers["Set-Cookie"].split(";")[0];
  }

  function mockRes() {
    return {
      statusCode: 200,
      jsonData: null,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.jsonData = data; return this; }
    };
  }

  await t.test("401 Unauthorized when no session", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: {} }, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.headers["Cache-Control"], "no-store, max-age=0");
  });

  await t.test("403 Forbidden for non-admin session", async () => {
    const req = { method: "GET", headers: { cookie: createAuthCookie("Editor") } };
    const res = mockRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res.jsonData, { error: "Forbidden" });
  });

  await t.test("405 for non-GET requests", async () => {
    const req = { method: "POST", headers: { cookie: createAuthCookie() } };
    const res = mockRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.headers.Allow, "GET");
  });

  await t.test("Missing env vars", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_API_KEY;

    const req = { method: "GET", headers: { cookie: createAuthCookie() } };
    const res = mockRes();
    await handler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.jsonData.GEMINI_API_KEY.envPresent, false);
    assert.strictEqual(res.jsonData.OPENAI_API_KEY.envPresent, false);
    assert.strictEqual(res.jsonData.OPENAI_IMAGE_API_KEY.envPresent, false);
    assert.strictEqual(res.jsonData.GEMINI_API_KEY.httpStatus, null);
    assert.strictEqual(res.jsonData.GEMINI_API_KEY.modelCount, 0);
    assert.deepStrictEqual(res.jsonData.GEMINI_API_KEY.models, []);
  });

  await t.test("Successful model list and strict key isolation", async () => {
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.OPENAI_API_KEY = "openai-secret";
    process.env.OPENAI_IMAGE_API_KEY = "openai-image-secret";

    let geminiCalled = false;
    const openaiAuthHeaders = [];

    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.includes("generativelanguage")) {
        assert.ok(!href.includes("gemini-secret"), "Gemini key must not appear in URL");
        assert.strictEqual(options.headers["x-goog-api-key"], "gemini-secret");
        geminiCalled = true;
        return { ok: true, status: 200, json: async () => ({ models: [{ name: "models/gemini-1.5" }] }) };
      }
      if (href.includes("api.openai.com")) {
        openaiAuthHeaders.push(options.headers.Authorization);
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-4" }] }) };
      }
      throw new Error("Unexpected fetch call");
    };

    const req = { method: "GET", headers: { cookie: createAuthCookie() } };
    const res = mockRes();
    await handler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(geminiCalled, "Gemini was not called");
    assert.strictEqual(openaiAuthHeaders.length, 2, "Exactly 2 OpenAI calls expected");
    assert.strictEqual(openaiAuthHeaders.filter((h) => h === "Bearer openai-secret").length, 1);
    assert.strictEqual(openaiAuthHeaders.filter((h) => h === "Bearer openai-image-secret").length, 1);
    assert.strictEqual(res.jsonData.GEMINI_API_KEY.success, true);
    assert.strictEqual(res.jsonData.OPENAI_API_KEY.success, true);
    assert.strictEqual(res.jsonData.OPENAI_IMAGE_API_KEY.success, true);
  });

  await t.test("401 Unauthorized from provider", async () => {
    process.env.OPENAI_API_KEY = "bad-key";
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_IMAGE_API_KEY;

    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { type: "invalid_request_error", code: "invalid_api_key" } })
    });

    const req = { method: "GET", headers: { cookie: createAuthCookie() } };
    const res = mockRes();
    await handler(req, res);

    assert.strictEqual(res.jsonData.OPENAI_API_KEY.success, false);
    assert.strictEqual(res.jsonData.OPENAI_API_KEY.httpStatus, 401);
    assert.strictEqual(res.jsonData.OPENAI_API_KEY.errorType, "invalid_request_error");
  });

  await t.test("Network/provider failure", async () => {
    process.env.GEMINI_API_KEY = "gemini-secret";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_API_KEY;

    global.fetch = async () => { throw new Error("ECONNREFUSED"); };

    const req = { method: "GET", headers: { cookie: createAuthCookie() } };
    const res = mockRes();
    await handler(req, res);

    assert.strictEqual(res.jsonData.GEMINI_API_KEY.success, false);
    assert.strictEqual(res.jsonData.GEMINI_API_KEY.errorType, "NetworkError");
    assert.strictEqual(res.jsonData.GEMINI_API_KEY.errorCode, "Error");
  });

  await t.test("Explicit secret-leakage test", async () => {
    const secret1 = "SUPER_SECRET_GEMINI_KEY_999";
    const secret2 = "SUPER_SECRET_OPENAI_KEY_888";
    const secret3 = "SUPER_SECRET_OPENAI_IMAGE_KEY_777";

    process.env.GEMINI_API_KEY = secret1;
    process.env.OPENAI_API_KEY = secret2;
    process.env.OPENAI_IMAGE_API_KEY = secret3;

    global.fetch = async (url) => {
      assert.ok(!String(url).includes(secret1), "Gemini key leaked in request URL");
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: `Failed with key ${secret1}` } })
      };
    };

    const req = { method: "GET", headers: { cookie: createAuthCookie() } };
    const res = mockRes();
    await handler(req, res);

    const responseString = JSON.stringify(res.jsonData);
    assert.ok(!responseString.includes(secret1), "Gemini key leaked in response!");
    assert.ok(!responseString.includes(secret2), "OpenAI key leaked in response!");
    assert.ok(!responseString.includes(secret3), "OpenAI Image key leaked in response!");
  });
});
