/*
  The money-free copy of an order that the factory team reads (production_orders/{bookingId}).

  Pure code (no Firebase, no browser). The server builds this copy again, from scratch, inside every
  transaction that changes an order. It is built from a fixed list of fields, so a new money field added
  to bookings later can never leak into it by accident.

  NEVER copied: price, order_value, approval_fee, shipping_charge, offer, gstin, call_time, hold_until,
  user_id, payments, UTRs, slips, shipping notes, or any note written by Accounts.
*/
import { PROD_VISIBLE } from "./portal-rules.js";
import { prodDispatch } from "./portal-mappers.js";
import { flavourRows } from "./portal-flavours.js";

/* Updates that belong to payment steps are never shown to the factory team. */
const HIDDEN_UPDATE_STAGES = ["awaiting_payment", "payment_review", "cancelled"];

/* Production and Admin may write notes the factory team sees. Nothing else is passed on. */
const NOTE_ROLES = ["production", "admin"];

/* Words and signs that mean "money". A note that has any of them is blanked for the factory team. */
const MONEY_WORDS = /[₹%]|\bUTR\b|\bslip\b|\b(?:rs|inr)\b\.?\s*\d/i;

export const isProductionVisible = (stage) => PROD_VISIBLE.includes(stage);

function safeNote(update) {
  if (update.internal === true) return "";
  if (!NOTE_ROLES.includes(update.by_role)) return "";
  const note = typeof update.note === "string" ? update.note : "";
  return MONEY_WORDS.test(note) ? "" : note;
}

/*
  booking : the booking document (any shape; only listed fields are read)
  updates : every update of this booking, any order
  Returns the document to store, or null when the factory team must not see this order.
*/
export function buildProductionOrder(id, booking, updates) {
  if (!booking || !isProductionVisible(booking.stage)) return null;
  const list = (Array.isArray(updates) ? updates : [])
    .filter((u) => u && !HIDDEN_UPDATE_STAGES.includes(u.stage))
    .map((u) => ({
      stage: u.stage,
      note: safeNote(u),
      by_role: u.by_role || "",
      by_name: u.by_name || "",
      created_at: u.created_at
    }))
    .sort((a, b) => stamp(a.created_at) - stamp(b.created_at));
  return {
    id,
    code: booking.code || "",
    brand: booking.brand || "",
    company: booking.company || "",
    name: booking.name || "",
    city: booking.city || "",
    phone: booking.phone || "",
    slot_month: booking.slot_month || "",
    slot_no: booking.slot_no,
    packs: booking.packs,
    flavours: flavourRows(booking.flavours),
    stage: booking.stage,
    created_at: booking.created_at,
    updated_at: booking.updated_at,
    dispatch: prodDispatch(booking.stage, booking.dispatch),
    updates: list
  };
}

function stamp(value) {
  if (value == null) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
