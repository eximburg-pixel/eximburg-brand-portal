import test from "node:test";
import assert from "node:assert/strict";
import { ORDER_ACTIONS, recomputeSlotMonth, recomputeSlotMonths } from "../netlify/lib/orders.js";
import { ACTIONS } from "../netlify/lib/actions.js";
import { dueAmount, dueMilestone } from "../shared/portal-rules.js";
import { fakeFiles, fakeFirestore } from "./helpers/fake-firestore.mjs";
import { silent } from "./helpers/fakes.mjs";

const NOW = Date.parse("2026-10-01T10:00:00Z"); // 15:30 in India, so the month is 2026-10
const HOUR = 3600 * 1000;

/* a small seeded random so booking codes are repeatable */
function seeded(seed = 7) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NAMES = ["Clove", "Regular", "Mint", "Frutta", "Pan", "Ginger"];
function split(packs, n) {
  const lots = packs / 1000, base = Math.floor(lots / n), extra = lots - base * n;
  return NAMES.slice(0, n).map((name, i) => ({ name, packs: (base + (i < extra ? 1 : 0)) * 1000 }));
}
const form = (packs = 12000, n = 6, extra = {}) => ({
  name: "Asha Patel", phone: "9876543210", brand: "Urban Leaf", city: "Surat", gstin: "", call_time: "Morning (10–1)",
  packs, flavours: split(packs, n), ...extra
});

function world({ seed = {}, checkQueries = true, now = NOW } = {}) {
  const db = fakeFirestore(seed, { checkQueries });
  const files = fakeFiles();
  const clock = { now };
  const rand = seeded();
  const ctxFor = (id, role = "customer", name = "Person " + id) => ({
    user: { id, name }, role, firebase: () => ({ db, serverTime: () => new Date(clock.now) }), files, now: () => clock.now, random: rand, log: silent
  });
  const call = (action, id, payload, role = "customer") => ACTIONS[action].run(ctxFor(id, role), payload);
  return { db, files, clock, ctxFor, call };
}

async function fails(promise, status, message) {
  await assert.rejects(promise, (error) => {
    if (status !== undefined) assert.equal(error.status, status, `status for: ${error.message}`);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

const slipFor = (w, uid, bookingId, name = "1700000000-aaaaaa.jpg") => {
  const path = `payment-slips/${uid}/${bookingId}/${name}`;
  w.files.store.set(path, { bytes: new ArrayBuffer(8), meta: { contentType: "image/jpeg" } });
  return path;
};
const payment = (w, uid, booking, extra = {}) => {
  const milestone = extra.milestone || "booking10";
  const amount = booking && booking.order_value != null ? dueAmount(booking, milestone) : 100;
  return {
    booking_id: booking.id, milestone, amount, utr: "SBIN1234567", paid_on: "2026-10-01",
    slip_path: slipFor(w, uid, booking.id), ...extra
  };
};

/* ---------------------------------------------------------------- bookSlot */

test("the new actions are registered with the right roles", () => {
  assert.deepEqual(ACTIONS.bookSlot.roles, ["customer"]);
  assert.deepEqual(ACTIONS.submitPayment.roles, ["customer"]);
  assert.deepEqual(ACTIONS.reviewPayment.roles, ["accounts", "admin"]);
  assert.equal(ORDER_ACTIONS.bookSlot, ACTIONS.bookSlot);
});

test("with 4 offline slots a customer gets slot 5 of 7; 12,000 packs: 10% is Rs 1,02,000, offer on, 48 h hold", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(12000, 6, { brand: "Urban Leaf" }));
  assert.equal(booking.slot_month, "2026-10");
  assert.equal(booking.slot_no, 5);
  assert.equal(booking.price, 85);
  assert.equal(booking.order_value, 1020000);
  assert.equal(booking.approval_fee, 36000);
  assert.equal(booking.offer, true);
  assert.equal(booking.stage, "awaiting_payment");
  assert.equal(dueAmount(booking, dueMilestone(booking.stage)), 111348);
  assert.equal(Date.parse(booking.hold_until) - NOW, 48 * HOUR);
  assert.match(booking.code, /^EXB-261001-[A-Z2-9]{4}$/);
  assert.equal(booking.user_id, "cust1");
  assert.deepEqual(booking.dispatch, {});
  assert.equal(booking.shipping_charge, 0);
});

test("booking writes the first update, a public slot event, the slot board and the brand", async () => {
  const w = world({ seed: { "profiles/cust1": { name: "Asha", role: "customer", brand: "" } } });
  const { booking } = await w.call("bookSlot", "cust1", form(12000));
  const updates = w.db.list(`bookings/${booking.id}/updates`);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].stage, "awaiting_payment");
  assert.equal(updates[0].note, "Slot 5 reserved for 2026-10. Pay the 10% booking amount within 48 hours to confirm.");
  assert.equal(updates[0].by_role, "system");
  const events = w.db.list("slot_events");
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ["city", "created_at", "id", "slot_month", "slot_no"], "no personal data in the public event");
  assert.equal(events[0].city, "Surat");
  const board = w.db.read("slot_months/2026-10");
  assert.deepEqual({ client: board.client_slots, offline: board.offline, taken: board.taken }, { client: 7, offline: 4, taken: [5] });
  assert.equal(w.db.read("profiles/cust1").brand, "Urban Leaf");
  assert.equal(w.db.read("profiles/cust1").name, "Asha", "other profile fields are untouched");
});

