import test from "node:test";
import assert from "node:assert/strict";
import { runOrchestration, ORCHESTRATOR_STATES } from "../src/orchestrator/index.js";

test("runOrchestration: geçerli, sıralı bir plan (READ + onaylanmış GENERATE adımları) baştan sona tamamlanır", async () => {
  const calls = [];
  const deps = {
    listProductsImpl: async () => { calls.push("list_products"); return [{ id: "p1", title: "Ürün" }]; },
    researchWebImpl: async (args) => { calls.push("research_web"); return { answer: `cevap: ${args.query}`, sources: [] }; }
  };
  const result = await runOrchestration(
    {
      steps: [
        { stepId: "s1", capability: "list_products" },
        { stepId: "s2", capability: "research_web", args: { query: "Buzsu Ultramag", confirmed: true } }
      ]
    },
    {},
    deps
  );
  assert.equal(result.status, "completed");
  assert.equal(result.currentStep, null);
  assert.deepEqual(result.pendingSteps, []);
  assert.equal(result.completedSteps.length, 2);
  assert.deepEqual(result.completedSteps[0], { stepId: "s1", capability: "list_products", output: [{ id: "p1", title: "Ürün" }] });
  assert.deepEqual(result.completedSteps[1].output, { answer: "cevap: Buzsu Ultramag", sources: [] });
  assert.deepEqual(calls, ["list_products", "research_web"]);
  assert.equal(result.capabilityOrToolUsed, "research_web");
  assert.ok(typeof result.runId === "string" && result.runId.length > 0);
});

test("runOrchestration: bilinmeyen/forbidden bir capability PLANIN TAMAMINI çalıştırmadan reddeder (blocked)", async () => {
  let called = false;
  const result = await runOrchestration(
    { steps: [{ stepId: "s1", capability: "publish_now", args: {} }] },
    {},
    { listProductsImpl: async () => { called = true; return []; } }
  );
  assert.equal(result.status, "blocked");
  assert.match(result.blockedOrConfirmationReason, /bilinmeyen veya izin verilmeyen capability/);
  assert.equal(result.failureReason, null);
  assert.equal(called, false);
});

test("runOrchestration: malformed girdi (steps eksik/dizi değil) blocked döner, hiçbir adım çalışmaz", async () => {
  const result = await runOrchestration({}, {}, {});
  assert.equal(result.status, "blocked");
  assert.match(result.blockedOrConfirmationReason, /dizi olmalı/);
});

test("runOrchestration: confirmed:true verilmeyen bir ücretli adımda GÜVENLE durur (waiting_for_confirmation), impl'e hiç ulaşılmaz", async () => {
  let called = false;
  const result = await runOrchestration(
    { steps: [{ stepId: "s1", capability: "research_web", args: { query: "x" } }] },
    {},
    { researchWebImpl: async () => { called = true; return {}; } }
  );
  assert.equal(result.status, "waiting_for_confirmation");
  assert.equal(result.currentStep, "s1");
  assert.deepEqual(result.pendingSteps, ["s1"]);
  assert.match(result.blockedOrConfirmationReason, /confirmed:true olmadan çalıştırılamaz/);
  assert.equal(called, false, "confirmed:true olmadan ücretli capability'ye HİÇ istek atılmamalı");
});

test("runOrchestration: sonraki (bağımlı) adımlar bir öncekinin confirmation'da beklemesi yüzünden HİÇ çalıştırılmaz", async () => {
  let secondCalled = false;
  const result = await runOrchestration(
    {
      steps: [
        { stepId: "s1", capability: "research_web", args: { query: "x" } },
        { stepId: "s2", capability: "list_products" }
      ]
    },
    {},
    { researchWebImpl: async () => ({}), listProductsImpl: async () => { secondCalled = true; return []; } }
  );
  assert.equal(result.status, "waiting_for_confirmation");
  assert.deepEqual(result.pendingSteps, ["s1", "s2"]);
  assert.equal(secondCalled, false);
});

test("runOrchestration: bir adım başarısız olursa (dependency/tool failure) run failed olur, hata mesajı olduğu gibi (redaksiyon dışında) yansır", async () => {
  const result = await runOrchestration(
    { steps: [{ stepId: "s1", capability: "research_web", args: { query: "x", confirmed: true } }] },
    {},
    { researchWebImpl: async () => { throw new Error("upstream provider quota exceeded"); } }
  );
  assert.equal(result.status, "failed");
  assert.equal(result.currentStep, "s1");
  assert.equal(result.failureReason, "upstream provider quota exceeded");
  assert.equal(result.capabilityOrToolUsed, "research_web");
});

