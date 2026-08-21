import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, buildLease, canProcess, clearLease, leaseIsStale, parseJsonNote } from "../src/lib/queue.js";

test("queue state is stored without destroying the user note", () => {
  const note = buildLease({ Not: "Müşteri için hazırlandı" }, "rec123", 10);
  const parsed = parseJsonNote(note);
  assert.equal(parsed.note, "Müşteri için hazırlandı");
  assert.equal(parsed.state.recordId, "rec123");
  assert.equal(leaseIsStale({ Not: note }), false);
  assert.equal(parseJsonNote(buildLease({}, "rec-empty")).state.recordId, "rec-empty");
});

test("stale publishing records can be recovered", () => {
  const stale = { Not: "Kayıt\n\n[BUZSU_SOCIAL_STATE]\n{\"leaseUntil\":\"2000-01-01T00:00:00.000Z\"}" };
  assert.equal(leaseIsStale(stale), true);
  assert.equal(canProcess({ Durum: "Yayınlanıyor", Not: stale.Not }), true);
});

test("active lease blocks a second run while keeping the approved status", () => {
  const leased = buildLease({ Not: "Onaylı kayıt" }, "rec-approved", 10);
  assert.equal(canProcess({ Durum: "Onaylandı", Not: leased }), false);
  assert.equal(canProcess({ Durum: "Onaylandı", Not: leased }, Date.now() + 11 * 60 * 1000), true);
});

test("events are bounded and clear lease", () => {
  let note = "";
  for (let i = 0; i < 40; i += 1) note = appendEvent({ Not: note }, { type: "test", index: i });
  const cleared = clearLease({ Not: note }, { type: "published" });
  const parsed = parseJsonNote(cleared);
  assert.equal(parsed.state.leaseUntil, undefined);
  assert.equal(parsed.state.events.length, 30);
  assert.equal(parsed.state.events.at(-1).type, "published");
});
