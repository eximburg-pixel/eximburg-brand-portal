import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dueAmount, orderValue, priceForPacks, PROD_NEXT } from "../shared/portal-rules.js";
import { DEFAULT_SETTINGS } from "../shared/portal-settings.js";
import { orderPlan } from "../shared/portal-timeline.js";

const user = readFileSync(new URL("../user.html", import.meta.url), "utf8");
const team = readFileSync(new URL("../team.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("§14 Customer: 7,000-pack plan at ₹6.30 L is ₹3,90,000 short of the 12,000-pack offer unlock", () => {
  assert.equal(orderValue(7000), 630000);
  assert.equal(orderValue(12000), 1020000);
  assert.equal(orderValue(12000) - orderValue(7000), 390000);
  assert.equal(DEFAULT_SETTINGS.offer.threshold, 1000000);
  assert.ok(orderValue(7000) < DEFAULT_SETTINGS.offer.threshold);
  assert.ok(orderValue(12000) >= DEFAULT_SETTINGS.offer.threshold);
  assert.match(user, /data-act="offerup"/);
  assert.match(user, /Switch to \$\{num\(st\.T\)\} packs/);
});

test("§14 Customer: 12,000 packs is ₹85, 10% is ₹1,02,000; 9,000 packs is ₹87 (₹7.83 L)", () => {
  assert.equal(priceForPacks(12000), 85);
  assert.equal(dueAmount({ order_value: orderValue(12000), approval_fee: 0 }, "booking10"), 102000);
  assert.equal(priceForPacks(9000), 87);
  assert.equal(orderValue(9000), 783000);
});

test("§14 Customer: UPI QR encodes amount and booking code; over ₹1 L shows the bank-transfer note", () => {
  assert.match(user, /upi:\/\/pay\?pa=\$\{encodeURIComponent\(u\.id\)\}/);
  assert.match(user, /am=\$\{amt\}\.00/);
  assert.match(user, /tn=\$\{encodeURIComponent\(b\.code\)\}/);
  assert.match(user, /amt>100000/);
  assert.match(user, /Most banks cap UPI at ₹1 lakh a day/);
});

test("§14 Customer: the client cannot write a role, and sign-up is Netlify email (not phone+password)", () => {
  assert.match(rules, /match \/profiles\/\{uid\}[\s\S]*allow write: if false;/);
  assert.ok(!/signUp\(/.test(user));
  assert.ok(!/phone\+password|signInWithPassword/.test(user));
});

test("§14 Accounts: payment card shows mismatch; reject without a reason is blocked in the panel", () => {
  assert.match(team, /vs expected/);
  assert.match(team, /class="mismatch"/);
  assert.match(team, /Write the reason for rejection first/);
});

test("§14 Accounts: 40% of 7,000 packs / 6 flavours is ₹2,88,000; 50% is ₹3,15,000", () => {
  const booking = { order_value: orderValue(7000), approval_fee: 6 * 6000 };
  assert.equal(dueAmount(booking, "approval40"), 288000);
  assert.equal(dueAmount(booking, "delivery50"), 315000);
});

test("§14 Production: skipping label_design → approval_packaging is not in PROD_NEXT", () => {
  assert.equal(PROD_NEXT.label_design, "awaiting_40");
  assert.notEqual(PROD_NEXT.label_design, "approval_packaging");
});

test("§14 Production: 1 Oct / 7,000 packs → 20 Dec target, 19 Jan latest", () => {
  const p = orderPlan({
    packs: 7000, stage: "confirmed",
    upd: [{ stage: "confirmed", created_at: "2026-10-01T10:00:00Z" }]
  });
  assert.equal(p.dispatchBy.toISOString().slice(0, 10), "2026-12-20");
  assert.equal(p.dispatchLatest.toISOString().slice(0, 10), "2027-01-19");
});

test("§14 Admin: CSV is UTF-8 with a BOM so Hindi survives Excel, and Settings save goes through the server", () => {
  assert.match(team, /\\ufeff/);
  assert.match(team, /text\/csv/);
  assert.match(team, /DB\.saveSettings\(/);
});

test("§14 Admin: Live activity and funnel read the mapped tracker events", () => {
  assert.match(team, /VIEWS\.activity/);
  assert.match(team, /DBX\.funnelFrom\(D, Q\.range\)/);
  assert.match(team, /DBX\.dropRates\(D\.sessions/);
});
