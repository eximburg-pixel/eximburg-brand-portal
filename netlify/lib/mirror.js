/*
  Keeps production_orders/{bookingId} (the money-free copy for the factory team) in step with the booking.

  Used inside the same Firestore transaction that changes the booking, so the two can never disagree.
  Firestore needs every read before the first write, so there are two steps:
    1. readMirrorInput(...)  in the reads part: loads the order's history, but only when the order
       will be visible to Production after this change.
    2. writeMirror(...)      in the writes part: stores the rebuilt copy, or removes it.
*/
import { buildProductionOrder, isProductionVisible } from "../../shared/portal-mirror.js";

/* Reads part. Returns the order's earlier updates, or null when the order will not be visible. */
export async function readMirrorInput(t, db, bookingId, nextStage) {
  if (!isProductionVisible(nextStage)) return null;
  const snap = await t.get(db.doc(`bookings/${bookingId}`).collection("updates"));
  return snap.docs.map((d) => d.data());
}

/*
  Writes part.
    previousStage : the stage before this change
    nextBooking   : the whole booking as it will be after this change
    earlier       : what readMirrorInput returned
    newEntries    : the update records this same transaction writes (they cannot be read back yet)
*/
export function writeMirror(t, db, bookingId, previousStage, nextBooking, earlier, newEntries) {
  const ref = db.doc(`production_orders/${bookingId}`);
  if (earlier) {
    t.set(ref, buildProductionOrder(bookingId, nextBooking, [...earlier, ...newEntries]));
  } else if (isProductionVisible(previousStage)) {
    t.delete(ref); // it was on the factory board and must come off (for example a payment is being checked)
  }
}
