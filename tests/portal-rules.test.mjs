import test from "node:test";
import assert from "node:assert/strict";
import {
  MILESTONES, PROD_NEXT, PROD_VISIBLE, RuleError, STAGE_KEYS, addMonth, approvalFee, dueAmount, dueMilestone,
  isActive, monthKeyIST, orderValue, priceForPacks, stageIndex, toAppRole, toMillis, toSpecRole, validateBatch
} from "../shared/portal-rules.js";

const six = [
  { name: "Clove", packs: 2000 }, { name: "Regular", packs: 1000 }, { name: "Mint", packs: 1000 },
  { name: "Frutta", packs: 1000 }, { name: "Pan", packs: 1000 }, { name: "Ginger", packs: 1000 }
];

test("price ladder", () => {
  assert.equal(priceForPacks(7000), 90);
  assert.equal(priceForPacks(8000), 90);
  assert.equal(priceForPacks(9000), 87);
  assert.equal(priceForPacks(11000), 87);
  assert.equal(priceForPacks(12000), 85);
  assert.equal(priceForPacks(13000), 85);
  assert.equal(priceForPacks(14000), 83);
  assert.equal(priceForPacks(30000), 83);
});

test("12,000 packs: order Rs 10.20 L and 10% booking is Rs 1,02,000", () => {
  const booking = { order_value: orderValue(12000), approval_fee: approvalFee(3) };
  assert.equal(booking.order_value, 1020000);
  assert.equal(dueAmount(booking, "booking10"), 102000);
});

test("7,000 packs, 6 flavours: 40% + fee = Rs 2,88,000 and 50% = Rs 3,15,000", () => {
  const booking = { order_value: orderValue(7000), approval_fee: approvalFee(6) };
  assert.equal(booking.order_value, 630000);
  assert.equal(booking.approval_fee, 36000);
  assert.equal(dueAmount(booking, "booking10"), 63000);
  assert.equal(dueAmount(booking, "approval40"), 288000);
  assert.equal(dueAmount(booking, "delivery50"), 315000);
});

test("shipping amount is the figure Accounts set, rounded to whole rupees", () => {
  assert.equal(dueAmount({ shipping_charge: 12500 }, "shipping"), 12500);
  assert.equal(dueAmount({ shipping_charge: 0 }, "shipping"), 0);
  assert.equal(dueAmount({}, "shipping"), 0);
  assert.equal(dueAmount({ shipping_charge: 99.6 }, "shipping"), 100);
});

test("unknown payment step is refused", () => {
  assert.throws(() => dueAmount({}, "nope"), RuleError);
});

test("a due milestone exists only for customer-payment stages", () => {
  assert.equal(dueMilestone("awaiting_payment"), "booking10");
  assert.equal(dueMilestone("awaiting_40"), "approval40");
  assert.equal(dueMilestone("awaiting_50"), "delivery50");
  assert.equal(dueMilestone("awaiting_shipping"), "shipping");
  assert.equal(dueMilestone("manufacturing"), null);
  assert.equal(dueMilestone("payment_review"), null);
});

test("every milestone points at real stages", () => {
  for (const m of Object.values(MILESTONES)) {
    assert.ok(STAGE_KEYS.includes(m.stage));
    assert.ok(STAGE_KEYS.includes(m.ok));
  }
});

test("production can move only one step forward, and never skip payments", () => {
  assert.deepEqual(PROD_NEXT, {
    confirmed: "label_design", label_design: "awaiting_40", approval_packaging: "manufacturing",
    manufacturing: "qc", dispatched: "delivered"
  });
  assert.notEqual(PROD_NEXT.label_design, "approval_packaging");
  assert.equal(PROD_NEXT.qc, undefined);
  assert.equal(PROD_NEXT.ready_dispatch, undefined);
});

test("production never sees unpaid or cancelled orders", () => {
  for (const s of ["awaiting_payment", "payment_review", "cancelled"]) assert.ok(!PROD_VISIBLE.includes(s));
  assert.ok(PROD_VISIBLE.includes("confirmed"));
  assert.ok(PROD_VISIBLE.includes("delivered"));
  assert.ok(stageIndex("confirmed") < stageIndex("delivered"));
});