test("a booking keeps company and email, and writes the company onto the profile", async () => {
  const w = world({ seed: { "profiles/cust1": { name: "Asha", role: "customer", brand: "Old" } } });
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 1, { company: "Acme Traders", email: "asha@acme.in" }));
  assert.equal(booking.company, "Acme Traders");
  assert.equal(booking.email, "asha@acme.in");
  assert.equal(booking.name, "Asha Patel");
  assert.equal(w.db.read("profiles/cust1").company, "Acme Traders");
  assert.equal(w.db.read("profiles/cust1").name, "Asha", "the profile name is not overwritten");
  await fails(w.call("bookSlot", "c2", form(7000, 1, { email: "not-an-email" })), 400, "Check the email address, or leave it blank.");
});

test("a 7,000-pack, 6-flavour order: no offer, and 10/40/50 are shares of the GST-inclusive total", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 6));
  assert.equal(booking.order_value, 630000);
  assert.equal(booking.offer, false);
  assert.equal(dueAmount(booking, "booking10"), 70398);
  assert.equal(dueAmount(booking, "approval40"), 281592);
  assert.equal(dueAmount(booking, "delivery50"), 351990);
});

test("the browser cannot choose the price, the fee, the offer or the slot", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 6, {
    price: 1, order_value: 100, approval_fee: 0, offer: true, slot_no: 1, slot_month: "2026-09", stage: "confirmed", user_id: "someone-else", hold_until: "2099-01-01"
  }));
  assert.equal(booking.price, 90);
  assert.equal(booking.order_value, 630000);
  assert.equal(booking.approval_fee, 36000);
  assert.equal(booking.offer, false);
  assert.equal(booking.slot_no, 5);
  assert.equal(booking.slot_month, "2026-10");
  assert.equal(booking.stage, "awaiting_payment");
  assert.equal(booking.user_id, "cust1");
  assert.ok(Date.parse(booking.hold_until) - NOW === 48 * HOUR);
});

