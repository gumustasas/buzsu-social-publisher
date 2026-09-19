import "dotenv/config";
import { getSession } from "../src/auth.js";
import { runDeepResearch, RESEARCH_MODES } from "../src/deep-research/index.js";
import { runOrchestration, ORCHESTRATOR_CAPABILITIES } from "../src/orchestrator/index.js";
import { redactSecrets } from "../src/orchestrator/redact.js";

// TASK-009: Dashboard AI Research / Agent Workspace — bu dosya SADECE
// authenticated dashboard'ın TASK-007 (run_agent_orchestration) ve TASK-008
// (run_deep_research) çekirdek fonksiyonlarını çağırmasına izin veren EN
// KÜÇÜK HTTP adaptörüdür. Kendi bir provider/validation/allowlist/state-
// machine mantığı İCAT ETMEZ — runDeepResearch/runOrchestration'ı OLDUĞU
// GİBİ, doğrudan çağırır (bkz. src/deep-research/**, src/orchestrator/**,
// bu görevin do_not_touch'u). create_draft/update_draft/update_status/
// publish_now/upload_media/set_autopilot veya herhangi bir silme/env/
// deployment fonksiyonu bu dosyada HİÇ import EDİLMEZ — bu iki çekirdek
// fonksiyon zaten kendi salt-okunur/onaylı allowlist'lerini uygular (bkz.
// DEEP_RESEARCH_ALLOWED_CAPABILITIES, ORCHESTRATOR_CAPABILITIES).

function parseBody(request) {
  return typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {});
}

export function createAiWorkspaceHandler({
  getSessionImpl = getSession,
  runDeepResearchImpl = runDeepResearch,
  runOrchestrationImpl = runOrchestration,
  env = process.env
} = {}) {
  return async function handler(request, response) {
    // Dashboard'ın MEVCUT oturum/authentication mekanizması — bkz.
    // api/reel-script.js ve depodaki her diğer authenticated route İLE
    // AYNI kontrol. Yeni bir auth yolu İCAT EDİLMEZ.
    if (!getSessionImpl(request)) return response.status(401).json({ ok: false, error: "Unauthorized" });
    try {
      const action = String(request.query?.action || "");

      if (request.method === "GET" && action === "options") {
        return response.status(200).json({ ok: true, researchModes: RESEARCH_MODES, agentCapabilities: ORCHESTRATOR_CAPABILITIES });
      }

      if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
      const body = parseBody(request);

      if (action === "deep-research") {
        // confirmed BİLEREK yalnızca args.confirmed === true olduğunda
        // true olur — dashboard'dan gelen herhangi bir başka truthy değer
        // (örn. "true" string'i) SESSİZCE onaya çevrilmez; runDeepResearch
        // KENDİSİ zaten confirmed !== true'yu reddeder, burada AYRICA bir
        // onay ÜRETİLMEZ.
        const result = await runDeepResearchImpl(
          {
            mode: body.mode,
            objective: body.objective,
            competitors: body.competitors,
            urls: body.urls,
            provider: body.provider,
            productId: body.productId,
            productUrl: body.productUrl,
            productKnowledgeQuery: body.productKnowledgeQuery,
            confirmed: body.confirmed === true
          },
          env
        );
        return response.status(200).json({ ok: true, result });
      }

      if (action === "agent") {
        // steps dizisindeki HER adımın confirmed:true'su (varsa) yine
        // caller'ın (dashboard kullanıcısının doldurduğu JSON'un) kendi
        // içinde gelir — burada hiçbir adıma confirmed EKLENMEZ/DEĞİŞTİRİLMEZ.
        // runOrchestration bilinmeyen/forbidden bir capability'yi veya
        // eksik confirmed'i KENDİSİ reddeder (bkz. src/orchestrator/).
        const result = await runOrchestrationImpl({ steps: body.steps }, env);
        return response.status(200).json({ ok: true, result });
      }

      return response.status(400).json({ ok: false, error: `Desteklenmeyen action: "${action}".` });
    } catch (error) {
      // ROOT review (PR #108): runDeepResearch/runOrchestration hata
      // mesajlarını KENDİLERİ zaten secret'lara karşı redakte eder (bkz.
      // src/deep-research/redact.js, src/orchestrator/redact.js) — ama bu
      // adaptör onların ARKASINDA kalan SON savunma hattıdır: beklenmeyen/
      // henüz redakte edilmemiş bir hata (örn. bu iki çekirdek fonksiyonun
      // dışında, adaptörün kendi kodunda oluşan bir hata) burada YAKALANIR
      // ve HEM tarayıcıya dönen yanıtta HEM log satırında (console.error'a
      // asla ham error/error.message VERİLMEZ) AYNI (zaten depoda var olan,
      // TEKRAR icat edilmeyen) redactSecrets() ile redakte edilir.
      const safeMessage = redactSecrets(error?.message ?? String(error), env);
      console.error(redactSecrets(error?.stack || safeMessage, env));
      return response.status(400).json({ ok: false, error: safeMessage });
    }
  };
}

export default createAiWorkspaceHandler();