test("validateBatch accepts a good batch", () => {
  const r = validateBatch(7000, six);
  assert.equal(r.packs, 7000);
  assert.equal(r.flavours.length, 6);
});

test("validateBatch gives the exact customer messages", () => {
  const msg = (fn) => { try { fn(); } catch (e) { return e.message; } return "no error"; };
  assert.equal(msg(() => validateBatch(6000, [{ name: "Clove", packs: 6000 }])), "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  assert.equal(msg(() => validateBatch(7500, [{ name: "Clove", packs: 7500 }])), "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  assert.equal(msg(() => validateBatch(31000, [{ name: "Clove", packs: 31000 }])), "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  assert.equal(msg(() => validateBatch(7000, [])), "Choose 1 to 6 flavours.");
  assert.equal(msg(() => validateBatch(7000, undefined)), "Choose 1 to 6 flavours.");
  assert.equal(msg(() => validateBatch(7000, [{ name: "Clove", packs: 6000 }, { name: "Mint", packs: 500 }, { name: "Pan", packs: 500 }])), "Flavour split must be in lots of 1,000 packs.");
  assert.equal(msg(() => validateBatch(7000, [{ name: "Clove", packs: 3000 }, { name: "Mint", packs: 3000 }])), "Flavour split must be in lots of 1,000 packs.");
});

test("validateBatch refuses repeated or made-up flavours and non-numbers", () => {
  assert.throws(() => validateBatch(7000, [{ name: "Clove", packs: 3500 }, { name: "Clove", packs: 3500 }]), RuleError);
  assert.throws(() => validateBatch(7000, [{ name: "Chocolate", packs: 7000 }]), RuleError);
  assert.throws(() => validateBatch("abc", six), RuleError);
  assert.throws(() => validateBatch(7000, [{ name: "Clove", packs: "7000x" }]), RuleError);
  assert.throws(() => validateBatch(7000, [null]), RuleError);
  assert.throws(() => validateBatch(7000, Array(7).fill({ name: "Clove", packs: 1000 })), RuleError);
});

test("isActive: hold expiry only matters at the first payment stage", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  const past = new Date(now - 1000).toISOString();
  const future = new Date(now + 1000).toISOString();
  assert.equal(isActive({ stage: "awaiting_payment", hold_until: future }, now), true);
  assert.equal(isActive({ stage: "awaiting_payment", hold_until: past }, now), false);
  assert.equal(isActive({ stage: "confirmed", hold_until: past }, now), true);
  assert.equal(isActive({ stage: "cancelled", hold_until: future }, now), false);
  assert.equal(isActive(null, now), false);
});

test("toMillis reads dates, Firestore-like timestamps, ISO strings and numbers", () => {
  const t = Date.parse("2026-10-05T10:00:00Z");
  assert.equal(toMillis(t), t);
  assert.equal(toMillis(new Date(t)), t);
  assert.equal(toMillis({ toMillis: () => t }), t);
  assert.equal(toMillis({ seconds: t / 1000, nanoseconds: 0 }), t);
  assert.equal(toMillis("2026-10-05T10:00:00Z"), t);
  assert.ok(Number.isNaN(toMillis(null)));
});

test("month key uses India time", () => {
  assert.equal(monthKeyIST(new Date("2026-09-30T18:29:00Z")), "2026-09");
  assert.equal(monthKeyIST(new Date("2026-09-30T18:30:00Z")), "2026-10");
  assert.equal(monthKeyIST(new Date("2026-12-31T20:00:00Z")), "2027-01");
});

test("addMonth rolls the year", () => {
  assert.equal(addMonth("2026-10"), "2026-11");
  assert.equal(addMonth("2026-12"), "2027-01");
});

test("9,000 packs is ₹87 and ₹7.83 L", () => {
  assert.equal(priceForPacks(9000), 87);
  assert.equal(orderValue(9000), 783000);
});

test("role names convert both ways", () => {
  assert.equal(toSpecRole("user"), "customer");
  assert.equal(toSpecRole("admin"), "admin");
  assert.equal(toSpecRole("accounts"), "accounts");
  assert.equal(toSpecRole("production"), "production");
  assert.equal(toSpecRole("anything-else"), "customer");
  assert.equal(toAppRole("customer"), "user");
  assert.equal(toAppRole("admin"), "admin");
});
