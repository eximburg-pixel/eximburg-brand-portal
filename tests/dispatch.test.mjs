import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../netlify/lib/actions.js";
import { fakeFiles, fakeFirestore } from "./helpers/fake-firestore.mjs";
import { silent } from "./helpers/fakes.mjs";

const NOW = Date.parse("2026-10-01T10:00:00Z");
const HOUR = 3600 * 1000;
function seeded(seed = 7) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NAMES = ["Clove", "Regular", "Mint", "Frutta", "Pan", "Ginger"];
function split(packs, n) {
  const lots = packs / 1000, base = Math.floor(lots / n), extra = lots - base * n;
  return NAMES.slice(0, n).map((name, i) => ({ name, packs: (base + (i < extra ? 1 : 0)) * 1000 }));
}
const form = (packs = 7000, n = 1, extra = {}) => ({
  name: "Asha Patel", phone: "9876543210", brand: "Urban Leaf", city: "Surat", gstin: "", call_time: "Morning",
  packs, flavours: split(packs, n), ...extra
});

function world({ seed = {}, now = NOW } = {}) {
  const db = fakeFirestore(seed);
  const files = fakeFiles();
  const clock = { now };
  const ctxFor = (id, role = "customer", name = "Person " + id) => ({
    user: { id, name }, role, firebase: () => ({ db, serverTime: () => new Date(clock.now) }), files,
    now: () => clock.now, random: seeded(), log: silent
  });
  const call = async (action, id, payload, role = "customer") => {
    try {
      return await ACTIONS[action].run(ctxFor(id, role), payload);
    } finally {
      clock.now += 1;
    }
  };
  return { db, files, clock, call };
}
async function fails(promise, status, message) {
  await assert.rejects(promise, (error) => {
    if (status !== undefined) assert.equal(error.status, status, error.message);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}
const slipFor = (w, uid, bookingId, name = "1700000000-aaaaaa.jpg") => {
  const path = `payment-slips/${uid}/${bookingId}/${name}`;
  w.files.store.set(path, { bytes: new ArrayBuffer(8), meta: { contentType: "image/jpeg" } });
  return path;
};
const docFor = (w, bookingId, name) => {
  const path = `dispatch-docs/${bookingId}/${name}`;
  w.files.store.set(path, { bytes: new ArrayBuffer(8), meta: { contentType: "application/pdf" } });
  return path;
};

async function confirmed(w, packs = 7000) {
  const { booking } = await w.call("bookSlot", "cust1", form(packs));
  const pay = await w.call("submitPayment", "cust1", {
    booking_id: booking.id, milestone: "booking10", amount: Math.round(booking.order_value / 10),
    utr: "SBIN" + String(w.clock.now), paid_on: "2026-10-01", slip_path: slipFor(w, "cust1", booking.id)
  });
  w.clock.now += 60000;
  await w.call("reviewPayment", "acct1", { payment_id: pay.payment_id, ok: true, note: "" }, "accounts");
  return w.db.read(`bookings/${booking.id}`) && booking;
}

const MONEY_KEYS = ["price", "order_value", "approval_fee", "shipping_charge", "offer", "gstin", "hold_until", "user_id", "call_time"];
function assertMoneyFree(row, label) {
  assert.ok(row, label + " exists");
  for (const key of MONEY_KEYS) assert.equal(row[key], undefined, `${label} has ${key}`);
  const text = JSON.stringify(row);
  assert.equal(/[₹%]|\bUTR\b|\bslip\b/i.test(text), false, `${label} leaked money wording: ${text.slice(0, 200)}`);
}

test("the new actions are registered with the right roles", () => {
  assert.deepEqual(ACTIONS.setStage.roles, ["production", "admin"]);
  assert.deepEqual(ACTIONS.submitQC.roles, ["production", "admin"]);
  assert.deepEqual(ACTIONS.markDispatched.roles, ["production", "admin"]);
  assert.deepEqual(ACTIONS.setShipping.roles, ["accounts", "admin"]);
  assert.deepEqual(ACTIONS.setDispatchDocs.roles, ["accounts", "admin"]);
});

test("verifying the 10% puts a money-free copy on the factory board; Production still sees nothing before that", async () => {
  const w = world({ seed: { "profiles/acct1": { name: "Meera", role: "accounts" } } });
  const { booking } = await w.call("bookSlot", "cust1", form(7000));
  assert.equal(w.db.read(`production_orders/${booking.id}`), undefined);
  const pay = await w.call("submitPayment", "cust1", {
    booking_id: booking.id, milestone: "booking10", amount: 63000, utr: "SBINAAA111", paid_on: "2026-10-01",
    slip_path: slipFor(w, "cust1", booking.id)
  });
  assert.equal(w.db.read(`production_orders/${booking.id}`), undefined, "payment review is off the factory board");
  w.clock.now += 60000;
  await w.call("reviewPayment", "acct1", { payment_id: pay.payment_id, ok: true }, "accounts");
  const row = w.db.read(`production_orders/${booking.id}`);
  assert.equal(row.stage, "confirmed");
  assert.equal(row.brand, "Urban Leaf");
  assert.equal(row.packs, 7000);
  assertMoneyFree(row, "factory copy after 10%");
});

test("Production moves one step forward; skipping a payment is refused", async () => {
  const w = world({ seed: { "profiles/prod1": { name: "Priya", role: "production" } } });
  const booking = await confirmed(w);
  w.clock.now += 60000;
  await w.call("setStage", "prod1", { booking_id: booking.id, stage: "label_design", note: "Designer assigned" }, "production");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "label_design");
  assert.equal(w.db.read(`production_orders/${booking.id}`).stage, "label_design");
  const last = w.db.list(`bookings/${booking.id}/updates`).sort((a, b) => a.created_at - b.created_at).at(-1);
  assert.equal(last.note, "Designer assigned");
  assert.equal(last.by_role, "production");
  await fails(w.call("setStage", "prod1", { booking_id: booking.id, stage: "approval_packaging" }, "production"), 403,
    "Your role cannot move this order to that stage.");
  await fails(w.call("setStage", "prod1", { booking_id: booking.id, stage: "manufacturing" }, "production"), 403,
    "Your role cannot move this order to that stage.");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "label_design");
});

