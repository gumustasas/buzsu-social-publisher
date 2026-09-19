import test from "node:test";
import assert from "node:assert/strict";
import { createAiWorkspaceHandler } from "../api/ai-workspace.js";

function request(method, action, body, query = {}) {
  return { method, query: { action, ...query }, body: body === undefined ? undefined : JSON.stringify(body), headers: {} };
}

function response() {
  const result = { statusCode: null, payload: null };
  result.status = (statusCode) => { result.statusCode = statusCode; return result; };
  result.json = (payload) => { result.payload = payload; return result; };
  return result;
}

test("ai-workspace handler: yetkisiz istek (oturum yok) 401 döner, hiçbir downstream çağrı yapılmaz", async () => {
  let deepResearchCalled = false;
  let orchestrationCalled = false;
  const handler = createAiWorkspaceHandler({
    getSessionImpl: () => null,
    runDeepResearchImpl: async () => { deepResearchCalled = true; return {}; },
    runOrchestrationImpl: async () => { orchestrationCalled = true; return {}; }
  });
  const res = response();
  await handler(request("POST", "deep-research", { mode: "seo", objective: "x", confirmed: true }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(deepResearchCalled, false);
  assert.equal(orchestrationCalled, false);
});

test("ai-workspace handler: GET action=options oturumlu kullanıcıya sabit research mode + capability listelerini döner", async () => {
  const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }) });
  const res = response();
  await handler(request("GET", "options"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.researchModes, ["seo", "competitor", "weekly_content_opportunities"]);
  assert.deepEqual(res.payload.agentCapabilities, [
    "list_products", "get_buzsu_product_context", "research_web", "transcribe_media",
    "generate_scene_image", "validate_product_visual", "generate_image_from_video", "search_product_knowledge"
  ]);
});

test("ai-workspace handler: desteklenmeyen bir action (unsupported operation) hiçbir downstream çağrı yapılmadan 400 ile reddedilir", async () => {
  let deepResearchCalled = false;
  let orchestrationCalled = false;
  const handler = createAiWorkspaceHandler({
    getSessionImpl: () => ({ id: "u1" }),
    runDeepResearchImpl: async () => { deepResearchCalled = true; return {}; },
    runOrchestrationImpl: async () => { orchestrationCalled = true; return {}; }
  });
  const res = response();
  await handler(request("POST", "publish_now", { productId: "rec1" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Desteklenmeyen action/);
  assert.equal(deepResearchCalled, false);
  assert.equal(orchestrationCalled, false);
});

test("ai-workspace handler: desteklenmeyen bir HTTP method 405 ile reddedilir", async () => {
  const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }) });
  const res = response();
  await handler(request("DELETE", "deep-research"), res);
  assert.equal(res.statusCode, 405);
});

