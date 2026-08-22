import test from "node:test";
import assert from "node:assert/strict";
import { ga4Configured, normalizePrivateKey } from "../src/lib/ga4.js";

test("ga4Configured requires all three env vars", () => {
  assert.equal(ga4Configured({}), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "289526828" }), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "289526828", GA4_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com" }), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "289526828", GA4_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com", GA4_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----" }), true);
});

test("normalizePrivateKey converts literal \\n escape sequences to real newlines", () => {
  const raw = "-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----\\n";
  assert.equal(normalizePrivateKey(raw), "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n");
});

test("normalizePrivateKey fixes iOS smart-punctuation dashes back to plain hyphens", () => {
  // iOS Safari bazen art arda tireleri em/en dash'e çeviriyor (bkz. "—" U+2014, "–" U+2013).
  const corrupted = "—————BEGIN PRIVATE KEY—————\\nMIIE\\n—————END PRIVATE KEY—————\\n";
  const normalized = normalizePrivateKey(corrupted);
  assert.match(normalized, /^-----BEGIN PRIVATE KEY-----/);
  assert.match(normalized, /-----END PRIVATE KEY-----\n$/);
  assert.doesNotMatch(normalized, /[‐-―]/);
});

test("normalizePrivateKey strips accidentally-included surrounding quotes and whitespace", () => {
  assert.equal(normalizePrivateKey('  "-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----\\n"  '), "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n");
});