test("Production may send a finished label for 40% clearance", async () => {
  const w = world({ seed: { "profiles/prod1": { name: "Priya", role: "production" } } });
  const booking = await confirmed(w);
  await w.call("setStage", "prod1", { booking_id: booking.id, stage: "label_design" }, "production");
  await w.call("setStage", "prod1", { booking_id: booking.id, stage: "awaiting_40" }, "production");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "awaiting_40");
  assertMoneyFree(w.db.read(`production_orders/${booking.id}`), "on hold for 40%");
});

test("a 40% slip under review takes the order off the factory board; verifying it puts it back", async () => {
  const w = world({ seed: { "profiles/prod1": { name: "Priya", role: "production" }, "profiles/acct1": { name: "Meera", role: "accounts" } } });
  const booking = await confirmed(w);
  await w.call("setStage", "prod1", { booking_id: booking.id, stage: "label_design" }, "production");
  await w.call("setStage", "prod1", { booking_id: booking.id, stage: "awaiting_40" }, "production");
  const pay = await w.call("submitPayment", "cust1", {
    booking_id: booking.id, milestone: "approval40", amount: 288000, utr: "UTR40AAAAAA", paid_on: "2026-10-01",
    slip_path: slipFor(w, "cust1", booking.id, "40.jpg")
  });
  assert.equal(w.db.read(`production_orders/${booking.id}`), undefined);
  w.clock.now += 60000;
  await w.call("reviewPayment", "acct1", { payment_id: pay.payment_id, ok: true }, "accounts");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "approval_packaging");
  assert.equal(w.db.read(`production_orders/${booking.id}`).stage, "approval_packaging");
});

test("Admin may jump to any stage, but must write a reason when leaving the normal path", async () => {
  const w = world({ seed: { "profiles/admin1": { name: "Hitesh", role: "admin" } } });
  const booking = await confirmed(w);
  await fails(w.call("setStage", "admin1", { booking_id: booking.id, stage: "manufacturing", note: "" }, "admin"), 400,
    "Write the reason for this override — the customer will see it.");
  await w.call("setStage", "admin1", { booking_id: booking.id, stage: "manufacturing", note: "Customer already approved the label offline" }, "admin");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "manufacturing");
  await fails(w.call("setStage", "admin1", { booking_id: booking.id, stage: "nope" }, "admin"), 400, "That stage does not exist.");
  await w.call("setStage", "admin1", { booking_id: booking.id, stage: "qc" }, "admin");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "qc");
});

test("QC without a report is blocked; with a report the order waits for the 50%", async () => {
  const w = world({ seed: { "profiles/prod1": { name: "Priya", role: "production" } } });
  const booking = await confirmed(w);
  await w.call("setStage", "admin1", { booking_id: booking.id, stage: "qc", note: "Samples ready" }, "admin");
  await fails(w.call("submitQC", "prod1", { booking_id: booking.id, note: "All good" }, "production"), 400,
    "Attach the QC report before sending for clearance.");
  await fails(w.call("submitQC", "prod1", { booking_id: booking.id, qc_path: slipFor(w, "cust1", booking.id) }, "production"), 400,
    "Attach the QC report before sending for clearance.");
  const path = docFor(w, booking.id, "qc-1.pdf");
  w.clock.now += 60000;
  await w.call("submitQC", "prod1", { booking_id: booking.id, qc_path: path, note: "All flavours passed" }, "production");
  const b = w.db.read(`bookings/${booking.id}`);
  assert.equal(b.stage, "awaiting_50");
  assert.equal(b.dispatch.qc_path, path);
  assert.equal(b.dispatch.qc_by, "Priya");
  assert.equal(b.dispatch.qc_note, "All flavours passed");
  const factory = w.db.read(`production_orders/${booking.id}`);
  assert.equal(factory.dispatch.qc_path, path);
  assert.equal(factory.dispatch.qc_note, "All flavours passed");
  assertMoneyFree(factory, "after QC");
});

