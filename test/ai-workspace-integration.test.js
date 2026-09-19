import test from "node:test";
import assert from "node:assert/strict";
import { createAiWorkspaceHandler } from "../api/ai-workspace.js";

// TASK-009: burada runDeepResearch/runOrchestration MOCK'LANMAZ (test/
// ai-workspace-handler.test.js'teki gibi deps injection ile) — GERÇEK
// TASK-007/TASK-008 çekirdek fonksiyonları çağrılır, yalnız global.fetch
// mock'lanır (test/mcp.test.js'teki research_web testleriyle AYNI desen).
// Bu, adapter'ın gerçekten "duplicate provider/research/orchestrator
// implementation" İÇERMEDİĞİNİ, sadece delegasyon yaptığını kanıtlar.
function request(method, action, body) {
  return { method, query: { action }, body: body === undefined ? undefined : JSON.stringify(body), headers: {} };
}

function response() {
  const result = { statusCode: null, payload: null };
  result.status = (statusCode) => { result.statusCode = statusCode; return result; };
  result.json = (payload) => { result.payload = payload; return result; };
  return result;
}

test("ai-workspace handler (GERÇEK runDeepResearch ile): confirmed:true ile geçerli bir SEO akışı tamamlanır, TASK-008'in tam çıktı sözleşmesi (findings/sources/uncertainty/conflicts/providers_or_capabilities_used) korunur", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "SEO cevabı." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/seo", title: "SEO" } }] } }] })
  });
  try {
    const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }), env: { GEMINI_API_KEY: "test-gemini-key" } });
    const res = response();
    await handler(request("POST", "deep-research", { mode: "seo", objective: "kireç önleyici anahtar kelimeleri", provider: "google", confirmed: true }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.result.query_or_objective, "kireç önleyici anahtar kelimeleri");
    assert.equal(res.payload.result.findings[0].answer, "SEO cevabı.");
    assert.deepEqual(res.payload.result.providers_or_capabilities_used, ["research_web:google"]);
    assert.ok(Array.isArray(res.payload.result.uncertainty));
    assert.deepEqual(res.payload.result.conflicts, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ai-workspace handler (GERÇEK runDeepResearch ile): confirmed:true olmadan hiçbir API çağrısı yapılmaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }), env: { GEMINI_API_KEY: "test-gemini-key" } });
    const res = response();
    await handler(request("POST", "deep-research", { mode: "seo", objective: "x" }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ai-workspace handler (GERÇEK runOrchestration ile): confirmed:true ile research_web adımını gerçekten çalıştırır ve completed bir run döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "Cevap metni." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }] } }] })
  });
  try {
    const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }), env: { GEMINI_API_KEY: "test-gemini-key" } });
    const res = response();
    await handler(request("POST", "agent", { steps: [{ stepId: "s1", capability: "research_web", args: { query: "buzsu su arıtma güncel fiyat", provider: "google", confirmed: true } }] }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.result.status, "completed");
    assert.equal(res.payload.result.completedSteps[0].output.answer, "Cevap metni.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("ai-workspace handler (GERÇEK runOrchestration ile): confirmed:true verilmeyen bir adımda hiçbir API çağrısı yapılmadan waiting_for_confirmation döner", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }), env: { GEMINI_API_KEY: "test-gemini-key" } });
    const res = response();
    await handler(request("POST", "agent", { steps: [{ stepId: "s1", capability: "research_web", args: { query: "x" } }] }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.result.status, "waiting_for_confirmation");
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});
