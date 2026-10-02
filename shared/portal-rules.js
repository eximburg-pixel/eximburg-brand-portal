/*
  Shared business rules for the Eximburg portal.
  Used by the browser pages AND by the Netlify Functions, so both always agree.
  The functions are the authority: the browser may show these numbers, but never decides them.
  Pure code only: no browser, no Node, no Firebase here, so it can be unit tested.
*/

export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuleError";
  }
}

/* ---------- pricing (spec section 3) ---------- */
export const PRICING = {
  lot: 1000,
  minPacks: 7000,
  maxPacks: 30000,
  maxFlavours: 6,
  approvalFeePerFlavour: 6000,
  basePrice: 90
};

export function priceForPacks(packs) {
  const p = Number(packs);
  return p >= 14000 ? 83 : p >= 12000 ? 85 : p >= 9000 ? 87 : 90;
}

export const FLAVOUR_NAMES = ["Clove", "Regular", "Mint", "Frutta", "Pan", "Ginger"];

/*
  Checks a batch and returns clean numbers. Throws RuleError with the text the customer sees.
  flavours: [{ name, packs }]
*/
export function validateBatch(packsInput, flavoursInput) {
  const packs = Number(packsInput);
  const flavours = Array.isArray(flavoursInput) ? flavoursInput : [];
  if (!Number.isInteger(packs) || packs < PRICING.minPacks || packs > PRICING.maxPacks || packs % PRICING.lot !== 0) {
    throw new RuleError("Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  }
  if (flavours.length < 1 || flavours.length > PRICING.maxFlavours) {
    throw new RuleError("Choose 1 to 6 flavours.");
  }
  const seen = new Set();
  const clean = [];
  let total = 0;
  for (const item of flavours) {
    const name = String(item && item.name != null ? item.name : "");
    const count = Number(item && item.packs);
    if (!FLAVOUR_NAMES.includes(name) || seen.has(name)) {
      throw new RuleError("Choose each flavour only once, from the list.");
    }
    if (!Number.isInteger(count) || count < PRICING.lot || count % PRICING.lot !== 0) {
      throw new RuleError("Flavour split must be in lots of 1,000 packs.");
    }
    seen.add(name);
    total += count;
    clean.push({ name, packs: count });
  }
  if (total !== packs) {
    throw new RuleError("Flavour split must be in lots of 1,000 packs.");
  }
  return { packs, flavours: clean };
}

export function orderValue(packs) {
  return Number(packs) * priceForPacks(packs);
}

export function approvalFee(flavourCount) {
  return Number(flavourCount) * PRICING.approvalFeePerFlavour;
}

/* ---------- order stages (spec section 4) ---------- */
export const STAGES = [
  { k: "awaiting_payment", en: "Pay 10% booking amount", hi: "10% बुकिंग राशि जमा करें", who: "customer" },
  { k: "payment_review", en: "Payment under verification", hi: "पेमेंट वेरिफ़िकेशन में", who: "accounts" },
  { k: "confirmed", en: "Slot confirmed", hi: "स्लॉट कन्फ़र्म", who: "production" },
  { k: "label_design", en: "Label design", hi: "लेबल डिज़ाइन", who: "production" },
  { k: "awaiting_40", en: "Pay 40% (approval & packaging)", hi: "40% जमा करें (अप्रूवल व पैकेजिंग)", who: "customer" },
  { k: "approval_packaging", en: "Govt approval + packaging", hi: "सरकारी अप्रूवल + पैकेजिंग", who: "production" },
  { k: "manufacturing", en: "Manufacturing", hi: "मैन्युफैक्चरिंग", who: "production" },
  { k: "qc", en: "Quality check", hi: "क्वालिटी चेक", who: "production" },
  { k: "awaiting_50", en: "Pay 50% before dispatch", hi: "डिस्पैच से पहले 50% जमा करें", who: "customer" },
  { k: "shipping_quote", en: "Shipping charge being calculated", hi: "शिपिंग चार्ज तय हो रहा है", who: "accounts" },
  { k: "awaiting_shipping", en: "Pay shipping charges", hi: "शिपिंग चार्ज जमा करें", who: "customer" },
  { k: "docs_pending", en: "Invoice & e-way bill being prepared", hi: "इनवॉइस और ई-वे बिल बन रहा है", who: "accounts" },
  { k: "ready_dispatch", en: "Ready for dispatch", hi: "डिस्पैच के लिए तैयार", who: "production" },
  { k: "dispatched", en: "Dispatched", hi: "डिस्पैच हो गया", who: "production" },
  { k: "delivered", en: "Delivered", hi: "डिलीवर हो गया", who: "-" },
  { k: "cancelled", en: "Cancelled", hi: "रद्द", who: "-" }
];

export const STAGE_KEYS = STAGES.map((s) => s.k);

export const MILESTONES = {
  booking10: { en: "10% of total order value", hi: "कुल ऑर्डर वैल्यू का 10%", stage: "awaiting_payment", ok: "confirmed", pct: 0.1, fee: false },
  approval40: { en: "40% of total order value", hi: "कुल ऑर्डर वैल्यू का 40%", stage: "awaiting_40", ok: "approval_packaging", pct: 0.4, fee: false },
  delivery50: { en: "50% of total order value", hi: "कुल ऑर्डर वैल्यू का 50%", stage: "awaiting_50", ok: "shipping_quote", pct: 0.5, fee: false },
  shipping: { en: "Shipping charges", hi: "शिपिंग चार्ज", stage: "awaiting_shipping", ok: "docs_pending", pct: 0, fee: false, fixed: true }
};

/* 5% GST on the product order, 18% GST on the product approval fee. */
export const GST_ORDER_RATE = 0.05;
export const GST_APPROVAL_RATE = 0.18;

/*
  Total order value = product order + product approval + both GST amounts.
  The 10 / 40 / 50 booking split is of that total, and the three shares add back to it.
*/
export function orderTotals(orderValueAmount, approvalFeeAmount) {
  const order = Math.round(Number(orderValueAmount) || 0);
  const approval = Math.round(Number(approvalFeeAmount) || 0);
  const gstOrder = Math.round(order * GST_ORDER_RATE);
  const gstApproval = Math.round(approval * GST_APPROVAL_RATE);
  const gst = gstOrder + gstApproval;
  const total = order + approval + gst;
  const pay10 = Math.round(total * 0.1);
  const pay40 = Math.round(total * 0.4);
  const pay50 = total - pay10 - pay40;
  return { order, approval, gstOrder, gstApproval, gst, total, pay10, pay40, pay50 };
}

/* Production may move an order one step forward only. Payments, QC and dispatch move the rest. */
export const PROD_NEXT = {
  confirmed: "label_design",
  label_design: "awaiting_40",
  approval_packaging: "manufacturing",
  manufacturing: "qc",
  dispatched: "delivered"
};

/* Orders Production may see (the money-free mirror exists only for these). */
export const PROD_VISIBLE = [
  "confirmed", "label_design", "awaiting_40", "approval_packaging", "manufacturing", "qc",
  "awaiting_50", "shipping_quote", "awaiting_shipping", "docs_pending", "ready_dispatch", "dispatched", "delivered"
];

export const stageIndex = (key) => STAGE_KEYS.indexOf(key);

export const dueMilestone = (stage) => Object.keys(MILESTONES).find((k) => MILESTONES[k].stage === stage) || null;

export function dueAmount(booking, milestone) {
  const m = MILESTONES[milestone];
  if (!m) throw new RuleError("Unknown payment step.");
  if (m.fixed) return Math.round(Number(booking.shipping_charge) || 0);
  const totals = orderTotals(booking.order_value, booking.approval_fee);
  if (milestone === "booking10") return totals.pay10;
  if (milestone === "approval40") return totals.pay40;
  if (milestone === "delivery50") return totals.pay50;
  throw new RuleError("Unknown payment step.");
}

/* ---------- time helpers ---------- */
export function toMillis(value) {
  if (value == null) return NaN;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(value);
  return parsed;
}

/* A booking counts unless cancelled, or the 10% hold ran out. */
export function isActive(booking, nowMs = Date.now()) {
  if (!booking || booking.stage === "cancelled") return false;
  if (booking.stage === "awaiting_payment" && toMillis(booking.hold_until) < nowMs) return false;
  return true;
}

/* Month key like "2026-10", computed in India time (UTC+5:30). */
export function monthKeyIST(date = new Date()) {
  const ist = new Date(date.getTime() + 330 * 60000);
  return ist.getUTCFullYear() + "-" + String(ist.getUTCMonth() + 1).padStart(2, "0");
}

export function addMonth(key) {
  let [y, m] = String(key).split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return y + "-" + String(m).padStart(2, "0");
}

/* ---------- roles ---------- */
/*
  Inside the app (js/src/session.js):  user, admin, production, accounts
  Stored in Firestore and in the Firebase token (spec words):  customer, admin, production, accounts
  Names in Netlify Identity:  user, Admin, Production, Account
*/
export const SPEC_ROLES = ["customer", "production", "accounts", "admin"];

export const NETLIFY_ROLE_NAME = { customer: "user", production: "Production", accounts: "Account", admin: "Admin" };

export function toSpecRole(appRole) {
  return appRole === "user" ? "customer" : SPEC_ROLES.includes(appRole) ? appRole : "customer";
}

export function toAppRole(specRole) {
  return specRole === "customer" ? "user" : specRole;
}
