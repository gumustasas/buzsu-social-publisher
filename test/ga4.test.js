import test from "node:test";
import assert from "node:assert/strict";
import { ga4Configured } from "../src/lib/ga4.js";

test("ga4Configured requires all three env vars", () => {
  assert.equal(ga4Configured({}), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "289526828" }), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "289526828", GA4_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com" }), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "289526828", GA4_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com", GA4_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----" }), true);
});
