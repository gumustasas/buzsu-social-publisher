import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRecords } from "../src/lib/metrics.js";
import { serializeJsonNote } from "../src/lib/queue.js";

test("metrics summarize platform results and upcoming work", () => {
  const records = [
    { id: "one", fields: { Durum: "Paylaşıldı", "Instagram Yayın ID": "ig1", "Facebook Yayın ID": "fb1", "Deneme Sayısı": 1 } },
    { id: "two", fields: { Durum: "Onaylandı", "Yayın Zamanı": "2030-01-01T00:00:00.000Z", "Deneme Sayısı": 2 } },
    { id: "three", fields: { Durum: "Hata", Not: serializeJsonNote("", { events: [{ at: "2026-01-01T00:00:00.000Z", type: "failed" }] }) } }
  ];
  const summary = summarizeRecords(records, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(summary.total, 3);
  assert.equal(summary.instagramPublished, 1);
  assert.equal(summary.facebookPublished, 1);
  assert.equal(summary.upcoming, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.lastEvents[0].type, "failed");
});

test("retrying only counts records still active in the pipeline (Onaylandı/Yayınlanıyor) with more than one attempt", () => {
  const records = [
    // Aktif olarak yeniden deneniyor — sayılmalı.
    { id: "active-retry", fields: { Durum: "Onaylandı", "Deneme Sayısı": 2 } },
    { id: "active-retry-publishing", fields: { Durum: "Yayınlanıyor", "Deneme Sayısı": 3 } },
    // "Hata" durumundaki kayıt zaten "failed"e sayılıyor — "retrying"e de
    // eklenirse aynı kayıt iki kez sayılmış olur.
    { id: "failed-with-attempts", fields: { Durum: "Hata", "Deneme Sayısı": 2 } },
    // Geçmişte yeniden denenip başarıyla yayınlanmış bir kayıt artık "tekrar
    // deniyor" değildir.
    { id: "resolved", fields: { Durum: "Paylaşıldı", "Deneme Sayısı": 2 } },
    // Hiç denenmemiş (Deneme Sayısı<=1) kayıt sayılmamalı.
    { id: "fresh", fields: { Durum: "Onaylandı", "Deneme Sayısı": 1 } }
  ];
  const summary = summarizeRecords(records, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(summary.retrying, 2);
  assert.equal(summary.failed, 1);
});
