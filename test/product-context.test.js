import test from "node:test";
import assert from "node:assert/strict";
import { slugFromUrl, findMatchIndex } from "../src/lib/product-context.js";

test("slugFromUrl extracts the last path segment", () => {
  assert.equal(slugFromUrl("https://www.buzsu.com.tr/code-su-aritma-cihazi/"), "code-su-aritma-cihazi");
  assert.equal(slugFromUrl("https://www.buzsu.com.tr/1-inch-manyetik-kirec-onleyici-apartman-tipi/"), "1-inch-manyetik-kirec-onleyici-apartman-tipi");
});

test("slugFromUrl returns an empty string for an invalid URL instead of throwing", () => {
  assert.equal(slugFromUrl("not a url"), "");
  assert.equal(slugFromUrl(""), "");
});

test("findMatchIndex tries candidates in order and returns the first match, case-insensitively", () => {
  const text = "...bazı içerik... UltraMag Apartman Tipi Manyetik Kireç Önleyici boru hattına takılır...";
  assert.equal(findMatchIndex(text, ["https://no-match.example/", "ultramag apartman tipi manyetik kireç önleyici"]), text.toLocaleLowerCase("tr-TR").indexOf("ultramag apartman tipi manyetik kireç önleyici"));
});

test("findMatchIndex returns -1 when nothing matches", () => {
  assert.equal(findMatchIndex("alakasız metin", ["Code Advantage", "code-su-aritma-cihazi"]), -1);
});
