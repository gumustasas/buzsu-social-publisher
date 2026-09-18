import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { setAdStatus, errorToApiShape } from "../../src/lib/meta-connect.js";

const VALID_STATUSES = new Set(["ACTIVE", "PAUSED"]);

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
  const adId = typeof body.ad_id === "string" ? body.ad_id.trim() : "";
  const status = body.status;
  if (!adId) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "ad_id gerekli." } });
  }
  if (!VALID_STATUSES.has(status)) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "status ACTIVE veya PAUSED olmalı." } });
  }
  // Frontend'in iki tıklamalı UI onayından sonra gönderdiği açık niyet sinyali.
  // Bu, MCP'nin confirmed=true'sunun yerini TUTMAZ (browser hâlâ o alanı hiç
  // görmez/kontrol etmez) — yalnız Social Publisher'ın kendi HTTP sözleşmesinde
  // kazara/otomatik bir çağrının sessizce yazma yapmasını önler.
  if (body.confirm !== true) {
    return response.status(400).json({ ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "confirm:true gerekli." } });
  }

  try {
    const result = await setAdStatus(adId, status);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
