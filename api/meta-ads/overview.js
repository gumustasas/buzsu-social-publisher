import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { getOverview, errorToApiShape } from "../../src/lib/meta-connect.js";

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

  try {
    const overview = await getOverview();
    return response.status(200).json({ ok: true, overview });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
