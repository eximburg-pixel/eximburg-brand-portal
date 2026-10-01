/*
  Order actions: book a slot, submit a payment slip, and (for Accounts) verify or reject it.

  Rules of this file:
    - Every action runs in a Firestore transaction. All reads come first, then all writes.
      A transaction may be run again by Firestore if two people collide, so nothing in here
      may do anything outside the database (no emails, no file writes) before it commits.
    - Booking reads and writes slot_months/{month} on purpose. Two people booking at the same time
      both touch that one document, so Firestore makes one wait for the other. That is what stops
      two customers from getting the same slot number.
    - The browser may show numbers, but it never decides them. Prices, fees, the offer, the slot and
      the amount that is due are all worked out here.
*/
import { ApiError, asApiError } from "./http.js";
import { mapBooking, plainify } from "../../shared/portal-mappers.js";
import {
  MILESTONES, addMonth, approvalFee, dueAmount, dueMilestone, isActive, monthKeyIST, orderValue, priceForPacks, validateBatch
} from "../../shared/portal-rules.js";
import { mergeSettings } from "../../shared/portal-settings.js";
import {
  MAX_MONTHS_AHEAD, MAX_UNPAID_HOLDS, bookingCode, firstFreeSlot, formatInr, holdExpired, holdUntilMs, qualifiesForOffer, slotState,
  stageAfterReview, todayIST
} from "../../shared/portal-orders.js";
import { checkBookingForm, checkPaymentForm, cleanId, normalizeUtr } from "../../shared/portal-validate.js";
import { readMirrorInput, writeMirror } from "./mirror.js";

const SETTINGS_PATH = "settings/portal";
const SLIP_NAME = /^[A-Za-z0-9._-]{1,80}$/;

export const settingsFrom = (snap) => mergeSettings(snap.exists ? plainify(snap.data()) : {});

/* Writes one history record for an order and returns it (the factory copy needs it in the same transaction). */
export function addUpdate(t, bookingRef, entry, nowMs) {
  const full = { ...entry, created_at: new Date(nowMs) };
  t.set(bookingRef.collection("updates").doc(), full);
  return full;
}

/* ---------- slot board (display copy; the bookings themselves are the truth) ---------- */

/* Rewrites slot_months/{month} from the real bookings. Writes only if something changed. */
export async function recomputeSlotMonth(db, month, settings, nowMs) {
  const snap = await db.collection("bookings").where("slot_month", "==", month).get();
  const state = slotState(snap.docs.map((d) => d.data()), settings, month, nowMs);
  const ref = db.doc(`slot_months/${month}`);
  const current = await ref.get();
  if (current.exists) {
    const old = current.data();
    const same = old.client_slots === state.client && old.offline === state.offline
      && Array.isArray(old.taken) && old.taken.length === state.taken.length && old.taken.every((n, i) => n === state.taken[i]);
    if (same) return false;
  }
  await ref.set({ month, client_slots: state.client, offline: state.offline, taken: state.taken, updated_at: new Date(nowMs) });
  return true;
}

/* This month and next month. Used after every booking change, after Settings are saved, and every 10 minutes. */
export async function recomputeSlotMonths(db, nowMs) {
  const settings = settingsFrom(await db.doc(SETTINGS_PATH).get());
  const month = monthKeyIST(new Date(nowMs));
  const changed = [];
  for (const m of [month, addMonth(month)]) {
    if (await recomputeSlotMonth(db, m, settings, nowMs)) changed.push(m);
  }
  return changed;
}

/* A failed refresh must never undo a booking that already succeeded. The 10-minute job repairs it. */
export async function refreshSlotsQuietly(ctx, db, months) {
  try {
    const nowMs = ctx.now();
    const settings = settingsFrom(await db.doc(SETTINGS_PATH).get());
    for (const m of new Set(months)) await recomputeSlotMonth(db, m, settings, nowMs);
  } catch (error) {
    (ctx.log || console.error)("slot board refresh failed:", error && error.message);
  }
}

/* ---------- bookSlot ---------- */

/* When many people book in the same second, Firestore gives up on some of them after a few tries
   ("too much contention"). Nothing was saved in that case, so trying again is safe. */
const isContention = (error) => Boolean(error) && (error.code === 10 || error.code === "aborted" || /contention/i.test(error.message || ""));

export async function runWithRetry(db, work, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.runTransaction(work);
    } catch (error) {
      if (!isContention(error)) throw error;
      if (attempt >= attempts) throw new ApiError(503, "busy", "We are busy right now. Please try again in a moment.");
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.random() * 40));
    }
  }
}