test("ai-workspace handler: action='deep-research' TÜM alanları olduğu gibi runDeepResearch'e forward eder (delegasyon, kendi mantığı YOK)", async () => {
  let received;
  const handler = createAiWorkspaceHandler({
    getSessionImpl: () => ({ id: "u1" }),
    env: { SAFE: "yes" },
    runDeepResearchImpl: async (input, env) => { received = { input, env }; return { query_or_objective: "x", findings: [], sources: [], uncertainty: [], conflicts: [], providers_or_capabilities_used: [] }; }
  });
  const res = response();
  await handler(request("POST", "deep-research", {
    mode: "seo", objective: "kireç önleyici anahtar kelimeleri", competitors: ["A"], urls: ["https://a.com"],
    provider: "google", productId: "rec1", productKnowledgeQuery: "soru", confirmed: true
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(received.input, {
    mode: "seo", objective: "kireç önleyici anahtar kelimeleri", competitors: ["A"], urls: ["https://a.com"],
    provider: "google", productId: "rec1", productUrl: undefined, productKnowledgeQuery: "soru", confirmed: true
  });
  assert.equal(received.env.SAFE, "yes");
  assert.deepEqual(res.payload.result, { query_or_objective: "x", findings: [], sources: [], uncertainty: [], conflicts: [], providers_or_capabilities_used: [] });
});

test("ai-workspace handler: action='deep-research' ile confirmed:false (veya eksik) gönderilirse HİÇBİR downstream/paid çağrı yapılmaz — runDeepResearch'in KENDİ reddi olduğu gibi yansır", async () => {
  const handler = createAiWorkspaceHandler({
    getSessionImpl: () => ({ id: "u1" }),
    runDeepResearchImpl: async (input) => {
      if (input.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      throw new Error("çağrılmamalıydı — bu noktaya asla ulaşılmamalı");
    }
  });
  const res = response();
  await handler(request("POST", "deep-research", { mode: "seo", objective: "x" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /confirmed:true/);
});

test("ai-workspace handler: action='deep-research' — confirmed:'true' (string, boolean DEĞİL) SESSİZCE onaya çevrilmez, aynen false gibi ele alınır", async () => {
  let receivedConfirmed;
  const handler = createAiWorkspaceHandler({
    getSessionImpl: () => ({ id: "u1" }),
    runDeepResearchImpl: async (input) => { receivedConfirmed = input.confirmed; return {}; }
  });
  const res = response();
  await handler(request("POST", "deep-research", { mode: "seo", objective: "x", confirmed: "true" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(receivedConfirmed, false);
});

test("ai-workspace handler: action='deep-research' — runDeepResearch'ün döndürdüğü YAPISAL çıktı (findings/sources/uncertainty/conflicts/providers_or_capabilities_used) hiç değiştirilmeden korunur", async () => {
  const structuredResult = {
    query_or_objective: "kireç önleyici anahtar kelimeleri",
    findings: [{ capability: "research_web", provider: "google", answer: "Cevap." }],
    sources: [{ url: "https://example.com/a", title: "A", snippet: "", provider: "google", capability: "research_web" }],
    uncertainty: ["research_web yalnızca 1 kaynağa dayanıyor."],
    conflicts: [{ field: "kurulum", airtable: "A", document: "B" }],
    providers_or_capabilities_used: ["research_web:google"]
  };
  const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }), runDeepResearchImpl: async () => structuredResult });
  const res = response();
  await handler(request("POST", "deep-research", { mode: "seo", objective: "x", confirmed: true }), res);
  assert.deepEqual(res.payload.result, structuredResult);
});

test("ai-workspace handler: action='agent' steps'i OLDUĞU GİBİ runOrchestration'a forward eder (delegasyon)", async () => {
  let received;
  const orchestrationResult = { runId: "r1", status: "completed", currentStep: null, completedSteps: [], pendingSteps: [], blockedOrConfirmationReason: null, failureReason: null, capabilityOrToolUsed: null };
  const handler = createAiWorkspaceHandler({
    getSessionImpl: () => ({ id: "u1" }),
    runOrchestrationImpl: async (input) => { received = input; return orchestrationResult; }
  });
  const res = response();
  const steps = [{ stepId: "s1", capability: "research_web", args: { query: "x", confirmed: true } }];
  await handler(request("POST", "agent", { steps }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(received.steps, steps);
  assert.deepEqual(res.payload.result, orchestrationResult);
});

test("ai-workspace handler: action='agent' — malformed bir istek (bilinmeyen capability) runOrchestration'ın KENDİ 'blocked' yanıtıyla fail-closed döner, adapter kendi bir mantık eklemez", async () => {
  const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }) });
  const res = response();
  await handler(request("POST", "agent", { steps: [{ stepId: "s1", capability: "publish_now", args: {} }] }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.result.status, "blocked");
  assert.match(res.payload.result.blockedOrConfirmationReason, /bilinmeyen veya izin verilmeyen capability/);
});

// TASK-009: "forbidden mutation/publish capability cannot be reached
// through workspace" — bu, gerçek runOrchestration/runDeepResearch
// kullanılarak (mock DEĞİL) doğrulanır; adapter'ın KENDİSİ hiçbir
// mutation fonksiyonunu import ETMEDİĞİ için, publish_now/create_draft/
// update_status/set_autopilot/upload_media gibi bir capability adı asla
// ORCHESTRATOR_CAPABILITIES listesinde YOKTUR ve her zaman "blocked" ile
// reddedilir — gerçek ağ/API çağrısı YAPILMADAN.
test("ai-workspace handler: publish/update/delete/upload/autopilot capability'leri (gerçek runOrchestration ile) HİÇBİR ZAMAN çalıştırılamaz", async () => {
  const handler = createAiWorkspaceHandler({ getSessionImpl: () => ({ id: "u1" }) });
  for (const forbidden of ["publish_now", "create_draft", "update_draft", "update_status", "set_autopilot", "upload_media", "delete_draft"]) {
    const res = response();
    await handler(request("POST", "agent", { steps: [{ stepId: "s1", capability: forbidden, args: {} }] }), res);
    assert.equal(res.payload.result.status, "blocked", `${forbidden} bloklanmalı`);
  }
});

// ROOT review (PR #108): önceki sürümde downstream mock ZATEN önceden
// redakte edilmiş bir hata fırlatıyordu — bu, adapter'ın KENDİ redaksiyon
// kodunu HİÇ egzersiz etmiyordu (runDeepResearch/runOrchestration
// çağrılmadığı için onların redaksiyonu da devrede değildi; test sadece
// "ne fırlatırsan aynen döner" davranışını doğruluyordu). Burada downstream
// KASITLI OLARAK HAM (redakte edilmemiş) bir hata fırlatır — adapter'ın
// KENDİ catch bloğundaki redactSecrets() çağrısının hem HTTP yanıtını hem
// console.error log satırını GERÇEKTEN redakte ettiği doğrulanır.
test("ai-workspace handler: downstream RAW (redakte edilmemiş) bir hata fırlatsa bile ham secret NE yanıta NE log'a sızar — adapter'ın KENDİ redaksiyonu devreye girer", async () => {
  const secretValue = "sk-supersecrettestvalue987654";
  const originalConsoleError = console.error;
  const loggedCalls = [];
  console.error = (...args) => { loggedCalls.push(args); };
  try {
    const handler = createAiWorkspaceHandler({
      getSessionImpl: () => ({ id: "u1" }),
      env: { GEMINI_API_KEY: secretValue },
      runDeepResearchImpl: async () => {
        // Ham/redakte edilmemiş bir hata — gerçek bir provider hatasının
        // (veya adapter'ın kendi kodundaki beklenmeyen bir hatanın) upstream
        // redaksiyondan KAÇMIŞ olabileceği en kötü durumu temsil eder.
        throw new Error(`HTTP 401: key=${secretValue} geçersiz — ham hata, redakte edilmemiş`);
      }
    });
    const res = response();
    await handler(request("POST", "deep-research", { mode: "seo", objective: "x", confirmed: true }), res);

    assert.equal(res.statusCode, 400);
    assert.doesNotMatch(res.payload.error, new RegExp(secretValue));
    assert.match(res.payload.error, /\[REDACTED\]/);

    const loggedText = loggedCalls.map((args) => args.map((value) => String(value)).join(" ")).join("\n");
    assert.doesNotMatch(loggedText, new RegExp(secretValue));
  } finally {
    console.error = originalConsoleError;
  }
});
