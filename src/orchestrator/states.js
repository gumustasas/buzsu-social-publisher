// TASK-007: manifest'in required_states listesiyle BİREBİR aynı 6 durum —
// hem run (koşu) hem de tek bir step (adım) için AYNI küme kullanılır.
// "pending"/"running" senkron yürütmede yalnızca GEÇİŞ anlarında var olur
// (runOrchestration senkron döndüğü için nihai yanıtta hiçbir zaman
// gözlemlenmezler) — ama state machine'in KENDİSİ bu durumları GERÇEKTEN
// modeller ve geçişler assertValidTransition ile DOĞRULANIR; bu, "pending"/
// "running" durumlarının kağıt üzerinde var olan ama hiç kullanılmayan
// ölü kod olmasını önler (bkz. test/orchestrator-states.test.js).
export const ORCHESTRATOR_STATES = [
  "pending",
  "running",
  "waiting_for_confirmation",
  "completed",
  "failed",
  "blocked"
];

const STATE_SET = new Set(ORCHESTRATOR_STATES);

// Bilinçli olarak KÜÇÜK ve SABİT bir geçiş tablosu — yeni bir geçiş türü
// eklemek isteyen bir kod yolu burada AÇIKÇA görünür olmalı, keyfi bir
// "her durumdan her duruma" geçişe İZİN VERİLMEZ (deterministik state
// machine ilkesi). Terminal durumlardan (completed/failed/blocked/
// waiting_for_confirmation) hiçbir yere geçiş YOKTUR — bu sürüm bir run'ı
// yeniden başlatmaz/devam ettirmez, her runOrchestration çağrısı sıfırdan
// pending'te başlar.
const ALLOWED_TRANSITIONS = {
  pending: ["running", "blocked"],
  running: ["completed", "failed", "waiting_for_confirmation"],
  waiting_for_confirmation: [],
  completed: [],
  failed: [],
  blocked: []
};

export function assertValidTransition(from, to) {
  if (!STATE_SET.has(from)) throw new Error(`Bilinmeyen orkestratör durumu: "${from}".`);
  if (!STATE_SET.has(to)) throw new Error(`Bilinmeyen orkestratör durumu: "${to}".`);
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Geçersiz durum geçişi: "${from}" -> "${to}".`);
  }
  return to;
}