async function bookSlot(ctx, payload) {
  let form;
  let batch;
  try {
    form = checkBookingForm(payload);
    batch = validateBatch(payload.packs, payload.flavours);
  } catch (error) {
    throw asApiError(error);
  }

  const { db } = ctx.firebase();
  const uid = ctx.user.id;
  const nowMs = ctx.now();

  const booking = await runWithRetry(db, async (t) => {
    // ---- reads ----
    // The shared lock comes FIRST. Anyone else booking this month waits here until we finish, and only
    // then reads the bookings list, so they always see our booking. (Reading the list before taking
    // the lock could leave them with an out-of-date list.)
    let month = monthKeyIST(new Date(nowMs));
    const locked = new Set([month]);
    await t.get(db.doc(`slot_months/${month}`));

    const settings = settingsFrom(await t.get(db.doc(SETTINGS_PATH)));
    const holdsSnap = await t.get(db.collection("bookings").where("user_id", "==", uid).where("stage", "==", "awaiting_payment"));
    const activeHolds = holdsSnap.docs.filter((d) => isActive(d.data(), nowMs)).length;
    if (activeHolds >= MAX_UNPAID_HOLDS) {
      throw new ApiError(
        409,
        "too_many_holds",
        `You already have ${MAX_UNPAID_HOLDS} unpaid slots on hold. Pay for one of them, or wait for a hold to run out, before booking another.`
      );
    }

    let slot = null;
    let state = null;
    for (let tries = 0; tries < MAX_MONTHS_AHEAD && slot === null; tries++) {
      if (!locked.has(month)) {
        locked.add(month);
        await t.get(db.doc(`slot_months/${month}`)); // lock each further month before reading its bookings
      }
      const bookingsSnap = await t.get(db.collection("bookings").where("slot_month", "==", month));
      state = slotState(bookingsSnap.docs.map((d) => d.data()), settings, month, nowMs);
      slot = firstFreeSlot(state);
      if (slot === null) month = addMonth(month);
    }
    if (slot === null) {
      throw new ApiError(409, "slots_full", "All production slots for the next 12 months are full. Please contact us.");
    }

    let code = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = bookingCode(nowMs, ctx.random);
      const clash = await t.get(db.collection("bookings").where("code", "==", candidate).limit(1));
      if (clash.empty) { code = candidate; break; }
    }
    if (!code) throw new ApiError(503, "busy", "We are busy right now. Please try again in a moment.");

    // ---- numbers decided here, never by the browser ----
    const price = priceForPacks(batch.packs);
    const value = orderValue(batch.packs);
    const hours = Number(settings.holdHours) || 48;
    const bookingRef = db.collection("bookings").doc();
    const doc = {
      code, user_id: uid,
      name: form.name, phone: form.phone, brand: form.brand, city: form.city, gstin: form.gstin, call_time: form.call_time,
      slot_month: month, slot_no: slot,
      packs: batch.packs, price, order_value: value, approval_fee: approvalFee(batch.flavours.length),
      flavours: batch.flavours, offer: qualifiesForOffer(settings, value),
      stage: "awaiting_payment", hold_until: new Date(holdUntilMs(nowMs, settings)),
      shipping_charge: 0, dispatch: {},
      created_at: new Date(nowMs), updated_at: new Date(nowMs)
    };

    // ---- writes ----
    t.set(bookingRef, doc);
    addUpdate(t, bookingRef, {
      stage: "awaiting_payment",
      note: `Slot ${slot} reserved for ${month}. Pay the 10% booking amount within ${hours} hours to confirm.`,
      by_role: "system", by_name: "System"
    }, nowMs);
    t.set(db.collection("slot_events").doc(), { slot_month: month, slot_no: slot, city: form.city, created_at: new Date(nowMs) });
    t.set(db.doc(`slot_months/${month}`), {
      month, client_slots: state.client, offline: state.offline,
      taken: [...state.taken, slot].sort((a, b) => a - b), updated_at: new Date(nowMs)
    });
    if (form.brand) t.set(db.doc(`profiles/${uid}`), { brand: form.brand }, { merge: true });

    return mapBooking(bookingRef.id, doc);
  });

  return { booking };
}

/* ---------- submitPayment ---------- */

const HOLD_LOST_MESSAGE = "Your hold expired and this slot was taken. Please book a new slot — your slip was not submitted.";

