import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { getAdCreativeAssets, errorToApiShape } from "../../src/lib/meta-connect.js";

function authorized(request) {
  return Boolean(getSession(request));
}

export default async function handler(request, response) {
  if (!authorized(request)) {
    return response.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } });
  }
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Yalnız GET desteklenir." } });
  }

  const adId = typeof request.query?.ad_id === "string" ? request.query.ad_id.trim() : "";
  if (!adId) {
    return response.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "ad_id gerekli." } });
  }

  try {
    const creative = await getAdCreativeAssets(adId);
    return response.status(200).json({ ok: true, creative });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