test("bad forms are refused with the exact sentences", async () => {
  const w = world();
  await fails(w.call("bookSlot", "c", form(6000, 1)), 400, "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  await fails(w.call("bookSlot", "c", form(7500, 1)), 400, "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  await fails(w.call("bookSlot", "c", { ...form(7000, 1), flavours: [] }), 400, "Choose 1 to 6 flavours.");
  await fails(w.call("bookSlot", "c", { ...form(7000, 2), flavours: [{ name: "Clove", packs: 3500 }, { name: "Mint", packs: 3500 }] }), 400, "Flavour split must be in lots of 1,000 packs.");
  await fails(w.call("bookSlot", "c", form(7000, 1, { name: "  " })), 400, "Enter your full name.");
  await fails(w.call("bookSlot", "c", form(7000, 1, { phone: "12345" })), 400, "Enter a valid 10-digit mobile number.");
  await fails(w.call("bookSlot", "c", form(7000, 1, { gstin: "BAD" })), 400, "Check the GSTIN (15 characters), or leave it blank.");
  assert.equal(w.db.list("bookings").length, 0, "nothing was saved");
});

test("Tom's agreed ₹88 for 10,000 packs is what the booking and the 10/40/50 use", async () => {
  const w = world();
  w.db.put("profiles/tom", { role: "customer", name: "Tom", deal: { price: 88, packs: 10000 } });
  await fails(w.call("bookSlot", "tom", { ...form(7000, 6), price: 1 }), 400, "Your agreed batch is 10,000 packs at ₹88 per pack.");
  const { booking } = await w.call("bookSlot", "tom", { ...form(10000, 6), price: 1, order_value: 1 });
  assert.equal(booking.price, 88);
  assert.equal(booking.packs, 10000);
  assert.equal(booking.order_value, 880000);
  assert.equal(booking.approval_fee, 36000);
  assert.equal(booking.gst_order_pct, 5);
  assert.equal(booking.gst_approval_pct, 18);
  assert.equal(dueAmount(booking, "booking10"), 96648);
  assert.equal(dueAmount(booking, "approval40"), 386592);
  assert.equal(dueAmount(booking, "delivery50"), 483240);
  assert.equal(dueAmount(booking, "booking10") + dueAmount(booking, "approval40") + dueAmount(booking, "delivery50"), 966480);
});

test("public settings decide the pack price, approval fee and GST stored on a new booking", async () => {
  const w = world({ seed: { "settings/portal": { pricing: {
    tiers: [{ packs: 0, price: 92 }, { packs: 9000, price: 90 }, { packs: 12000, price: 88 }, { packs: 14000, price: 86 }],
    approvalFeePerFlavour: 7000, gstOrderPct: 12, gstApprovalPct: 18
  } } } });
  const { booking } = await w.call("bookSlot", "cust1", { ...form(7000, 1), price: 50 });
  assert.equal(booking.price, 92);
  assert.equal(booking.order_value, 644000);
  assert.equal(booking.approval_fee, 7000);
  assert.equal(booking.gst_order_pct, 12);
  assert.equal(booking.gst_approval_pct, 18);
  const shares = dueAmount(booking, "booking10") + dueAmount(booking, "approval40") + dueAmount(booking, "delivery50");
  const gstOrder = Math.round(644000 * 0.12);
  const gstApproval = Math.round(7000 * 0.18);
  assert.equal(shares, 644000 + 7000 + gstOrder + gstApproval);
});

test("only an admin can store an agreed price, and only on a customer", async () => {
  const w = world();
  w.db.put("profiles/tom", { role: "customer", name: "Tom" });
  w.db.put("profiles/boss", { role: "admin", name: "Boss" });
  await fails(w.call("saveCustomerDeal", "admin1", { userId: "missing", price: 88, packs: 10000 }, "admin"), 404, "That customer was not found.");
  await fails(w.call("saveCustomerDeal", "admin1", { userId: "boss", price: 88, packs: 10000 }, "admin"), 400, "An agreed price is only for a customer.");
  await fails(w.call("saveCustomerDeal", "admin1", { userId: "tom", price: 88, packs: 7500 }, "admin"), 400, "Batch size must be 7,000 to 30,000 packs, in lots of 1,000.");
  assert.deepEqual(ACTIONS.saveCustomerDeal.roles, ["admin"]);
  const saved = await w.call("saveCustomerDeal", "admin1", { userId: "tom", price: 88, packs: 10000 }, "admin");
  assert.deepEqual(saved.deal, { price: 88, packs: 10000 });
  assert.deepEqual(w.db.read("profiles/tom").deal, { price: 88, packs: 10000 });
  const cleared = await w.call("saveCustomerDeal", "admin1", { userId: "tom", clear: true }, "admin");
  assert.equal(cleared.deal, null);
  assert.equal(w.db.read("profiles/tom").deal, null);
});

test("a valid GSTIN is stored in capitals", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "c", form(7000, 1, { gstin: "24abcde1234f1z5" }));
  assert.equal(booking.gstin, "24ABCDE1234F1Z5");
});

