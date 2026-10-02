import test from "node:test";
import assert from "node:assert/strict";
import {
  MILESTONES, PROD_NEXT, PROD_VISIBLE, RuleError, STAGE_KEYS, addMonth, approvalFee, customerTrackSteps, dueAmount, dueMilestone,
  isActive, monthKeyIST, orderTotals, orderValue, priceForPacks, stageIndex, toAppRole, toMillis, toSpecRole, validateBatch
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

test("12,000 packs, 3 flavours: GST is inside the total, and 10% is of that total", () => {
  const booking = { order_value: orderValue(12000), approval_fee: approvalFee(3) };
  const t = orderTotals(booking.order_value, booking.approval_fee);
  assert.equal(booking.order_value, 1020000);
  assert.equal(t.gstOrder, 51000);
  assert.equal(t.gstApproval, 3240);
  assert.equal(t.total, 1092240);
  assert.equal(t.pay10 + t.pay40 + t.pay50, t.total);
  assert.equal(dueAmount(booking, "booking10"), 109224);
});

test("7,000 packs, 6 flavours: 5% GST on the order, 18% on approval, then 10/40/50 of the total", () => {
  const booking = { order_value: orderValue(7000), approval_fee: approvalFee(6) };
  const t = orderTotals(booking.order_value, booking.approval_fee);
  assert.equal(booking.order_value, 630000);
  assert.equal(booking.approval_fee, 36000);
  assert.equal(t.gstOrder, 31500);
  assert.equal(t.gstApproval, 6480);
  assert.equal(t.total, 703980);
  assert.equal(dueAmount(booking, "booking10"), 70398);
  assert.equal(dueAmount(booking, "approval40"), 281592);
  assert.equal(dueAmount(booking, "delivery50"), 351990);
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

const TRACK = [
  ["Slot reserved", "स्लॉट रिज़र्व", "awaiting_payment"],
  ["10% verified", "10% वेरिफ़ाई", "confirmed"],
  ["Label design", "लेबल डिज़ाइन", "label_design"],
  ["40% verified", "40% वेरिफ़ाई", "approval_packaging"],
  ["Manufacturing", "मैन्युफैक्चरिंग", "manufacturing"],
  ["Quality check", "क्वालिटी चेक", "qc"],
  ["50% verified", "50% वेरिफ़ाई", "shipping_quote"],
  ["Shipping paid, invoice ready", "शिपिंग पेड, इनवॉइस तैयार", "ready_dispatch"],
  ["Dispatched", "डिस्पैच", "dispatched"],
  ["Delivered", "डिलीवर", "delivered"]
].map(([en, hi, stage]) => ({ en, hi, stage }));

const step = (booking, stage) => customerTrackSteps(booking, TRACK).find((s) => s.stage === stage);

test("a rejected payment stays on that step and is not labelled verified", () => {
  const rejected40 = step({
    stage: "awaiting_40",
    payments: [{ milestone: "approval40", status: "rejected", note: "Amount on slip is not clear" }]
  }, "approval_packaging");
  assert.equal(rejected40.cls, "cur");
  assert.match(rejected40.en, /Pay 40%/);
  assert.match(rejected40.en, /rejected, upload again/);
  assert.equal(step({ stage: "awaiting_40", payments: [{ milestone: "approval40", status: "rejected" }] }, "label_design").cls, "done");
  assert.equal(step({ stage: "awaiting_40", payments: [{ milestone: "approval40", status: "rejected" }] }, "manufacturing").cls, "");

  const rejected50 = step({ stage: "awaiting_50", payments: [{ milestone: "delivery50", status: "rejected" }] }, "shipping_quote");
  assert.equal(rejected50.cls, "cur");
  assert.match(rejected50.en, /Pay 50%/);
  assert.doesNotMatch(rejected50.en, /verified/);

  const rejectedShip = step({ stage: "awaiting_shipping", payments: [{ milestone: "shipping", status: "rejected" }] }, "ready_dispatch");
  assert.equal(rejectedShip.cls, "cur");
  assert.match(rejectedShip.en, /Pay shipping/);
  assert.equal(step({ stage: "awaiting_shipping", payments: [{ milestone: "shipping", status: "rejected" }] }, "shipping_quote").cls, "done");
});

test("while accounts is checking, the open payment is that step, and a rejected slip is not used as the one being checked", () => {
  const checking = step({
    stage: "payment_review",
    payments: [
      { milestone: "approval40", status: "rejected" },
      { milestone: "approval40", status: "submitted" }
    ]
  }, "approval_packaging");
  assert.equal(checking.cls, "cur");
  assert.match(checking.en, /accounts checking/);
  assert.doesNotMatch(checking.en, /verified/);

  const onlyRejected = step({
    stage: "payment_review",
    payments: [{ milestone: "approval40", status: "rejected" }]
  }, "approval_packaging");
  assert.notEqual(onlyRejected.cls, "cur");
});

test("after a payment is verified the success label is the current step", () => {
  const verified = step({ stage: "approval_packaging", payments: [{ milestone: "approval40", status: "verified" }] }, "approval_packaging");
  assert.equal(verified.cls, "cur");
  assert.equal(verified.en, "40% verified");
  assert.equal(step({ stage: "confirmed", payments: [{ milestone: "booking10", status: "verified" }] }, "confirmed").en, "10% verified");
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
