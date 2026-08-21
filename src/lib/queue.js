const ACTIVE_STATUSES = new Set(["Taslak", "Kontrol Edilecek", "Onaylandı", "Yayınlanıyor", "Hata", "Durduruldu", "Paylaşıldı"]);

export function parseJsonNote(value) {
  if (!value) return { note: "", state: {} };
  const text = String(value);
  const marker = "\n\n[BUZSU_SOCIAL_STATE]\n";
  const index = text.indexOf(marker);
  if (index < 0) return { note: text, state: {} };
  try {
    return { note: text.slice(0, index), state: JSON.parse(text.slice(index + marker.length)) };
  } catch {
    return { note: text, state: {} };
  }
}

export function serializeJsonNote(note, state) {
  const cleanNote = String(note || "").replace(/\n\n\[BUZSU_SOCIAL_STATE\]\n[\s\S]*$/, "").trim();
  return `${cleanNote}\n\n[BUZSU_SOCIAL_STATE]\n${JSON.stringify(state)}`;
}

export function appendEvent(fields, event) {
  const parsed = parseJsonNote(fields.Not);
  const events = Array.isArray(parsed.state.events) ? parsed.state.events : [];
  const next = {
    ...parsed.state,
    events: [...events, { at: new Date().toISOString(), ...event }].slice(-30)
  };
  return serializeJsonNote(parsed.note, next);
}

export function leaseIsStale(fields, now = Date.now()) {
  const { state } = parseJsonNote(fields.Not);
  return Boolean(state.leaseUntil && Date.parse(state.leaseUntil) <= now);
}

export function canProcess(fields, now = Date.now()) {
  const status = fields.Durum || "Taslak";
  if (status === "Onaylandı") return !parseJsonNote(fields.Not).state.leaseUntil || leaseIsStale(fields, now);
  return status === "Yayınlanıyor" && leaseIsStale(fields, now);
}

export function buildLease(fields, recordId, leaseMinutes = 10) {
  const parsed = parseJsonNote(fields.Not);
  const state = {
    ...parsed.state,
    recordId,
    leaseUntil: new Date(Date.now() + leaseMinutes * 60 * 1000).toISOString()
  };
  return serializeJsonNote(parsed.note, state);
}

export function clearLease(fields, event) {
  const parsed = parseJsonNote(fields.Not);
  const state = { ...parsed.state };
  delete state.leaseUntil;
  delete state.recordId;
  const events = Array.isArray(state.events) ? state.events : [];
  state.events = [...events, { at: new Date().toISOString(), ...event }].slice(-30);
  return serializeJsonNote(parsed.note, state);
}

export function isKnownStatus(value) {
  return ACTIVE_STATUSES.has(value);
}
