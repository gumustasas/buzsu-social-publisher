import "dotenv/config";
import { getSession } from "../src/auth.js";
import { listRawRecords } from "../src/lib/products.js";
import { fetchInstagramEngagement, fetchFacebookEngagement, withinDays } from "../src/lib/insights.js";

function authorized(request) { return Boolean(getSession(request)); }

// Meta'nın hız limitini zorlamamak için tek çağrıda en fazla bu kadar
// yayınlanmış kayıt işlenir; küçük bir işletme için son 7 günde bu sayıyı
// aşacak kadar gönderi olması beklenmez.
const MAX_RECORDS = 20;

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
    if (!process.env.META_ACCESS_TOKEN) return response.status(200).json({ ok: true, connected: false });

    const records = await listRawRecords();
    const published = records
      .filter((record) => record.fields?.Durum === "Paylaşıldı" && withinDays(record.fields?.["Yayın Zamanı"], 7))
      .slice(0, MAX_RECORDS);

    let likes = 0, comments = 0, shares = 0, failures = 0;
    for (const record of published) {
      const fields = record.fields || {};
      if (fields["Instagram Yayın ID"]) {
        try {
          const result = await fetchInstagramEngagement(fields["Instagram Yayın ID"], process.env);
          likes += result.likes; comments += result.comments;
        } catch { failures += 1; }
      }
      if (fields["Facebook Yayın ID"]) {
        try {
          const result = await fetchFacebookEngagement(fields["Facebook Yayın ID"], process.env);
          likes += result.likes; comments += result.comments; shares += result.shares;
        } catch { failures += 1; }
      }
    }

    return response.status(200).json({ ok: true, connected: true, weekly: { likes, comments, shares, posts: published.length, failures } });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