test("runOrchestration: bir adım başarısız olursa SONRAKİ adımlar HİÇ çalıştırılmaz, ÖNCEKİ başarılı adımların çıktıları KORUNUR", async () => {
  let listProductsCallCount = 0;
  const result = await runOrchestration(
    {
      steps: [
        { stepId: "s1", capability: "list_products" },
        { stepId: "s2", capability: "research_web", args: { query: "x", confirmed: true } },
        { stepId: "s3", capability: "list_products" }
      ]
    },
    {},
    {
      listProductsImpl: async () => { listProductsCallCount += 1; return [{ id: "p1" }]; },
      researchWebImpl: async () => { throw new Error("boom"); }
    }
  );
  assert.equal(result.status, "failed");
  assert.equal(result.currentStep, "s2");
  assert.equal(result.completedSteps.length, 1);
  assert.deepEqual(result.completedSteps[0], { stepId: "s1", capability: "list_products", output: [{ id: "p1" }] });
  assert.deepEqual(result.pendingSteps, ["s2", "s3"]);
  assert.equal(listProductsCallCount, 1, "s3 (s2'ye bağımlı) hiç çalıştırılmamalı");
});

test("runOrchestration: bounded retry — maxAttempts=3, ilk 2 deneme başarısız 3.'de başarılı olursa run completed olur ve impl TAM 3 kez çağrılır", async () => {
  let attempts = 0;
  const result = await runOrchestration(
    { steps: [{ stepId: "s1", capability: "research_web", args: { query: "x", confirmed: true }, maxAttempts: 3 }] },
    {},
    {
      researchWebImpl: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient failure");
        return { answer: "ok" };
      }
    }
  );
  assert.equal(result.status, "completed");
  assert.equal(attempts, 3);
});

test("runOrchestration: bounded retry — tüm denemeler tükenirse (sonsuz döngü YOK) run failed olur, impl tam maxAttempts kez çağrılır", async () => {
  let attempts = 0;
  const result = await runOrchestration(
    { steps: [{ stepId: "s1", capability: "research_web", args: { query: "x", confirmed: true }, maxAttempts: 2 }] },
    {},
    { researchWebImpl: async () => { attempts += 1; throw new Error("always fails"); } }
  );
  assert.equal(result.status, "failed");
  assert.equal(attempts, 2);
  assert.equal(result.failureReason, "always fails");
});

test("runOrchestration: hata mesajında ham bir secret env değeri varsa [REDACTED] ile değiştirilir, asla olduğu gibi sızmaz", async () => {
  const secretValue = "sk-supersecrettestvalue987654";
  const result = await runOrchestration(
    { steps: [{ stepId: "s1", capability: "research_web", args: { query: "x", confirmed: true } }] },
    { GEMINI_API_KEY: secretValue },
    { researchWebImpl: async () => { throw new Error(`Gemini HTTP 401: key=${secretValue} geçersiz`); } }
  );
  assert.equal(result.status, "failed");
  assert.doesNotMatch(result.failureReason, new RegExp(secretValue));
  assert.match(result.failureReason, /\[REDACTED\]/);
});

test("runOrchestration: her senaryoda döndürülen status değeri ORCHESTRATOR_STATES kümesinin bir elemanıdır (deterministic state transitions)", async () => {
  const scenarios = [
    runOrchestration({ steps: [{ stepId: "a", capability: "list_products" }] }, {}, { listProductsImpl: async () => [] }),
    runOrchestration({ steps: "not-array" }, {}, {}),
    runOrchestration({ steps: [{ stepId: "a", capability: "research_web", args: { query: "x" } }] }, {}, {}),
    runOrchestration({ steps: [{ stepId: "a", capability: "research_web", args: { query: "x", confirmed: true } }] }, {}, { researchWebImpl: async () => { throw new Error("x"); } })
  ];
  const results = await Promise.all(scenarios);
  for (const result of results) assert.ok(ORCHESTRATOR_STATES.includes(result.status));
  assert.deepEqual(results.map((r) => r.status), ["completed", "blocked", "waiting_for_confirmation", "failed"]);
});