test("a third unpaid hold is refused; paid or expired holds do not count", async () => {
  const w = world();
  await w.call("bookSlot", "cust1", form(7000, 1));
  const second = (await w.call("bookSlot", "cust1", form(7000, 1))).booking;
  await fails(w.call("bookSlot", "cust1", form(7000, 1)), 409,
    "You already have 2 unpaid slots on hold. Pay for one of them, or wait for a hold to run out, before booking another.");
  // one of them moves on to payment review: it no longer counts as an unpaid hold
  w.db.put(`bookings/${second.id}`, { ...w.db.read(`bookings/${second.id}`), stage: "payment_review" });
  await w.call("bookSlot", "cust1", form(7000, 1));
  // after 49 hours the remaining unpaid holds have run out
  w.clock.now = NOW + 49 * HOUR;
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 1));
  assert.ok(booking.id);
});

test("a hold that ran out gives its slot to the next booking", async () => {
  const w = world();
  const first = (await w.call("bookSlot", "a", form(7000, 1))).booking;
  assert.equal(first.slot_no, 5);
  w.clock.now = NOW + 49 * HOUR;
  const next = (await w.call("bookSlot", "b", form(7000, 1))).booking;
  assert.equal(next.slot_no, 5, "the lapsed hold's slot is open again");
  assert.equal(w.db.read("slot_months/2026-10").taken.join(), "5", "board shows only the live booking");
});

test("the customer can book next month while this month still has space", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 1, { month: "2026-11" }));
  assert.equal(booking.slot_month, "2026-11");
  assert.equal(booking.slot_no, 1);
  assert.equal(w.db.read("slot_months/2026-10"), undefined, "this month is left untouched");
});

test("a chosen month that is full stays full instead of jumping ahead", async () => {
  const w = world({ seed: { "settings/portal": { offlineSlots: { "2026-11": 7 } } } });
  await fails(w.call("bookSlot", "cust1", form(7000, 1, { month: "2026-11" })), 409, "November 2026 is full. Choose the other month.");
  assert.equal(w.db.list("bookings").length, 0);
});

test("a month other than this one or the next is ignored", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 1, { month: "2027-03" }));
  assert.equal(booking.slot_month, "2026-10");
});

test("when the month is full the booking moves to the next month", async () => {
  const w = world();
  for (const id of ["a", "b", "c"]) await w.call("bookSlot", id, form(7000, 1)); // slots 5, 6, 7
  const { booking } = await w.call("bookSlot", "d", form(7000, 1));
  assert.equal(booking.slot_month, "2026-11");
  assert.equal(booking.slot_no, 1);
  assert.equal(w.db.read("slot_months/2026-11").taken.join(), "1");
  assert.equal(w.db.list("slot_events").length, 4);
});

test("offline slots in a later month are respected", async () => {
  const w = world({ seed: { "settings/portal": { offlineSlots: { "2026-10": 7, "2026-11": 3 } } } });
  const { booking } = await w.call("bookSlot", "a", form(7000, 1));
  assert.deepEqual([booking.slot_month, booking.slot_no], ["2026-11", 4]);
});

test("if every slot for 12 months is taken the customer is asked to contact us", async () => {
  const w = world({ seed: { "settings/portal": { monthSlots: 8, royalSwagReserved: 8 } } });
  await fails(w.call("bookSlot", "a", form(7000, 1)), 409, "All production slots for the next 12 months are full. Please contact us.");
  assert.equal(w.db.list("bookings").length, 0);
});

test("Admin settings change the hold time and the offer rule", async () => {
  const w = world({ seed: { "settings/portal": { holdHours: 24, offer: { enabled: true, threshold: 600000 } } } });
  const { booking } = await w.call("bookSlot", "a", form(7000, 1));
  assert.equal(Date.parse(booking.hold_until) - NOW, 24 * HOUR);
  assert.equal(booking.offer, true);
  const off = world({ seed: { "settings/portal": { offer: { enabled: false } } } });
  assert.equal((await off.call("bookSlot", "a", form(14000, 1))).booking.offer, false);
});

