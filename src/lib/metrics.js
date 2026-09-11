import { parseJsonNote } from "./queue.js";

export function summarizeRecords(records, now = new Date()) {
  const summary = {
    total: records.length,
    byStatus: {},
    instagramPublished: 0,
    facebookPublished: 0,
    failed: 0,
    retrying: 0,
    upcoming: 0,
    due: 0,
    lastEvents: []
  };
  for (const record of records) {
    const fields = record.fields || {};
    const status = fields.Durum || "Taslak";
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    if (fields["Instagram Yayın ID"]) summary.instagramPublished += 1;
    if (fields["Facebook Yayın ID"]) summary.facebookPublished += 1;
    if (status === "Hata") summary.failed += 1;
    // Yalnızca hâlâ aktif akışta olan (Onaylandı/Yayınlanıyor) ve önceden en
    // az bir kez denenmiş kayıtlar "tekrar deniyor" sayılır. Durum filtresi
    // olmadan (önceki hâl) bu sayaç hem "Hata" kayıtlarını failed'e ek olarak
    // ikinci kez sayıyor hem de artık başarıyla yayınlanmış (Paylaşıldı) veya
    // hiç ilerlememiş eski kayıtları da "tekrar deniyor" gösteriyordu.
    if ((status === "Onaylandı" || status === "Yayınlanıyor") && Number(fields["Deneme Sayısı"] || 0) > 1) summary.retrying += 1;
    const publishAt = fields["Yayın Zamanı"] ? new Date(fields["Yayın Zamanı"]) : null;
    if (publishAt && !Number.isNaN(publishAt.getTime())) {
      if (publishAt > now) summary.upcoming += 1;
      else if (status === "Onaylandı" || status === "Yayınlanıyor") summary.due += 1;
    }
    const { state } = parseJsonNote(fields.Not);
    for (const event of state.events || []) {
      summary.lastEvents.push({ recordId: record.id, title: fields["Başlık"] || record.id, ...event });
    }
  }
  summary.lastEvents.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  summary.lastEvents = summary.lastEvents.slice(0, 10);
  return summary;
}
