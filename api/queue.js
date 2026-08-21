import "dotenv/config";
import { appendEvent, parseJsonNote } from "../src/lib/queue.js";
import { summarizeRecords } from "../src/lib/metrics.js";
import { getSession } from "../src/auth.js";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";

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

function publicRecord(record) {
  const fields = record.fields || {};
  const state = parseJsonNote(fields.Not).state;
  const allEvents = Array.isArray(state.events) ? state.events : [];
  const lastStatusEvent = [...allEvents].reverse().find((event) => event.type === "status_changed" && event.to);
  const effectiveStatus = lastStatusEvent?.to || fields.Durum || "Taslak";
  return {
    id: record.id,
    title: fields["Başlık"] || "Başlıksız içerik",
    status: effectiveStatus,
    format: fields["Yayın Biçimi"] || "Gönderi",
    platforms: fields.Platform || [],
    publishAt: fields["Yayın Zamanı"] || null,
    sourceUrl: fields["Kaynak URL"] || "",
    imageUrl: fields["Görsel URL"] || "",
    instagramText: fields["Instagram Metni"] || "",
    facebookText: fields["Facebook Metni"] || "",
    attempts: Number(fields["Deneme Sayısı"] || 0),
    instagramId: fields["Instagram Yayın ID"] || "",
    facebookId: fields["Facebook Yayın ID"] || "",
    isArchived: fields.Durum === "Paylaşıldı" || Boolean(fields["Instagram Yayın ID"] || fields["Facebook Yayın ID"]),
    error: fields["Hata Mesajı"] || "",
    note: fields.Not || "",
    isStopped: effectiveStatus === "Durduruldu",
    events: allEvents.slice(-5).reverse()
  };
}

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    if (request.method === "GET") {
      const data = await airtable("?pageSize=100");
      const records = (data.records || []).map(publicRecord).sort((a, b) => String(a.publishAt || "").localeCompare(String(b.publishAt || "")));
      return response.status(200).json({ ok: true, records, summary: summarizeRecords(data.records || []) });
    }
    if (request.method === "DELETE") {
      const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
      if (!ids.length || ids.length > 50) return response.status(400).json({ error: "Silinecek kayıt seçin (en fazla 50)." });
      const records = await Promise.all(ids.map((id) => airtable(`/${encodeURIComponent(id)}`)));
      const deletable = records.every((record) => {
        const fields = record.fields || {};
        return fields.Durum === "Taslak" || fields.Durum === "Paylaşıldı" || Boolean(fields["Instagram Yayın ID"] || fields["Facebook Yayın ID"]);
      });
      if (!deletable) return response.status(409).json({ error: "Yalnızca taslak veya arşiv/çöp kutusundaki kayıtlar silinebilir." });
      await Promise.all(ids.map((id) => airtable(`/${encodeURIComponent(id)}`, { method: "DELETE" })));
      return response.status(200).json({ ok: true, deleted: ids.length });
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST, DELETE");
      return response.status(405).json({ error: "Method not allowed" });
    }
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const allowed = new Set(["Taslak", "Kontrol Edilecek", "Onaylandı", "Durduruldu"]);
    if (body.status !== undefined && !allowed.has(body.status)) return response.status(400).json({ error: "Geçersiz onay durumu" });
    if (body.publishAt !== undefined && (typeof body.publishAt !== "string" || Number.isNaN(Date.parse(body.publishAt)))) return response.status(400).json({ error: "Geçersiz yayın zamanı" });
    if (body.status === undefined && body.publishAt === undefined) return response.status(400).json({ error: "Güncellenecek alan yok" });
    const record = await airtable(`/${encodeURIComponent(body.id)}`);
    const nextFields = {};
    const event = { type: body.status !== undefined ? "status_changed" : "schedule_changed" };
    if (body.status !== undefined) { nextFields.Durum = body.status === "Durduruldu" ? "Taslak" : body.status; event.from = record.fields?.Durum || "Taslak"; event.to = body.status; }
    if (body.publishAt !== undefined) { nextFields["Yayın Zamanı"] = body.publishAt; event.publishAt = body.publishAt; }
    const nextNote = appendEvent(record.fields || {}, event);
    nextFields.Not = nextNote;
    if (body.status === "Onaylandı") nextFields["Hata Mesajı"] = "";
    await airtable(`/${encodeURIComponent(body.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: nextFields })
    });
    return response.status(200).json({ ok: true, id: body.id, status: body.status, publishAt: body.publishAt });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