test("three people booking at the same moment get three different slots", async () => {
  for (const checkQueries of [true, false]) {
    const w = world({ checkQueries });
    const got = await Promise.all(["a", "b", "c"].map((id) => w.call("bookSlot", id, form(7000, 1))));
    const slots = got.map((r) => `${r.booking.slot_month}#${r.booking.slot_no}`);
    assert.equal(new Set(slots).size, 3, `distinct slots (checkQueries=${checkQueries}): ${slots}`);
    assert.deepEqual(got.map((r) => r.booking.slot_no).sort(), [5, 6, 7]);
    assert.equal(w.db.read("slot_months/2026-10").taken.join(), "5,6,7");
    assert.ok(w.db.stats.retries > 0, "the collisions were detected and retried");
  }
});

test("ten people racing for three slots: three get this month, the rest the next month, no duplicates", async () => {
  const w = world();
  const ids = Array.from({ length: 10 }, (_, i) => "user" + i);
  const got = await Promise.all(ids.map((id) => w.call("bookSlot", id, form(7000, 1))));
  const slots = got.map((r) => `${r.booking.slot_month}#${r.booking.slot_no}`);
  assert.equal(new Set(slots).size, 10);
  assert.equal(got.filter((r) => r.booking.slot_month === "2026-10").length, 3);
});

/* ------------------------------------------------------------ submitPayment */

test("a payment slip is stored, the UTR is reserved and the order moves to payment review", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(12000));
  w.clock.now += 5 * 60000; // pays five minutes later
  const out = await w.call("submitPayment", "cust1", payment(w, "cust1", booking, { utr: "sbin-123 4567" }));
  const pay = w.db.read(`payments/${out.payment_id}`);
  assert.deepEqual(
    { milestone: pay.milestone, amount: pay.amount, expected: pay.expected, utr: pay.utr, status: pay.status, user: pay.user_id },
    { milestone: "booking10", amount: 111348, expected: 111348, utr: "SBIN-123 4567", status: "submitted", user: "cust1" }
  );
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "payment_review");
  assert.ok(w.db.read("utr_index/SBIN1234567"), "the UTR is reserved without dashes or spaces");
  const updates = w.db.list(`bookings/${booking.id}/updates`).sort((a, b) => a.created_at - b.created_at);
  assert.equal(updates.at(-1).note, "Payment slip for 10% of total order value submitted (UTR SBIN-123 4567).");
  assert.equal(updates.at(-1).by_role, "customer");
});

test("the amount can differ from what is due: Accounts sees both numbers", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(12000));
  const out = await w.call("submitPayment", "cust1", payment(w, "cust1", booking, { amount: 100000 }));
  const pay = w.db.read(`payments/${out.payment_id}`);
  assert.deepEqual([pay.amount, pay.expected], [100000, 111348]);
});

test("a slip must be a file this customer uploaded for this very order", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(12000));
  const other = (await w.call("bookSlot", "cust1", form(7000, 1))).booking;
  const base = payment(w, "cust1", booking);
  const message = "Attach your payment slip (photo or PDF).";
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: "" }), 400, message);
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: undefined }), 400, message);
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: `payment-slips/cust1/${booking.id}/never-uploaded.jpg` }), 400, message);
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: slipFor(w, "cust1", other.id) }), 400, message); // another order's file
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: slipFor(w, "someone-else", booking.id) }), 400, message); // another person's file
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: `payment-slips/cust1/${booking.id}/../x.jpg` }), 400, message);
  await fails(w.call("submitPayment", "cust1", { ...base, slip_path: `dispatch-docs/${booking.id}/qc-1.pdf` }), 400, message);
  assert.equal(w.db.list("payments").length, 0);
});

