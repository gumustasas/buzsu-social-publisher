import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { updateAdSetBudget, errorToApiShape } from "../../src/lib/meta-connect.js";

// ads_update_adset_budget tool'unun kendi zod sınırlarıyla aynı (1-100000 TRY) —
// burada erken doğrulamak gereksiz bir MCP round-trip'ini önler; asıl doğrulama
// (2 ondalık, güvenli tamsayı vb.) yine de tryToMinorUnits() içinde, connector'da.
const MIN_BUDGET_TRY = 1;
const MAX_BUDGET_TRY = 100000;

export default async function handler(request, response) {
  const session = getSession(request);
  if (!session) {
    return response.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } });
  }
  if (session.role !== "Admin") {
    return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Bu işlem için Admin yetkisi gerekli." } });
  }
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Yalnız POST desteklenir." } });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const adsetId = typeof body.adset_id === "string" ? body.adset_id.trim() : "";
  const dailyBudgetTry = Number(body.daily_budget_try);
  if (!adsetId) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "adset_id gerekli." } });
  }
  if (!Number.isFinite(dailyBudgetTry) || dailyBudgetTry < MIN_BUDGET_TRY || dailyBudgetTry > MAX_BUDGET_TRY) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: `daily_budget_try ${MIN_BUDGET_TRY}-${MAX_BUDGET_TRY} arasında bir sayı olmalı.` } });
  }

  try {
    const result = await updateAdSetBudget(adsetId, dailyBudgetTry);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
