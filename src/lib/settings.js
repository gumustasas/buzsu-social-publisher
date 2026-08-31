// "Ayarlar" tablosundaki tek "Otomatik Pilot" satırını okur/yazar. İçerik
// kuyruğuyla (Sosyal Medya Takvimi) karışmasın diye panel geneli ayarlar
// bilinçli olarak ayrı, küçük bir tabloda tutulur — bu tablo elle
// oluşturuldu, tek satırı var ve id'si sabit.
import {
  AIRTABLE_BASE_ID as baseId,
  AIRTABLE_SETTINGS_TABLE_ID as tableId,
  AIRTABLE_AUTOPILOT_RECORD_ID as AUTOPILOT_RECORD_ID
} from "./config.js";

async function airtableRequest(path = "", options = {}) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
}

export async function getAutopilotEnabled() {
  const data = await airtableRequest(`/${AUTOPILOT_RECORD_ID}`);
  return Boolean(data.fields?.["Açık"]);
}

export async function setAutopilotEnabled(enabled) {
  await airtableRequest(`/${AUTOPILOT_RECORD_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Açık": Boolean(enabled) } })
  });
}

export async function touchAutopilotRun(note) {
  await airtableRequest(`/${AUTOPILOT_RECORD_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Son Çalışma": new Date().toISOString(), ...(note ? { Not: note } : {}) } })
  });
}