test("a blank reference, a duplicate reference, a wrong step and a missing order give the exact messages", async () => {
  const w = world();
  const a = (await w.call("bookSlot", "cust1", form(12000))).booking;
  const b = (await w.call("bookSlot", "cust2", form(12000))).booking;
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", a, { utr: "   " })), 400, "Enter the reference number from your bank or UPI app.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", a, { milestone: "approval40" })), 409, "This payment does not match the amount due.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", { id: "doesnotexist0000001" })), 404, "Booking not found.");
  await fails(w.call("submitPayment", "cust2", payment(w, "cust2", a)), 404, "Booking not found."); // not their order
  await w.call("submitPayment", "cust1", payment(w, "cust1", a, { utr: "HDFC9988776" }));
  await fails(w.call("submitPayment", "cust2", payment(w, "cust2", b, { utr: "hdfc-9988776" })), 409, "This UTR has already been submitted.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", a, { utr: "NEWREF123456" })), 409, "No payment is due on this booking right now.");
});

test("amount and date are checked", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(12000));
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", booking, { amount: 0 })), 400, "Enter the amount you paid.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", booking, { amount: "abc" })), 400, "Enter the amount you paid.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", booking, { paid_on: "" })), 400, "Enter the payment date.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", booking, { paid_on: "2026-02-31" })), 400, "Enter the payment date.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", booking, { paid_on: "2026-10-02" })), 400, "Payment date cannot be in the future.");
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", booking, { paid_on: "2024-01-01" })), 400, "Check the payment date. It is too long ago.");
});

test("paying after the hold ran out: if another brand took the slot the order is cancelled and the slip is refused", async () => {
  const w = world();
  const mine = (await w.call("bookSlot", "cust1", form(12000))).booking; // slot 5
  w.clock.now = NOW + 49 * HOUR;
  const theirs = (await w.call("bookSlot", "cust2", form(7000, 1))).booking;
  assert.equal(theirs.slot_no, 5);
  await fails(w.call("submitPayment", "cust1", payment(w, "cust1", mine, { paid_on: "2026-10-03" })), 409,
    "Your hold expired and this slot was taken. Please book a new slot — your slip was not submitted.");
  assert.equal(w.db.read(`bookings/${mine.id}`).stage, "cancelled");
  assert.equal(w.db.list("payments").length, 0);
  assert.equal(w.db.read("utr_index/SBIN1234567"), undefined, "the UTR is not locked by a refused slip");
});

test("paying after the hold ran out but with the slot still free: the payment goes through and the slot is held again", async () => {
  const w = world();
  const mine = (await w.call("bookSlot", "cust1", form(12000))).booking;
  w.clock.now = NOW + 49 * HOUR;
  await w.call("submitPayment", "cust1", payment(w, "cust1", mine, { paid_on: "2026-10-03" }));
  assert.equal(w.db.read(`bookings/${mine.id}`).stage, "payment_review");
  assert.equal(w.db.read("slot_months/2026-10").taken.join(), "5", "the slot is on the board again");
  const later = (await w.call("bookSlot", "cust2", form(7000, 1))).booking;
  assert.equal(later.slot_no, 6, "and nobody else is given it");
});

/* ------------------------------------------------------------ reviewPayment */

async function submitted(w, packs = 12000) {
  const { booking } = await w.call("bookSlot", "cust1", form(packs));
  const out = await w.call("submitPayment", "cust1", payment(w, "cust1", booking, { amount: Math.round(booking.order_value / 10) }));
  return { booking, paymentId: out.payment_id };
}

test("Accounts verifies the 10%: the order is confirmed and the customer sees the note", async () => {
  const w = world({ seed: { "profiles/acct1": { name: "Meera (Accounts)", role: "accounts" } } });
  const { booking, paymentId } = await submitted(w);
  w.clock.now += 60000; // the review happens a minute later
  await w.call("reviewPayment", "acct1", { payment_id: paymentId, ok: true, note: "" }, "accounts");
  assert.equal(w.db.read(`bookings/${booking.id}`).stage, "confirmed");
  const pay = w.db.read(`payments/${paymentId}`);
  assert.deepEqual([pay.status, pay.reviewed_by], ["verified", "acct1"]);
  const last = w.db.list(`bookings/${booking.id}/updates`).sort((a, b) => a.created_at - b.created_at).at(-1);
  assert.equal(last.note, "Payment of ₹1,02,000 verified by Accounts.");
  assert.deepEqual([last.by_role, last.by_name, last.stage], ["accounts", "Meera (Accounts)", "confirmed"]);
  assert.ok(w.db.read("utr_index/SBIN1234567"), "a verified UTR stays reserved");
});

