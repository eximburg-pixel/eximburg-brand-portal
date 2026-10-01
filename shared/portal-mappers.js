/*
  Turns Firestore documents into the plain shapes the team panel already understands.
  Pure code (no Firebase, no browser) so it can be unit tested.
*/
import { addMonth, monthKeyIST, toMillis } from "./portal-rules.js";
import { mergeSettings } from "./portal-settings.js";

/* Any time value -> ISO text ("" if it is not a time). The panel compares these as strings. */
export function iso(value) {
  const ms = toMillis(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/* Copies a document, turning every Firestore Timestamp inside it into an ISO string. */
export function plainify(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(plainify);
  if (typeof value === "object") {
    if (typeof value.toMillis === "function" || value instanceof Date) return iso(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = plainify(item);
    return out;
  }
  return value;
}

export function mapProfile(id, data) {
  const d = plainify(data || {});
  return {
    id,
    name: d.name || "",
    email: d.email || "",
    phone: d.phone || "",
    city: d.city || "",
    brand: d.brand || "",
    login_id: d.login_id || "",
    role: d.role || "customer",
    created_at: d.created_at || ""
  };
}

export const mapBooking = (id, data) => ({ ...plainify(data || {}), id });
export const mapPayment = (id, data) => ({ ...plainify(data || {}), id });
export const mapUpdate = (bookingId, id, data) => ({ ...plainify(data || {}), id, booking_id: bookingId });

/*
  Analytics events are stored as { loginId, sessionId, ts, type, ...fields }.
  The panel expects { id, session_id, user_id, type, meta, created_at }.
  user_id is found through the profile that owns the login id (null if nobody does).
*/
const EVENT_BASE_FIELDS = new Set(["loginId", "sessionId", "ts", "type", "stepSchema"]);
const EVENT_TYPE_FOR = {
  session_start: "visit",
  page_view: "section_view",
  booking_submit: "slot_booked"
};

export function mapEvent(id, data, uidByLogin = {}) {
  const d = plainify(data || {});
  let type = EVENT_TYPE_FOR[d.type] || d.type || "";
  if (d.type === "action" && (d.act === "offerup" || d.act === "offer_upgrade")) type = "offer_upgrade";
  const meta = {};
  for (const [key, value] of Object.entries(d)) {
    if (!EVENT_BASE_FIELDS.has(key)) meta[key] = value;
  }
  if (type === "section_view") meta.id = d.to || d.step || meta.id || "";
  if (type === "slot_booked" && !meta.code) meta.code = d.code || d.bookingId || "";
  if (type === "offer_upgrade" && (meta.packs == null || meta.packs === "")) {
    meta.packs = Number(d.packs || d.t) || 0;
  }
  const at = iso(data && data.ts);
  return {
    id,
    session_id: d.sessionId || "",
    login_id: d.loginId || "",
    user_id: (d.loginId && uidByLogin[d.loginId]) || null,
    type,
    meta,
    created_at: at
  };
}

export function mapSession(id, data, uidByLogin = {}) {
  const d = plainify(data || {});
  const started = iso(data && (data.startedAt != null ? data.startedAt : data.ts));
  const stampNum = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    id,
    session_id: d.sessionId || id,
    login_id: d.loginId || "",
    user_id: (d.loginId && uidByLogin[d.loginId]) || null,
    status: d.status || "",
    booked: !!d.booked,
    leftAt: stampNum(d.leftAt),
    returnedAt: stampNum(d.returnedAt),
    exitStep: d.exitStep || "",
    exitStepNo: d.exitStepNo || 0,
    furthestStep: d.furthestStep || "",
    stepsVisited: Array.isArray(d.stepsVisited) ? d.stepsVisited.slice() : [],
    started_at: started,
    created_at: started
  };
}

export function mapPlan(id, data, uidByLogin = {}) {
  const d = plainify(data || {});
  const inputs = d.inputs || {};
  const outputs = d.outputs || {};
  return {
    id,
    login_id: d.loginId || id,
    user_id: (d.loginId && uidByLogin[d.loginId]) || null,
    packs: inputs.totalPacks,
    order: outputs.orderValue,
    flavours: inputs.flavourCount,
    updated_at: iso(data && data.updatedAt)
  };
}

export function uidByLoginId(profiles) {
  const map = {};
  for (const p of profiles) if (p.login_id) map[p.login_id] = p.id;
  return map;
}

/* ---------- Production: money-free by construction ---------- */
/*
  Even though production_orders is written money-free by the server, the panel only ever sees the
  fields listed here. If a money field ever slipped into that document, it still would not reach a screen.
*/
const PROD_DISPATCH_ALWAYS = ["qc_path", "qc_at", "qc_note", "qc_by"];
const PROD_DISPATCH_LATE = ["invoice_no", "invoice_date", "invoice_path", "eway_no", "eway_date", "eway_valid_till", "eway_path", "transporter", "vehicle_no", "lr_no", "dispatched_on"];
const PROD_LATE_STAGES = ["ready_dispatch", "dispatched", "delivered"];
const HIDDEN_FROM_PRODUCTION = ["awaiting_payment", "payment_review", "cancelled"];

export function prodDispatch(stage, dispatch) {
  const x = dispatch || {};
  const out = {};
  for (const key of PROD_DISPATCH_ALWAYS) if (x[key]) out[key] = x[key];
  if (!PROD_LATE_STAGES.includes(stage)) return out;
  for (const key of PROD_DISPATCH_LATE) if (x[key]) out[key] = x[key];
  return out;
}

export function mapProdOrder(id, data) {
  const d = plainify(data || {});
  const upd = (Array.isArray(d.updates) ? d.updates : [])
    .filter((u) => u && !HIDDEN_FROM_PRODUCTION.includes(u.stage))
    .map((u) => ({
      stage: u.stage,
      created_at: u.created_at || "",
      by_role: u.by_role || "",
      by_name: u.by_name || "",
      note: u.by_role === "production" || u.by_role === "admin" ? u.note || "" : ""
    }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return {
    id: d.id || id,
    code: d.code || "",
    brand: d.brand || "",
    name: d.name || "",
    city: d.city || "",
    phone: d.phone || "",
    slot_month: d.slot_month || "",
    slot_no: d.slot_no,
    packs: d.packs,
    flavours: Array.isArray(d.flavours) ? d.flavours.map((f) => ({ name: f.name, packs: f.packs })) : [],
    stage: d.stage || "",
    created_at: d.created_at || "",
    updated_at: d.updated_at || "",
    dispatch: prodDispatch(d.stage, d.dispatch),
    upd
  };
}

export function prodShape(rows) {
  const bookings = rows.map((r) => ({ ...r }));
  const updates = [];
  for (const b of bookings) {
    for (const u of b.upd || []) updates.push({ booking_id: b.id, ...u });
    delete b.upd;
  }
  return { profiles: [], events: [], bookings, payments: [], updates, productionOnly: true };
}

/* ---------- slot board ---------- */
/*
  Offline bookings and the slot counts come from Settings (always current).
  The numbers already taken online come from slot_months/{month}, which the server maintains.
*/
export function slotStatusFrom({ settings, slotMonths = {}, recent = [], now = new Date() }) {
  const set = mergeSettings(settings);
  const month = monthKeyIST(now);
  const nextMonth = addMonth(month);
  const client = Math.max(0, (Number(set.monthSlots) || 0) - (Number(set.royalSwagReserved) || 0));
  const offlineOf = (m) => Math.min(client, Number((set.offlineSlots || {})[m] || 0));
  const takenOf = (m) => {
    const doc = slotMonths[m];
    const list = doc && Array.isArray(doc.taken) ? doc.taken : [];
    return list.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  };
  return {
    month,
    next_month: nextMonth,
    client_slots: client,
    offline: offlineOf(month),
    taken: takenOf(month),
    next_offline: offlineOf(nextMonth),
    next_taken: takenOf(nextMonth),
    hold_hours: Number(set.holdHours) || 48,
    recent: recent.map((e) => plainify(e))
  };
}