test("shipping ₹12,500 goes to the customer; ₹0 skips to invoicing; the factory copy has no rupee sign", async () => {
  const w = world({ seed: { "profiles/acct1": { name: "Meera", role: "accounts" } } });
  const booking = await confirmed(w);
  await w.call("setStage", "admin1", { booking_id: booking.id, stage: "shipping_quote", note: "50% already in" }, "admin");
  await fails(w.call("setShipping", "acct1", { booking_id: booking.id, amount: -1 }, "accounts"), 400, "Shipping charge cannot be negative.");
  w.clock.now += 60000;
  await w.call("setShipping", "acct1", { booking_id: booking.id, amount: 12500, note: "By road, 4 days" }, "accounts");
  let b = w.db.read(`bookings/${booking.id}`);
  assert.equal(b.stage, "awaiting_shipping");
  assert.equal(b.shipping_charge, 12500);
  assert.equal(b.dispatch.shipping_note, "By road, 4 days");
  assertMoneyFree(w.db.read(`production_orders/${booking.id}`), "waiting for shipping pay");
  const note = w.db.list(`bookings/${booking.id}/updates`).sort((a, c) => a.created_at - c.created_at).at(-1).note;
  assert.match(note, /₹12,500/);

  await w.call("setShipping", "acct1", { booking_id: booking.id, amount: 0, note: "Customer pickup" }, "accounts");
  b = w.db.read(`bookings/${booking.id}`);
  assert.equal(b.stage, "docs_pending");
  assert.equal(b.shipping_charge, 0);
});

test("invoice and e-way bill: 12 digits, both files, then Production can dispatch", async () => {
  const w = world({ seed: { "profiles/acct1": { name: "Meera", role: "accounts" }, "profiles/prod1": { name: "Priya", role: "production" } } });
  const booking = await confirmed(w);
  await w.call("setStage", "admin1", { booking_id: booking.id, stage: "docs_pending", note: "payments in" }, "admin");
  const inv = docFor(w, booking.id, "invoice-1.pdf");
  const way = docFor(w, booking.id, "eway-1.pdf");
  await fails(w.call("setDispatchDocs", "acct1", {
    booking_id: booking.id, invoice_no: "INV-9", invoice_date: "2026-10-01", eway_no: "12345",
    eway_date: "2026-10-01", eway_valid_till: "2026-10-02", invoice_path: inv, eway_path: way
  }, "accounts"), 400, "E-way bill number must be 12 digits.");
  await fails(w.call("setDispatchDocs", "acct1", {
    booking_id: booking.id, invoice_no: "INV-9", invoice_date: "2026-10-01", eway_no: "123456789012",
    eway_date: "2026-10-01", eway_valid_till: "2026-10-02", invoice_path: `payment-slips/cust1/${booking.id}/x.jpg`, eway_path: way
  }, "accounts"), 400, "Attach the tax invoice (PDF or photo).");
  await w.call("setDispatchDocs", "acct1", {
    booking_id: booking.id, invoice_no: "INV-9", invoice_date: "2026-10-01", eway_no: "1234 5678 9012",
    eway_date: "2026-10-01", eway_valid_till: "2026-10-02", invoice_path: inv, eway_path: way
  }, "accounts");
  let b = w.db.read(`bookings/${booking.id}`);
  assert.equal(b.stage, "ready_dispatch");
  assert.equal(b.dispatch.eway_no, "123456789012");
  const factory = w.db.read(`production_orders/${booking.id}`);
  assert.equal(factory.dispatch.invoice_no, "INV-9");
  assert.equal(factory.dispatch.eway_path, way);
  assertMoneyFree(factory, "ready to dispatch");

  await fails(w.call("markDispatched", "prod1", { booking_id: booking.id, transporter: "", vehicle_no: "GJ05", lr_no: "1" }, "production"), 400,
    "Fill transporter, vehicle number and LR / docket number.");
  await w.call("markDispatched", "prod1", {
    booking_id: booking.id, transporter: "SafeRoad", vehicle_no: "gj05-ab-1234", lr_no: "LR-99", dispatched_on: "2026-10-01", note: "3 days"
  }, "production");
  b = w.db.read(`bookings/${booking.id}`);
  assert.equal(b.stage, "dispatched");
  assert.equal(b.dispatch.vehicle_no, "GJ05AB1234");
  const last = w.db.list(`bookings/${booking.id}/updates`).sort((a, c) => a.created_at - c.created_at).at(-1);
  assert.equal(last.note, "Dispatched by SafeRoad, vehicle GJ05AB1234, LR LR-99. 3 days");
  await w.call("setStage", "prod1", { booking_id: booking.id, stage: "delivered" }, "production");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "delivered");
});

test("Admin cancelling an order removes it from the factory board", async () => {
  const w = world();
  const booking = await confirmed(w);
  await w.call("setStage", "admin1", { booking_id: booking.id, stage: "cancelled", note: "Customer withdrew" }, "admin");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "cancelled");
  assert.equal(w.db.read(`production_orders/${booking.id}`), undefined);
});