test("rejecting needs a reason; a rejected 10% returns to payment with a fresh hold and frees the UTR", async () => {
  const w = world();
  const { booking, paymentId } = await submitted(w);
  await fails(w.call("reviewPayment", "acct1", { payment_id: paymentId, ok: false, note: "  " }, "accounts"), 400,
    "Write the reason for rejection — the customer will see it.");
  assert.equal(w.db.read(`payments/${paymentId}`).status, "submitted", "nothing changed");

  w.clock.now = NOW + 30 * HOUR;
  await w.call("reviewPayment", "acct1", { payment_id: paymentId, ok: false, note: "Amount on slip is not clear" }, "accounts");
  const b = w.db.read(`bookings/${booking.id}`);
  assert.equal(b.stage, "awaiting_payment");
  assert.equal(b.hold_until.getTime() - w.clock.now, 48 * HOUR, "a fresh 48 hours");
  assert.equal(w.db.read(`payments/${paymentId}`).status, "rejected");
  assert.equal(w.db.read("utr_index/SBIN1234567"), undefined);
  const last = w.db.list(`bookings/${booking.id}/updates`).sort((x, y) => x.created_at - y.created_at).at(-1);
  assert.equal(last.note, "Payment slip rejected: Amount on slip is not clear");

  // the customer sends a corrected slip with the same UTR
  const again = await w.call("submitPayment", "cust1", payment(w, "cust1", booking, { amount: 102000, slip_path: slipFor(w, "cust1", booking.id, "2.jpg") }));
  assert.ok(again.payment_id);
});

test("a payment can be reviewed only once, and only while the order waits for review", async () => {
  const w = world();
  const { booking, paymentId } = await submitted(w);
  await w.call("reviewPayment", "acct1", { payment_id: paymentId, ok: true }, "accounts");
  await fails(w.call("reviewPayment", "acct2", { payment_id: paymentId, ok: false, note: "x" }, "accounts"), 409, "This payment was already reviewed.");
  await fails(w.call("reviewPayment", "acct1", { payment_id: "nothere0000000000001", ok: true }, "accounts"), 404, "Payment not found.");

  const w2 = world();
  const s2 = await submitted(w2);
  w2.db.put(`bookings/${s2.booking.id}`, { ...w2.db.read(`bookings/${s2.booking.id}`), stage: "confirmed" }); // Admin moved it meanwhile
  await fails(w2.call("reviewPayment", "acct1", { payment_id: s2.paymentId, ok: true }, "accounts"), 409,
    "This order is no longer waiting for payment review. Reload the page.");
});

test("the 40% (with approval fee) and 50% steps follow the stage map", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 6));
  const bPath = `bookings/${booking.id}`;
  const set = (stage) => w.db.put(bPath, { ...w.db.read(bPath), stage });

  set("awaiting_40");
  const p40 = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "approval40", amount: 288000, utr: "UTR40AAAAAA" }) });
  assert.equal(w.db.read(`payments/${p40.payment_id}`).expected, 281592);
  await w.call("reviewPayment", "acct1", { payment_id: p40.payment_id, ok: true }, "accounts");
  assert.equal(w.db.read(bPath).stage, "approval_packaging");

  set("awaiting_50");
  const p50 = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "delivery50", amount: 351990, utr: "UTR50BBBBBB" }) });
  assert.equal(w.db.read(`payments/${p50.payment_id}`).expected, 351990);
  await w.call("reviewPayment", "acct1", { payment_id: p50.payment_id, ok: true }, "admin");
  assert.equal(w.db.read(bPath).stage, "shipping_quote");

  set("awaiting_shipping");
  w.db.put(bPath, { ...w.db.read(bPath), shipping_charge: 12500 });
  const ps = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "shipping", amount: 12500, utr: "UTRSHIPCCCCCC" }) });
  assert.equal(w.db.read(`payments/${ps.payment_id}`).expected, 12500);
  await w.call("reviewPayment", "acct1", { payment_id: ps.payment_id, ok: true }, "accounts");
  assert.equal(w.db.read(bPath).stage, "docs_pending");
});

