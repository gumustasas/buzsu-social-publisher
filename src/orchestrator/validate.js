// TASK-007: "orchestration is bounded" + "malformed or unknown steps are
// rejected" — bu dosya TÜM planı yürütmeden ÖNCE tek seferde doğrular.
// Herhangi bir adım geçersizse (bilinmeyen capability, izinsiz alan,
// eksik zorunlu alan, sınır dışı retry, tekrarlı stepId...) PLANIN
// TAMAMI reddedilir — kısmi yürütme (bazı adımlar çalışıp bazıları
// atlanarak) YAPILMAZ; bu en deterministik ve fail-closed seçenektir.
export const MAX_STEPS = 20;
export const MAX_RETRY_ATTEMPTS = 3;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePlan(rawSteps, registry) {
  if (!Array.isArray(rawSteps)) throw new Error('"steps" bir dizi olmalı.');
  if (rawSteps.length < 1) throw new Error('"steps" en az 1 adım içermeli.');
  if (rawSteps.length > MAX_STEPS) throw new Error(`"steps" en fazla ${MAX_STEPS} adım içerebilir.`);

  const seenStepIds = new Set();
  return rawSteps.map((rawStep, index) => {
    if (!isPlainObject(rawStep)) throw new Error(`Adım #${index} geçerli bir nesne değil.`);

    const stepId = String(rawStep.stepId || "").trim();
    if (!stepId) throw new Error(`Adım #${index}: "stepId" gerekli.`);
    if (seenStepIds.has(stepId)) throw new Error(`Tekrarlanan stepId: "${stepId}".`);
    seenStepIds.add(stepId);

    const capability = String(rawStep.capability || "").trim();
    const descriptor = registry[capability];
    if (!descriptor) throw new Error(`Adım "${stepId}": bilinmeyen veya izin verilmeyen capability: "${capability}".`);

    const args = rawStep.args === undefined ? {} : rawStep.args;
    if (!isPlainObject(args)) throw new Error(`Adım "${stepId}": "args" bir nesne olmalı.`);

    for (const key of Object.keys(args)) {
      if (!descriptor.allowedArgs.has(key)) {
        throw new Error(`Adım "${stepId}" (${capability}): izin verilmeyen alan: "${key}".`);
      }
    }
    for (const requiredKey of descriptor.requiredArgs) {
      const value = args[requiredKey];
      if (value === undefined || value === null || value === "") {
        throw new Error(`Adım "${stepId}" (${capability}): zorunlu alan eksik: "${requiredKey}".`);
      }
    }

    const maxAttempts = rawStep.maxAttempts === undefined ? 1 : rawStep.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_RETRY_ATTEMPTS) {
      throw new Error(`Adım "${stepId}": "maxAttempts" 1-${MAX_RETRY_ATTEMPTS} arası bir tam sayı olmalı.`);
    }

    return { stepId, capability, args, maxAttempts };
  });
}
