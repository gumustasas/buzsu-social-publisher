import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { createAndBindAdCreative, errorToApiShape } from "../../src/lib/meta-connect.js";

// ads_create_ad_creative şemasıyla birebir aynı enum.
const VALID_CTAS = new Set(["LEARN_MORE", "SHOP_NOW", "GET_QUOTE", "CONTACT_US", "SIGN_UP", "GET_OFFER", "SUBSCRIBE"]);
const REQUIRED_STRING_FIELDS = ["ad_id", "name", "message", "headline", "link", "call_to_action_type"];

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
  const fields = {};
  for (const key of REQUIRED_STRING_FIELDS) {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (!value) return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: `${key} gerekli.` } });
    fields[key] = value;
  }
  if (!VALID_CTAS.has(fields.call_to_action_type)) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "call_to_action_type geçersiz." } });
  }
  // image_url burada BİLEREK okunmuyor/kabul edilmiyor — bu ekran yalnızca
  // reklamın mevcut kartlarından gelen bir image_hash'i yeniden kullanır
  // (bkz. src/lib/meta-connect.js:createAdCreative). Yeni görsel yükleme
  // (upload_ad_image) bu ilk sürümün kapsamı dışında.
  const imageHash = typeof body.image_hash === "string" ? body.image_hash.trim() : "";
  if (!imageHash) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "image_hash gerekli — bu ekran yalnız mevcut bir görseli yeniden kullanır." } });
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const instagramUserId = typeof body.instagram_user_id === "string" ? body.instagram_user_id.trim() : "";

  // Frontend'in iki tıklamalı UI onayından sonra gönderdiği açık niyet sinyali —
  // PR-3'ün durum/bütçe route'larıyla birebir aynı sözleşme. İstemciden bir
  // "confirmed" alanı burada hiç okunmaz; MCP'ye gönderilecek confirmed:true
  // her zaman src/lib/meta-connect.js içinde sunucu tarafında sabitlenir.
  if (body.confirm !== true) {
    return response.status(400).json({ ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "confirm:true gerekli." } });
  }

  try {
    const result = await createAndBindAdCreative(fields.ad_id, {
      name: fields.name,
      message: fields.message,
      headline: fields.headline,
      link: fields.link,
      call_to_action_type: fields.call_to_action_type,
      image_hash: imageHash,
      ...(description ? { description } : {}),
      ...(instagramUserId ? { instagram_user_id: instagramUserId } : {})
    });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