test("rejecting 40%, 50% or shipping sends that step back for a new slip and does not advance the order", async () => {
  const w = world();
  const { booking } = await w.call("bookSlot", "cust1", form(7000, 6));
  const bPath = `bookings/${booking.id}`;
  const set = (stage, extra = {}) => w.db.put(bPath, { ...w.db.read(bPath), stage, ...extra });

  set("awaiting_40");
  const p40 = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "approval40", amount: 281592, utr: "UTR40REJECT1" }) });
  await w.call("reviewPayment", "acct1", { payment_id: p40.payment_id, ok: false, note: "UTR does not match the bank" }, "accounts");
  assert.equal(w.db.read(bPath).stage, "awaiting_40");
  assert.equal(w.db.read(`payments/${p40.payment_id}`).status, "rejected");
  assert.equal(w.db.read("utr_index/UTR40REJECT1"), undefined);
  const again40 = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "approval40", amount: 281592, utr: "UTR40REJECT1", slip_path: slipFor(w, "cust1", booking.id, "40b.jpg") }) });
  assert.equal(w.db.read(bPath).stage, "payment_review");
  await w.call("reviewPayment", "acct1", { payment_id: again40.payment_id, ok: false, note: "Still unclear" }, "accounts");
  assert.equal(w.db.read(bPath).stage, "awaiting_40");

  set("awaiting_50");
  const p50 = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "delivery50", amount: 351990, utr: "UTR50REJECT1" }) });
  await w.call("reviewPayment", "acct1", { payment_id: p50.payment_id, ok: false, note: "Wrong amount" }, "accounts");
  assert.equal(w.db.read(bPath).stage, "awaiting_50");
  assert.notEqual(w.db.read(bPath).stage, "shipping_quote");

  set("awaiting_shipping", { shipping_charge: 12500 });
  const ps = await w.call("submitPayment", "cust1", { ...payment(w, "cust1", booking, { milestone: "shipping", amount: 12500, utr: "UTRSHIPREJ1" }) });
  await w.call("reviewPayment", "acct1", { payment_id: ps.payment_id, ok: false, note: "Slip is for another account" }, "accounts");
  assert.equal(w.db.read(bPath).stage, "awaiting_shipping");
  assert.equal(w.db.read(`payments/${ps.payment_id}`).status, "rejected");
});

/* ------------------------------------------------------------- slot board */

test("the slot board is rebuilt from real bookings, and rewritten only when it changed", async () => {
  const w = world();
  await w.call("bookSlot", "a", form(7000, 1));
  assert.equal(await recomputeSlotMonth(w.db, "2026-10", { monthSlots: 15, royalSwagReserved: 8, offlineSlots: { "2026-10": 4 } }, NOW), false, "already correct");
  w.clock.now = NOW + 49 * HOUR; // the hold ran out
  const changed = await recomputeSlotMonths(w.db, w.clock.now);
  assert.deepEqual(changed, ["2026-10", "2026-11"], "October is corrected; November is published for the first time");
  assert.deepEqual(w.db.read("slot_months/2026-10").taken, []);
  assert.deepEqual(await recomputeSlotMonths(w.db, w.clock.now), [], "second run changes nothing");
  assert.ok(w.db.read("slot_months/2026-11"), "next month is published too");
});

test("saving Settings refreshes the slot board", async () => {
  const w = world();
  await w.call("bookSlot", "a", form(7000, 1));
  await w.call("saveSettings", "admin1", { settings: { monthSlots: 15, royalSwagReserved: 8, offlineSlots: { "2026-10": 6 }, holdHours: 48 } }, "admin");
  const board = w.db.read("slot_months/2026-10");
  assert.equal(board.offline, 6);
});
