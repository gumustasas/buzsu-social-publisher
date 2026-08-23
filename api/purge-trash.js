import "dotenv/config";
import { getSession } from "../src/auth.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
const RETENTION_DAYS = 30;

function authorized(request) {
  const expected = process.env.CRON_SECRET;
  const header = request.headers.authorization || "";
  return Boolean(expected && header === `Bearer ${expected}`) || Boolean(getSession(request));
}

async function airtable(path = "", options = {}) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
}

// Panelden "Taslaklar"da silinen kayıtlar gerçekten silinmez, "Silinme
// Tarihi" alanı doldurularak çöp kutusuna taşınır (bkz. api/queue.js DELETE).
// Bu cron, RETENTION_DAYS'den eski çöp kutusu kayıtlarını Airtable'dan
// kalıcı olarak siler — kullanıcı geri almazsa "unutulanlar" böyle temizlenir.
export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    const data = await airtable("?pageSize=100");
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expired = (data.records || []).filter((record) => {
      const deletedAt = record.fields?.["Silinme Tarihi"];
      if (!deletedAt) return false;
      const ts = Date.parse(deletedAt);
      return !Number.isNaN(ts) && ts < cutoff;
    });
    for (const record of expired) {
      await airtable(`/${encodeURIComponent(record.id)}`, { method: "DELETE" });
    }
    return response.status(200).json({ ok: true, purged: expired.length });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
