import test from "node:test";
import assert from "node:assert/strict";
import {
  iso, mapEvent, mapPlan, mapProdOrder, mapProfile, mapSession, mapUpdate, partyLabel, plainify, prodDispatch, prodShape, slotStatusFrom, uidByLoginId
} from "../shared/portal-mappers.js";

const T = Date.parse("2026-10-05T10:00:00Z");
const stamp = (ms) => ({ toMillis: () => ms }); // looks like a Firestore Timestamp

test("iso handles timestamps, numbers, dates, strings and rubbish", () => {
  assert.equal(iso(stamp(T)), "2026-10-05T10:00:00.000Z");
  assert.equal(iso(T), "2026-10-05T10:00:00.000Z");
  assert.equal(iso(new Date(T)), "2026-10-05T10:00:00.000Z");
  assert.equal(iso("2026-10-05T10:00:00Z"), "2026-10-05T10:00:00.000Z");
  assert.equal(iso(null), "");
  assert.equal(iso(undefined), "");
  assert.equal(iso("not a date"), "");
});

test("plainify turns nested timestamps into text and leaves the rest alone", () => {
  const out = plainify({ a: stamp(T), nested: { at: stamp(T), n: 5, s: "x" }, list: [stamp(T), 1], nothing: null });
  assert.equal(out.a, "2026-10-05T10:00:00.000Z");
  assert.equal(out.nested.at, "2026-10-05T10:00:00.000Z");
  assert.equal(out.nested.n, 5);
  assert.equal(out.list[0], "2026-10-05T10:00:00.000Z");
  assert.equal(out.nothing, null);
});

test("mapProfile fills every field the panel reads", () => {
  const p = mapProfile("u1", { name: "Asha", created_at: stamp(T), role: "accounts" });
  assert.deepEqual(p, { id: "u1", name: "Asha", company: "", email: "", phone: "", city: "", brand: "", login_id: "", role: "accounts", deal: null, created_at: "2026-10-05T10:00:00.000Z" });
  assert.deepEqual(mapProfile("u3", { deal: { price: 88, packs: 10000 } }).deal, { price: 88, packs: 10000 });
  assert.equal(mapProfile("u4", { deal: { price: 88, packs: 7500 } }).deal, null);
  assert.equal(partyLabel("Acme Traders", "Asha"), "Acme Traders — Asha");
  assert.equal(partyLabel("", "Asha"), "Asha");
  assert.equal(partyLabel("Acme Traders", ""), "Acme Traders");
  assert.equal(mapProfile("u2", {}).role, "customer");
});

test("mapEvent: base fields move out, the rest becomes meta, user comes from the login id", () => {
  const profiles = [{ id: "u1", login_id: "EXB-a-1" }, { id: "u2", login_id: "" }];
  const map = uidByLoginId(profiles);
  assert.deepEqual(map, { "EXB-a-1": "u1" });
  const e = mapEvent("e1", { loginId: "EXB-a-1", sessionId: "S1", ts: T, type: "page_view", from: "home", to: "book", stepNo: 5 }, map);
  assert.equal(e.user_id, "u1");
  assert.equal(e.session_id, "S1");
  assert.equal(e.type, "section_view", "page_view is the name the panel already draws");
  assert.equal(e.created_at, "2026-10-05T10:00:00.000Z");
  assert.equal(e.meta.id, "book");
  assert.equal(e.meta.from, "home");
  assert.equal(e.meta.loginId, undefined);
  assert.equal(mapEvent("e2", { loginId: "EXB-unknown", ts: T, type: "x" }, map).user_id, null);
  assert.equal(mapEvent("e3", {}, map).created_at, "");
});

test("tracker names become the names the panel already uses", () => {
  const visit = mapEvent("v", { type: "session_start", sessionId: "S1", ts: T });
  assert.equal(visit.type, "visit");
  const booked = mapEvent("b", { type: "booking_submit", bookingId: "bk1", code: "EXB-1", ts: T });
  assert.equal(booked.type, "slot_booked");
  assert.equal(booked.meta.code, "EXB-1");
  const offer = mapEvent("o", { type: "action", act: "offerup", packs: 12000, ts: T });
  assert.equal(offer.type, "offer_upgrade");
  assert.equal(offer.meta.packs, 12000);
});

test("mapSession keeps the fields drop-rate needs", () => {
  const s = mapSession("S1", {
    loginId: "EXB-a-1", sessionId: "S1", startedAt: T, leftAt: T + 5000, returnedAt: 0,
    status: "closed", booked: false, exitStep: "profit", stepsVisited: ["home", "profit"]
  }, { "EXB-a-1": "u1" });
  assert.equal(s.user_id, "u1");
  assert.equal(s.leftAt, T + 5000);
  assert.equal(s.exitStep, "profit");
  assert.deepEqual(s.stepsVisited, ["home", "profit"]);
});

test("mapPlan is the last-plan shape the leads table draws", () => {
  const p = mapPlan("EXB-a-1", { loginId: "EXB-a-1", inputs: { totalPacks: 7000, flavourCount: 2 }, outputs: { orderValue: 630000 }, updatedAt: T }, { "EXB-a-1": "u1" });
  assert.equal(p.user_id, "u1");
  assert.equal(p.packs, 7000);
  assert.equal(p.order, 630000);
  assert.equal(p.flavours, 2);
});

test("mapUpdate carries the booking id", () => {
  const u = mapUpdate("b1", "u9", { stage: "confirmed", created_at: stamp(T) });
  assert.equal(u.booking_id, "b1");
  assert.equal(u.id, "u9");
  assert.equal(u.created_at, "2026-10-05T10:00:00.000Z");
});

