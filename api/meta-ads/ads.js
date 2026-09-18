import "dotenv/config";
import { getSession } from "../../src/auth.js";
import { listAllAds, listAllCampaigns, listAllAdSets, errorToApiShape } from "../../src/lib/meta-connect.js";

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
    const status = typeof request.query?.status === "string" ? request.query.status.trim().toUpperCase() : "";
    const search = typeof request.query?.q === "string" ? request.query.q.trim().toLocaleLowerCase("tr-TR") : "";

    // Meta/MCP tarafında server-side bir status/arama filtresi yok — bu yüzden
    // tüm sayfalar önce eksiksiz toplanır, filtre en son ve tam veri üzerinde uygulanır.
    // Reklam listesi zorunlu veri; campaign/adset isimleri "nice to have" — biri
    // başarısız olursa reklam listesini boş isimle gösteririz, tamamen düşürmeyiz.
    const [adsSettled, campaignsSettled, adsetsSettled] = await Promise.allSettled([
      listAllAds(),
      listAllCampaigns(),
      listAllAdSets()
    ]);
    if (adsSettled.status === "rejected") throw adsSettled.reason;

    const campaignNameById = new Map(
      (campaignsSettled.status === "fulfilled" ? campaignsSettled.value : []).map((campaign) => [campaign.id, campaign.name ?? ""])
    );
    const adsetNameById = new Map(
      (adsetsSettled.status === "fulfilled" ? adsetsSettled.value : []).map((adset) => [adset.id, adset.name ?? ""])
    );

    const ads = adsSettled.value
      .map((ad) => ({
        id: ad.id ?? "",
        name: ad.name ?? "",
        status: ad.status ?? "",
        effective_status: ad.effective_status ?? "",
        campaign_id: ad.campaign_id ?? "",
        campaign_name: campaignNameById.get(ad.campaign_id) ?? "",
        adset_id: ad.adset_id ?? "",
        adset_name: adsetNameById.get(ad.adset_id) ?? "",
        creative_id: ad.creative?.id ?? ""
      }))
      .filter((ad) => !status || ad.status === status || ad.effective_status === status)
      .filter((ad) => !search || ad.name.toLocaleLowerCase("tr-TR").includes(search) || ad.id.includes(search));

    return response.status(200).json({ ok: true, ads });
  } catch (error) {
    console.error(error);
    const apiError = errorToApiShape(error);
    return response.status(apiError.code === "MCP_TIMEOUT" ? 504 : 502).json({ ok: false, error: apiError });
  }
}
