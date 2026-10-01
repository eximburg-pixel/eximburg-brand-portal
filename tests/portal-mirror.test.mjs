import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionOrder, isProductionVisible } from "../shared/portal-mirror.js";

const T = Date.parse("2026-10-05T10:00:00Z");
const MONEY = ["price", "order_value", "approval_fee", "shipping_charge", "offer", "gstin", "hold_until", "user_id", "payments", "utr", "call_time"];

const booking = (over = {}) => ({
  code: "EXB-1", brand: "Zest", name: "Ravi", city: "Surat", phone: "9876543210",
  slot_month: "2026-10", slot_no: 5, packs: 7000, flavours: [{ name: "Clove", packs: 7000, price: 90 }],
  stage: "confirmed", created_at: new Date(T), updated_at: new Date(T),
  price: 90, order_value: 630000, approval_fee: 6000, shipping_charge: 12500, offer: true,
  gstin: "24ABCDE1234F1Z5", hold_until: new Date(T), user_id: "cust1", call_time: "Morning",
  dispatch: { qc_path: "q", invoice_no: "INV-1", shipping_note: "₹500 by road", transporter: "T" },
  ...over
});

test("the factory copy exists only for stages Production may see", () => {
  assert.equal(isProductionVisible("confirmed"), true);
  assert.equal(isProductionVisible("awaiting_payment"), false);
  assert.equal(isProductionVisible("payment_review"), false);
  assert.equal(isProductionVisible("cancelled"), false);
  assert.equal(buildProductionOrder("b1", booking({ stage: "awaiting_payment" }), []), null);
  assert.equal(buildProductionOrder("b1", booking({ stage: "payment_review" }), []), null);
  assert.equal(buildProductionOrder("b1", booking({ stage: "cancelled" }), []), null);
});

test("money, GSTIN, the hold, the customer id and Accounts notes never appear on the factory copy", () => {
  const updates = [
    { stage: "awaiting_payment", note: "Pay ₹1,02,000", by_role: "system", by_name: "System", created_at: new Date(T) },
    { stage: "payment_review", note: "UTR SBIN123", by_role: "customer", by_name: "Ravi", created_at: new Date(T + 1) },
    { stage: "confirmed", note: "Payment of ₹1,02,000 verified by Accounts.", by_role: "accounts", by_name: "Meera", created_at: new Date(T + 2), internal: true },
    { stage: "label_design", note: "Designer assigned", by_role: "production", by_name: "Priya", created_at: new Date(T + 3) },
    { stage: "manufacturing", note: "Batch cost ₹50k", by_role: "production", by_name: "Priya", created_at: new Date(T + 4) }
  ];
  const row = buildProductionOrder("b1", booking({ stage: "manufacturing" }), updates);
  for (const key of MONEY) assert.equal(row[key], undefined, key);
  assert.equal(row.flavours[0].price, undefined);
  assert.equal(row.dispatch.shipping_note, undefined);
  assert.equal(row.dispatch.invoice_no, undefined, "invoice only once the order is ready to dispatch");
  assert.equal(row.dispatch.qc_path, "q");
  const text = JSON.stringify(row);
  assert.equal(text.includes("₹"), false);
  assert.equal(text.includes("UTR"), false);
  assert.equal(text.includes("630000"), false);
  assert.equal(text.includes("cust1"), false);
  assert.deepEqual(row.updates.map((u) => u.stage), ["confirmed", "label_design", "manufacturing"]);
  assert.equal(row.updates[0].note, "", "Accounts notes are blanked even on a visible stage");
  assert.equal(row.updates[1].note, "Designer assigned");
  assert.equal(row.updates[2].note, "", "a Production note that mentions money is blanked");
});

test("invoice and transporter details appear only once the order is ready to dispatch", () => {
  const late = buildProductionOrder("b1", booking({ stage: "ready_dispatch" }), []);
  assert.equal(late.dispatch.invoice_no, "INV-1");
  assert.equal(late.dispatch.transporter, "T");
  assert.equal(late.dispatch.shipping_note, undefined);
});