/* ---------- Production must never see money ---------- */
const MONEY = ["price", "order_value", "approval_fee", "shipping_charge", "offer", "gstin", "hold_until", "payments", "utr", "amount"];

function mirror(extra = {}) {
  return {
    id: "b1", code: "EXB-1", brand: "Zest", name: "Ravi", city: "Surat", phone: "9876543210", slot_month: "2026-10", slot_no: 5,
    packs: 7000, flavours: [{ name: "Clove", packs: 7000, price: 90 }], stage: "manufacturing",
    created_at: stamp(T), updated_at: stamp(T),
    dispatch: { qc_path: "p", invoice_no: "INV1", shipping_note: "secret money note", transporter: "T" },
    updates: [
      { stage: "payment_review", note: "UTR 123", by_role: "accounts", by_name: "A", created_at: stamp(T) },
      { stage: "confirmed", note: "Payment of ₹1,02,000 verified", by_role: "accounts", by_name: "A", created_at: stamp(T + 1000) },
      { stage: "manufacturing", note: "Started line 2", by_role: "production", by_name: "P", created_at: stamp(T + 2000) },
      { stage: "cancelled", note: "x", by_role: "admin", by_name: "A", created_at: stamp(T + 3000) }
    ],
    ...extra
  };
}

test("production rows contain only whitelisted fields, even if money was stored by mistake", () => {
  const dirty = mirror(Object.fromEntries(MONEY.map((k) => [k, 12345])));
  const row = mapProdOrder("b1", dirty);
  for (const key of MONEY) assert.equal(row[key], undefined, key);
  assert.equal(row.flavours[0].price, undefined);
  assert.equal(row.flavours[0].mfg_at, undefined);
  assert.equal(JSON.stringify(row).includes("12345"), false);
});

test("production keeps flavour completion dates and the QC report path, and still drops the price", () => {
  const row = mapProdOrder("b1", mirror({
    flavours: [{ name: "Clove", packs: 4000, price: 90, mfg_at: "2026-10-02T10:00:00.000Z", qc_at: "2026-10-03T10:00:00.000Z", qc_path: "dispatch-docs/b1/qc-1.pdf" }]
  }));
  assert.deepEqual(row.flavours[0], {
    name: "Clove", packs: 4000,
    mfg_at: "2026-10-02T10:00:00.000Z", qc_at: "2026-10-03T10:00:00.000Z", qc_path: "dispatch-docs/b1/qc-1.pdf"
  });
});

test("production sees no payment or cancellation updates, and no accounts notes", () => {
  const row = mapProdOrder("b1", mirror());
  assert.deepEqual(row.upd.map((u) => u.stage), ["confirmed", "manufacturing"]);
  assert.equal(row.upd[0].note, ""); // by accounts: note hidden
  assert.equal(row.upd[1].note, "Started line 2"); // by production: note shown
  assert.equal(JSON.stringify(row).includes("₹"), false);
});

test("dispatch details: documents only late in the order, never the shipping note", () => {
  const early = prodDispatch("manufacturing", { qc_path: "q", invoice_no: "INV", shipping_note: "x" });
  assert.deepEqual(early, { qc_path: "q" });
  const late = prodDispatch("ready_dispatch", { invoice_no: "INV", eway_no: "123456789012", transporter: "T", shipping_note: "x", qc_by: "P" });
  assert.deepEqual(late, { qc_by: "P", invoice_no: "INV", eway_no: "123456789012", transporter: "T" });
  assert.equal(late.shipping_note, undefined);
});

test("prodShape matches what the panel expects", () => {
  const shaped = prodShape([mapProdOrder("b1", mirror())]);
  assert.equal(shaped.productionOnly, true);
  assert.deepEqual(shaped.profiles, []);
  assert.deepEqual(shaped.events, []);
  assert.deepEqual(shaped.payments, []);
  assert.equal(shaped.bookings.length, 1);
  assert.equal(shaped.bookings[0].upd, undefined);
  assert.equal(shaped.updates.length, 2);
  assert.equal(shaped.updates[0].booking_id, "b1");
});

/* ---------- slot board ---------- */
test("slot board with no bookings yet: counts come from Settings", () => {
  const s = slotStatusFrom({ settings: null, now: new Date("2026-10-05T10:00:00Z") });
  assert.equal(s.month, "2026-10");
  assert.equal(s.next_month, "2026-11");
  assert.equal(s.client_slots, 7);
  assert.equal(s.offline, 4);
  assert.deepEqual(s.taken, []);
  assert.equal(s.next_offline, 0);
  assert.equal(s.hold_hours, 48);
  assert.deepEqual(s.recent, []);
});

test("slot board uses taken numbers from slot_months, sorted, and clamps offline to the client slots", () => {
  const s = slotStatusFrom({
    settings: { monthSlots: 10, royalSwagReserved: 8, offlineSlots: { "2026-10": 9 }, holdHours: 24 },
    slotMonths: { "2026-10": { taken: [6, "5", "x"] }, "2026-11": { taken: [1] } },
    now: new Date("2026-10-05T10:00:00Z")
  });
  assert.equal(s.client_slots, 2);
  assert.equal(s.offline, 2);
  assert.deepEqual(s.taken, [5, 6]);
  assert.deepEqual(s.next_taken, [1]);
  assert.equal(s.hold_hours, 24);
});

test("slot board follows India time at the month boundary", () => {
  assert.equal(slotStatusFrom({ now: new Date("2026-10-31T18:29:00Z") }).month, "2026-10");
  assert.equal(slotStatusFrom({ now: new Date("2026-10-31T18:31:00Z") }).month, "2026-11");
});
