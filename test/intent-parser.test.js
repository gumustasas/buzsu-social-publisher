import test from "node:test";
import assert from "node:assert/strict";
import { matchProduct } from "../src/lib/intent-parser.js";

const products = [
  { id: "rec1", title: "UltraMag Apartman Tipi Manyetik Kireç Önleyici" },
  { id: "rec2", title: "Code Su Arıtma Cihazı | Gönderi" },
  { id: "rec3", title: "Buzsu Bardak Altlığı" }
];

test("matchProduct finds an exact match, ignoring an already-appended format suffix", () => {
  const match = matchProduct("Code Su Arıtma Cihazı", products);
  assert.equal(match.id, "rec2");
});

test("matchProduct finds a match via substring containment, case- and accent-insensitively", () => {
  const match = matchProduct("ultramag", products);
  assert.equal(match.id, "rec1");
});

test("matchProduct falls back to word-overlap scoring for a partial, reordered mention", () => {
  const match = matchProduct("apartman kireç önleyici", products);
  assert.equal(match.id, "rec1");
});

test("matchProduct returns null when nothing matches", () => {
  assert.equal(matchProduct("hiç alakasız bir cihaz", products), null);
});

test("matchProduct returns null for an empty query or empty product list", () => {
  assert.equal(matchProduct("", products), null);
  assert.equal(matchProduct("ultramag", []), null);
});
