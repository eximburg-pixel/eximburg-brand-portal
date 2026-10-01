/*
  Order and slot rules shared by the server actions and the tests.
  Pure code: no Firebase, no browser, no Node, so it can be unit tested.
  The functions are the authority; the browser only shows what the server decided.
*/
import { RuleError, isActive, toMillis } from "./portal-rules.js";

export const MAX_UNPAID_HOLDS = 2;
export const MAX_MONTHS_AHEAD = 12;

/* Whole rupees in Indian grouping, for update notes: 102000 -> "1,02,000". */
export function formatInr(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(n));
  if (digits.length <= 3) return sign + digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return sign + rest + "," + last3;
}

/*
  Slot numbers for one production month.
    client   = slots we sell to clients (monthSlots minus the ones kept for Royal Swag)
    offline  = client slots already sold outside the portal (Admin sets this in Settings)
    taken    = slot numbers of active online bookings (a lapsed 10% hold frees its slot)
*/
export function slotState(bookings, settings, month, nowMs) {
  const client = Math.max(0, (Number(settings.monthSlots) || 0) - (Number(settings.royalSwagReserved) || 0));
  const offline = Math.min(client, Math.max(0, Number((settings.offlineSlots || {})[month]) || 0));
  const taken = [];
  for (const b of bookings) {
    if (b && b.slot_month === month && isActive(b, nowMs) && Number.isInteger(b.slot_no)) taken.push(b.slot_no);
  }
  taken.sort((a, b) => a - b);
  return { client, offline, taken };
}

/* The lowest open client slot after the offline ones, or null if the month is full. */
export function firstFreeSlot(state) {
  for (let n = state.offline + 1; n <= state.client; n++) {
    if (!state.taken.includes(n)) return n;
  }
  return null;
}

/* EXB-YYMMDD-XXXX, with the date in India time. `random` returns a number from 0 to 1. */
export function bookingCode(nowMs, random = Math.random) {
  const ist = new Date(nowMs + 330 * 60000);
  const yy = String(ist.getUTCFullYear()).slice(2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, easier to read out on a call
  let tail = "";
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(random() * alphabet.length)];
  return `EXB-${yy}${mm}${dd}-${tail}`;
}

/* Today's date in India time as YYYY-MM-DD. */
export function todayIST(nowMs) {
  return new Date(nowMs + 330 * 60000).toISOString().slice(0, 10);
}

export function holdUntilMs(nowMs, settings) {
  const hours = Number(settings.holdHours) || 48;
  return nowMs + hours * 3600 * 1000;
}

/*
  The offer is decided here, never by the browser.
  Returns true when the order is big enough and the offer is switched on.
*/
export function qualifiesForOffer(settings, orderValue) {
  const offer = settings.offer;
  if (!offer || offer.enabled === false) return false;
  const threshold = Number(offer.threshold);
  return Number.isFinite(threshold) && threshold > 0 && orderValue >= threshold;
}

/* Where a payment decision sends the order (spec section 4.2). */
export function stageAfterReview(milestone, approved, milestones) {
  const m = milestones[milestone];
  if (!m) throw new RuleError("Unknown payment step.");
  return approved ? m.ok : m.stage;
}

/* Has the 10% hold run out? Only the first payment has a hold. */
export function holdExpired(booking, nowMs) {
  return booking.stage === "awaiting_payment" && toMillis(booking.hold_until) < nowMs;
}
