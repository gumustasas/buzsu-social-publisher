import test from "node:test";
import assert from "node:assert/strict";
import { withinDays } from "../src/lib/insights.js";

const now = new Date("2026-08-22T15:00:00.000Z");

test("withinDays accepts a date within the window", () => {
  assert.equal(withinDays("2026-08-20T15:00:00.000Z", 7, now), true);
});

test("withinDays rejects a date older than the window", () => {
  assert.equal(withinDays("2026-08-10T15:00:00.000Z", 7, now), false);
});

test("withinDays rejects a future date", () => {
  assert.equal(withinDays("2026-08-25T15:00:00.000Z", 7, now), false);
});

test("withinDays rejects missing or invalid input", () => {
  assert.equal(withinDays("", 7, now), false);
  assert.equal(withinDays(undefined, 7, now), false);
  assert.equal(withinDays("not a date", 7, now), false);
});
