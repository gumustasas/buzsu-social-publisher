import test from "node:test";
import assert from "node:assert/strict";
import { withinDays, summarizeEngagementByDaypart } from "../src/lib/insights.js";

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

test("summarizeEngagementByDaypart always returns all 5 dayparts, even with no data", () => {
  const { byDaypart, best, sampleSize } = summarizeEngagementByDaypart([]);
  assert.equal(byDaypart.length, 5);
  assert.deepEqual(byDaypart.map((p) => p.key), ["morning", "midday", "afternoon", "evening", "night"]);
  assert.ok(byDaypart.every((p) => p.count === 0 && p.avgEngagement === 0));
  assert.equal(best, null);
  assert.equal(sampleSize, 0);
});

test("summarizeEngagementByDaypart buckets by Europe/Istanbul local hour (UTC+3) and averages per bucket", () => {
  const result = summarizeEngagementByDaypart([
    { publishAt: "2026-08-20T05:00:00.000Z", engagement: 10 }, // 08:00 Istanbul -> morning
    { publishAt: "2026-08-20T05:30:00.000Z", engagement: 20 }, // 08:30 Istanbul -> morning
    { publishAt: "2026-08-20T16:00:00.000Z", engagement: 100 } // 19:00 Istanbul -> evening
  ]);
  const morning = result.byDaypart.find((p) => p.key === "morning");
  const evening = result.byDaypart.find((p) => p.key === "evening");
  assert.equal(morning.count, 2);
  assert.equal(morning.avgEngagement, 15);
  assert.equal(evening.count, 1);
  assert.equal(evening.avgEngagement, 100);
  assert.equal(result.best.key, "evening");
  assert.equal(result.sampleSize, 3);
});

test("summarizeEngagementByDaypart wraps the night bucket across midnight", () => {
  const result = summarizeEngagementByDaypart([{ publishAt: "2026-08-20T22:00:00.000Z", engagement: 5 }]); // 01:00 Istanbul -> night
  const night = result.byDaypart.find((p) => p.key === "night");
  assert.equal(night.count, 1);
  assert.equal(result.best.key, "night");
});

test("summarizeEngagementByDaypart ignores entries with missing or invalid publishAt", () => {
  const result = summarizeEngagementByDaypart([{ publishAt: "", engagement: 5 }, { engagement: 5 }, { publishAt: "not a date", engagement: 5 }]);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.best, null);
});
