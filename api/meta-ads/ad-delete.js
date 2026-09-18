import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { deleteAd, errorToApiShape } from "../../src/lib/meta-connect.js";

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
  if (!adId) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "ad_id gerekli." } });
  }
  // Frontend'in iki tıklamalı UI onayından sonra gönderdiği açık niyet sinyali.
  // Bu, MCP'nin confirmed=true'sunun yerini TUTMAZ — asıl PAUSED-only guard
  // ads_delete_ad'ın kendisinde kalır (bkz. src/lib/meta-connect.js:deleteAd).
  // Silme kalıcıdır; bu kontrol PR-3'ün durum/bütçe route'larıyla birebir aynı
  // şekilde, istemciden hiçbir "confirmed" alanı kabul etmeden uygulanır.
  if (body.confirm !== true) {
    return response.status(400).json({ ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "confirm:true gerekli." } });
  }

  try {
    const result = await deleteAd(adId);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
