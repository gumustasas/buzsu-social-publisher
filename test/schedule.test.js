import test from "node:test";
import assert from "node:assert/strict";
import { publicationFormat, selectDueRecords, slugify, withUtm } from "../src/lib/schedule.js";

test("only records with a due new publish time are selected", () => {
  const records = [
    { id: "old-text-only", fields: { "Yayın Tarihi": "2026-08-19 09:00" } },
    { id: "future", fields: { "Yayın Zamanı": "2026-08-19T12:00:00.000Z" } },
    { id: "due", fields: { "Yayın Zamanı": "2026-08-19T08:00:00.000Z" } }
  ];
  assert.deepEqual(selectDueRecords(records, new Date("2026-08-19T09:00:00.000Z"), 10).map((r) => r.id), ["due"]);
});

test("due records are sorted and limited", () => {
  const records = [
    { id: "second", fields: { "Yayın Zamanı": "2026-08-19T08:30:00.000Z" } },
    { id: "first", fields: { "Yayın Zamanı": "2026-08-19T08:00:00.000Z" } }
  ];
  assert.deepEqual(selectDueRecords(records, new Date("2026-08-19T09:00:00.000Z"), 1).map((r) => r.id), ["first"]);
});

test("publication format defaults to a normal post", () => {
  assert.equal(publicationFormat({}), "Gönderi");
  assert.equal(publicationFormat({ "Yayın Biçimi": "Hikâye" }), "Hikâye");
});

test("UTM links preserve the product URL and identify the campaign", () => {
  assert.equal(
    withUtm("https://www.buzsu.com.tr/code-su-aritma-cihazi/", { source: "facebook", title: "Code Su Arıtma Cihazı" }),
    "https://www.buzsu.com.tr/code-su-aritma-cihazi/?utm_source=facebook&utm_medium=organic_social&utm_campaign=buzsu-code-su-aritma-cihazi"
  );
  assert.equal(slugify("UltraMag | Kireç Önleyici"), "ultramag-kirec-onleyici");
});
