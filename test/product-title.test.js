import test from "node:test";
import assert from "node:assert/strict";
import { baseProductTitle } from "../src/lib/product-title.js";

test("baseProductTitle keeps a clean title unchanged", () => {
  assert.equal(baseProductTitle("Code Su Arıtma Cihazı"), "Code Su Arıtma Cihazı");
});

test("baseProductTitle strips one or many accumulated format suffixes", () => {
  assert.equal(baseProductTitle("Code Su Arıtma Cihazı | Hikâye"), "Code Su Arıtma Cihazı");
  assert.equal(baseProductTitle("Code Su Arıtma Cihazı | Hikâye 1 | Hikâye | Hikâye | Gönderi | Gönderi"), "Code Su Arıtma Cihazı");
});

test("baseProductTitle returns an empty string (not \"undefined\") for missing input", () => {
  assert.equal(baseProductTitle(undefined), "");
  assert.equal(baseProductTitle(null), "");
  assert.equal(baseProductTitle(""), "");
});
