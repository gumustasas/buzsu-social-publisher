import test from "node:test";
import assert from "node:assert/strict";
import { ORCHESTRATOR_STATES, assertValidTransition } from "../src/orchestrator/states.js";

test("ORCHESTRATOR_STATES manifest'in required_states listesiyle BİREBİR aynı 6 durumu içerir", () => {
  assert.deepEqual(ORCHESTRATOR_STATES, ["pending", "running", "waiting_for_confirmation", "completed", "failed", "blocked"]);
});

test("assertValidTransition: pending -> running ve pending -> blocked geçerlidir", () => {
  assert.equal(assertValidTransition("pending", "running"), "running");
  assert.equal(assertValidTransition("pending", "blocked"), "blocked");
});

test("assertValidTransition: running -> completed/failed/waiting_for_confirmation geçerlidir", () => {
  assert.equal(assertValidTransition("running", "completed"), "completed");
  assert.equal(assertValidTransition("running", "failed"), "failed");
  assert.equal(assertValidTransition("running", "waiting_for_confirmation"), "waiting_for_confirmation");
});

test("assertValidTransition: terminal durumlardan (completed/failed/blocked/waiting_for_confirmation) HİÇBİR yere geçiş yoktur", () => {
  for (const terminal of ["completed", "failed", "blocked", "waiting_for_confirmation"]) {
    for (const target of ORCHESTRATOR_STATES) {
      assert.throws(() => assertValidTransition(terminal, target), /Geçersiz durum geçişi/);
    }
  }
});

test("assertValidTransition: pending -> completed/failed/waiting_for_confirmation gibi 'running' atlanan geçişler reddedilir", () => {
  assert.throws(() => assertValidTransition("pending", "completed"), /Geçersiz durum geçişi/);
  assert.throws(() => assertValidTransition("pending", "failed"), /Geçersiz durum geçişi/);
  assert.throws(() => assertValidTransition("pending", "waiting_for_confirmation"), /Geçersiz durum geçişi/);
});

test("assertValidTransition: bilinmeyen bir durum adı (from veya to) açık bir hata fırlatır", () => {
  assert.throws(() => assertValidTransition("made_up_state", "running"), /Bilinmeyen orkestratör durumu/);
  assert.throws(() => assertValidTransition("pending", "made_up_state"), /Bilinmeyen orkestratör durumu/);
});