async function submitPayment(ctx, payload) {
  const uid = ctx.user.id;
  const nowMs = ctx.now();
  const bookingId = cleanId(payload.booking_id);
  if (!bookingId) throw new ApiError(404, "not_found", "Booking not found.");

  // The slip must be a file this customer already uploaded for this booking.
  const slipPath = typeof payload.slip_path === "string" ? payload.slip_path : "";
  const prefix = `payment-slips/${uid}/${bookingId}/`;
  const slipOk = slipPath.startsWith(prefix) && SLIP_NAME.test(slipPath.slice(prefix.length));
  if (!slipOk || !(await ctx.files.exists(slipPath))) {
    throw new ApiError(400, "invalid", "Attach your payment slip (photo or PDF).");
  }

  let form;
  try {
    form = checkPaymentForm(payload, todayIST(nowMs));
  } catch (error) {
    throw asApiError(error);
  }

  const { db } = ctx.firebase();
  const outcome = await db.runTransaction(async (t) => {
    // ---- reads ----
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const snap = await t.get(bookingRef);
    if (!snap.exists || snap.data().user_id !== uid) throw new ApiError(404, "not_found", "Booking not found.");
    const b = snap.data();

    const milestone = dueMilestone(b.stage);
    if (!milestone) throw new ApiError(409, "nothing_due", "No payment is due on this booking right now.");
    if (milestone !== payload.milestone) throw new ApiError(409, "mismatch", "This payment does not match the amount due.");

    const utrRef = db.doc(`utr_index/${form.utrKey}`);
    if ((await t.get(utrRef)).exists) throw new ApiError(409, "duplicate_utr", "This UTR has already been submitted.");

    let slotTaken = false;
    if (holdExpired(b, nowMs)) {
      // Paying after the hold ran out brings the slot back to life, which could clash with a new
      // booking. Take the same shared lock first, then look at who holds the slot.
      await t.get(db.doc(`slot_months/${b.slot_month}`));
      const same = await t.get(db.collection("bookings").where("slot_month", "==", b.slot_month));
      slotTaken = same.docs.some((d) => d.id !== bookingId && d.data().slot_no === b.slot_no && isActive(d.data(), nowMs));
    }

    // ---- writes ----
    if (slotTaken) {
      t.update(bookingRef, { stage: "cancelled", updated_at: new Date(nowMs) });
      addUpdate(t, bookingRef, {
        stage: "cancelled", note: "The 10% hold ran out and the slot was taken by another brand.", by_role: "system", by_name: "System"
      }, nowMs);
      return { lost: true, month: b.slot_month };
    }

    const paymentRef = db.collection("payments").doc();
    t.set(paymentRef, {
      booking_id: bookingId, user_id: uid, milestone,
      amount: form.amount, expected: dueAmount(b, milestone),
      utr: form.utr, paid_on: form.paid_on, slip_path: slipPath,
      status: "submitted", note: "", created_at: new Date(nowMs)
    });
    t.set(utrRef, { payment_id: paymentRef.id, booking_id: bookingId, user_id: uid, created_at: new Date(nowMs) });
    t.update(bookingRef, { stage: "payment_review", updated_at: new Date(nowMs) });
    addUpdate(t, bookingRef, {
      stage: "payment_review",
      note: `Payment slip for ${MILESTONES[milestone].en} submitted (UTR ${form.utr}).`,
      by_role: "customer", by_name: b.name || "", internal: true
    }, nowMs);
    // While a 40%, 50% or shipping payment is being checked, the order is off the factory board.
    writeMirror(t, db, bookingId, b.stage, { ...b, stage: "payment_review" }, null, []);
    return { lost: false, month: b.slot_month, paymentId: paymentRef.id };
  });

  await refreshSlotsQuietly(ctx, db, [outcome.month]);
  if (outcome.lost) throw new ApiError(409, "hold_lost", HOLD_LOST_MESSAGE);
  return { payment_id: outcome.paymentId };
}

/* ---------- reviewPayment (Accounts and Admin) ---------- */

