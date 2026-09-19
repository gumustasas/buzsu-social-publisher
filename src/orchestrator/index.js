import { randomUUID } from "node:crypto";
import { createCapabilityRegistry, ORCHESTRATOR_CAPABILITIES } from "./capabilities.js";
import { validatePlan } from "./validate.js";
import { ORCHESTRATOR_STATES, assertValidTransition } from "./states.js";
import { redactSecrets } from "./redact.js";

export { ORCHESTRATOR_STATES, ORCHESTRATOR_CAPABILITIES };

// TASK-007 (Controlled Agent Orchestrator): TASK-001..006'nın MEVCUT
// READ/GENERATE capability'lerini (kendi provider mantıklarını
// TEKRARLAMADAN, doğrudan çekirdek fonksiyonlarını çağırarak — bkz.
// capabilities.js) sabit, sıralı bir adım listesi olarak yürüten
// deterministik bir state machine. run_agent_orchestration MCP tool'u
// (bkz. api/mcp.js) BU fonksiyonu çağırır.
//
// GÜVENLİK SINIRLARI (forbidden_capabilities):
// - Registry'de YALNIZCA READ + TASK-001..006 GENERATE capability'leri
//   vardır; publish_now/create_draft/update_draft/update_status/
//   set_autopilot/upload_media/delete/env/deployment İLGİLİ hiçbir şey
//   registry'de YOKTUR — bilinmeyen/izin verilmeyen bir capability adı
//   "malformed" olarak PLANIN TAMAMINI reddeder (bkz. validate.js).
// - Hiçbir adım kendiliğinden confirmed:true ÜRETİLMEZ; caller HER
//   ücretli adım için confirmed:true'yu O ADIMIN KENDİ args'ında AÇIKÇA
//   göndermelidir (bkz. capabilities.js requiresConfirmation kontrolü).
// - Bir adım başarısız/onay-bekliyor olduğunda SONRAKİ adımlar HİÇ
//   çalıştırılmaz; ÖNCEKİ başarılı adımların çıktıları (completedSteps)
//   yanıtta KORUNUR.
//
// Alan adları manifest'in required_run_metadata'sıyla AYNI semantiği
// taşır, yalnızca bu depodaki HER mevcut MCP yanıtıyla tutarlı olacak
// şekilde camelCase'e çevrilmiştir (manifest: "Equivalent names are
// acceptable... when more consistent with the existing repository
// architecture"): run_id->runId, current_step->currentStep,
// completed_steps->completedSteps, pending_steps->pendingSteps,
// blocked_or_confirmation_reason->blockedOrConfirmationReason,
// failure_reason->failureReason, capability_or_tool_used->
// capabilityOrToolUsed.
export async function runOrchestration(input = {}, env = process.env, deps = {}) {
  const runId = deps.runIdImpl ? deps.runIdImpl() : randomUUID();
  const registry = deps.registry || createCapabilityRegistry(deps);

  let state = "pending";
  let steps;
  try {
    steps = validatePlan(input.steps, registry);
  } catch (err) {
    state = assertValidTransition(state, "blocked");
    return {
      runId,
      status: state,
      currentStep: null,
      completedSteps: [],
      pendingSteps: [],
      blockedOrConfirmationReason: redactSecrets(err.message, env),
      failureReason: null,
      capabilityOrToolUsed: null
    };
  }

  state = assertValidTransition(state, "running");
  const completedSteps = [];
  const remainingStepIds = steps.map((step) => step.stepId);

  for (const step of steps) {
    remainingStepIds.shift();
    const descriptor = registry[step.capability];

    if (descriptor.requiresConfirmation && step.args.confirmed !== true) {
      state = assertValidTransition(state, "waiting_for_confirmation");
      return {
        runId,
        status: state,
        currentStep: step.stepId,
        completedSteps,
        pendingSteps: [step.stepId, ...remainingStepIds],
        blockedOrConfirmationReason: `Adım "${step.stepId}" (${step.capability}) confirmed:true olmadan çalıştırılamaz. Onay hiçbir zaman otomatik verilmez.`,
        failureReason: null,
        capabilityOrToolUsed: step.capability
      };
    }

    let output;
    let lastError = null;
    let succeeded = false;
    // Bounded, açık retry: maxAttempts validate.js'te 1..MAX_RETRY_ATTEMPTS
    // olarak zaten doğrulandı — burada sonsuz/sınırsız bir döngü YOKTUR.
    for (let attempt = 1; attempt <= step.maxAttempts; attempt++) {
      try {
        output = await descriptor.run(step.args, env);
        succeeded = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!succeeded) {
      state = assertValidTransition(state, "failed");
      return {
        runId,
        status: state,
        currentStep: step.stepId,
        completedSteps,
        pendingSteps: [step.stepId, ...remainingStepIds],
        blockedOrConfirmationReason: null,
        failureReason: redactSecrets(lastError?.message || "Bilinmeyen hata.", env),
        capabilityOrToolUsed: step.capability
      };
    }

    completedSteps.push({ stepId: step.stepId, capability: step.capability, output });
  }

  state = assertValidTransition(state, "completed");
  return {
    runId,
    status: state,
    currentStep: null,
    completedSteps,
    pendingSteps: [],
    blockedOrConfirmationReason: null,
    failureReason: null,
    capabilityOrToolUsed: completedSteps.length ? completedSteps[completedSteps.length - 1].capability : null
  };
}
