import test from "node:test";
import assert from "node:assert/strict";
import { pickNextProduct } from "../src/lib/autopilot.js";

const products = [
  { id: "rec1", title: "UltraMag", url: "https://www.buzsu.com.tr/ultramag/", imageUrl: "https://www.buzsu.com.tr/ultramag.png" },
  { id: "rec2", title: "Code Su Arıtma Cihazı", url: "https://www.buzsu.com.tr/code/", imageUrl: "https://www.buzsu.com.tr/code.png" },
  { id: "llms:x", title: "Fotoğrafsız Katalog Ürünü", url: "https://www.buzsu.com.tr/yeni-urun/", imageUrl: "" }
];

test("pickNextProduct prefers a product that has never been featured over one that has", () => {
  const records = [{ createdTime: "2026-08-20T10:00:00.000Z", fields: { "Kaynak URL": "https://www.buzsu.com.tr/code/" } }];
  const picked = pickNextProduct(products, records);
  assert.equal(picked.id, "rec1");
});

test("pickNextProduct picks the least-recently-featured product when all have history", () => {
  const records = [
    { createdTime: "2026-08-20T10:00:00.000Z", fields: { "Kaynak URL": "https://www.buzsu.com.tr/code/" } },
    { createdTime: "2026-08-10T10:00:00.000Z", fields: { "Kaynak URL": "https://www.buzsu.com.tr/ultramag/" } }
  ];
  const picked = pickNextProduct(products, records);
  assert.equal(picked.id, "rec1");
});

test("pickNextProduct only considers the most recent record per product", () => {
  const records = [
    { createdTime: "2026-08-01T10:00:00.000Z", fields: { "Kaynak URL": "https://www.buzsu.com.tr/ultramag/" } },
    { createdTime: "2026-08-21T10:00:00.000Z", fields: { "Kaynak URL": "https://www.buzsu.com.tr/ultramag/" } },
    { createdTime: "2026-08-15T10:00:00.000Z", fields: { "Kaynak URL": "https://www.buzsu.com.tr/code/" } }
  ];
  const picked = pickNextProduct(products, records);
  assert.equal(picked.id, "rec2");
});

test("pickNextProduct skips catalog products without a usable reference photo", () => {
  const onlyPhotoless = [products[2]];
  assert.equal(pickNextProduct(onlyPhotoless, []), null);
});

test("pickNextProduct returns null when there are no candidate products", () => {
  assert.equal(pickNextProduct([], []), null);
  assert.equal(pickNextProduct(null, null), null);
});