async function reviewPayment(ctx, payload) {
  const paymentId = cleanId(payload.payment_id);
  const approved = payload.ok === true;
  const note = String(payload.note == null ? "" : payload.note).trim();
  if (note.length > 500) throw new ApiError(400, "invalid", "The note is too long (most 500 characters).");
  if (!paymentId) throw new ApiError(404, "not_found", "Payment not found.");
  if (!approved && !note) throw new ApiError(400, "invalid", "Write the reason for rejection — the customer will see it.");

  const { db } = ctx.firebase();
  const nowMs = ctx.now();
  const reviewerId = ctx.user.id;

  const done = await db.runTransaction(async (t) => {
    // ---- reads ----
    const paymentRef = db.doc(`payments/${paymentId}`);
    const paymentSnap = await t.get(paymentRef);
    if (!paymentSnap.exists) throw new ApiError(404, "not_found", "Payment not found.");
    const p = paymentSnap.data();
    if (p.status !== "submitted") throw new ApiError(409, "already_reviewed", "This payment was already reviewed.");

    const bookingRef = db.doc(`bookings/${p.booking_id}`);
    const bookingSnap = await t.get(bookingRef);
    if (!bookingSnap.exists) throw new ApiError(404, "not_found", "The order for this payment was not found.");
    const b = bookingSnap.data();
    if (b.stage !== "payment_review") {
      throw new ApiError(409, "stage_changed", "This order is no longer waiting for payment review. Reload the page.");
    }

    const settings = settingsFrom(await t.get(db.doc(SETTINGS_PATH)));
    const reviewer = await t.get(db.doc(`profiles/${reviewerId}`));
    const reviewerName = (reviewer.exists && reviewer.data().name) || ctx.user.name || "Accounts";
    const nextStage = stageAfterReview(p.milestone, approved, MILESTONES);
    const earlier = await readMirrorInput(t, db, p.booking_id, nextStage); // the factory copy, when the order is visible

    // ---- writes ----
    const bookingChange = { stage: nextStage, updated_at: new Date(nowMs) };
    // A rejected 10% slip gives the customer a fresh hold so the slot is not lost while they fix it.
    if (!approved && p.milestone === "booking10") bookingChange.hold_until = new Date(holdUntilMs(nowMs, settings));
    t.update(paymentRef, { status: approved ? "verified" : "rejected", note, reviewed_by: reviewerId, reviewed_at: new Date(nowMs) });
    t.update(bookingRef, bookingChange);
    // A rejected slip frees its UTR so the customer can send a corrected slip.
    if (!approved) t.delete(db.doc(`utr_index/${normalizeUtr(p.utr)}`));
    const entry = addUpdate(t, bookingRef, {
      stage: nextStage,
      note: approved
        ? `Payment of ₹${formatInr(p.amount)} verified by Accounts.${note ? " " + note : ""}`
        : `Payment slip rejected: ${note}`,
      by_role: ctx.role, by_name: reviewerName, internal: true
    }, nowMs);
    // Verified 10% / 40%: the order appears on (or returns to) the factory board. Rejected 40% / 50%: it goes back too.
    writeMirror(t, db, p.booking_id, b.stage, { ...b, ...bookingChange }, earlier, [entry]);
    return { month: b.slot_month, stage: nextStage };
  });

  await refreshSlotsQuietly(ctx, db, [done.month]);
  return { payment_id: paymentId, status: approved ? "verified" : "rejected", stage: done.stage };
}

/*
  Shared wrapper for Production and dispatch actions: load the order, run the caller's extra reads,
  then write the booking, the history record and the factory copy, all in one transaction.
  `work` must only READ. It returns { next, patch, note, write, result }.
*/
export async function mutateBooking(ctx, bookingId, work) {
  const id = cleanId(bookingId);
  if (!id) throw new ApiError(404, "not_found", "Booking not found.");
  const { db } = ctx.firebase();
  const nowMs = ctx.now();
  return runWithRetry(db, async (t) => {
    const bookingRef = db.doc(`bookings/${id}`);
    const snap = await t.get(bookingRef);
    if (!snap.exists) throw new ApiError(404, "not_found", "Booking not found.");
    const profileSnap = await t.get(db.doc(`profiles/${ctx.user.id}`));
    const byName = (profileSnap.exists && profileSnap.data().name) || ctx.user.name || "";
    const b = snap.data();
    const plan = await work({ t, db, booking: b, nowMs, byName, bookingRef, id });
    const earlier = await readMirrorInput(t, db, id, plan.next);
    const patch = { ...(plan.patch || {}), stage: plan.next, updated_at: new Date(nowMs) };
    t.update(bookingRef, patch);
    const entry = addUpdate(t, bookingRef, {
      stage: plan.next, note: plan.note || "", by_role: ctx.role, by_name: byName
    }, nowMs);
    if (plan.write) plan.write(t);
    writeMirror(t, db, id, b.stage, { ...b, ...patch }, earlier, [entry]);
    return plan.result || { stage: plan.next };
  });
}

export const ORDER_ACTIONS = {
  bookSlot: { roles: ["customer"], run: bookSlot },
  submitPayment: { roles: ["customer"], run: submitPayment },
  reviewPayment: { roles: ["accounts", "admin"], run: reviewPayment }
};
