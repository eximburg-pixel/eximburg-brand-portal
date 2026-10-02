/*
  A customer's own orders, kept live.

  The database holds three separate things for an order: the booking, its payments, and its updates
  (updates live in a sub-collection per booking). The page wants ONE list: each order with its
  payments and updates attached, oldest first inside the order.

  Pure code (no Firebase, no browser), so it can be tested. The real listeners are passed in.
*/

const asc = (field) => (a, b) => String(a[field] || "").localeCompare(String(b[field] || ""));
const desc = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));

/* Newest order first. Inside an order, payments and updates run oldest to newest. */
export function assembleMine({ bookings = [], payments = [], updates = [] }) {
  const paymentsOf = new Map();
  for (const p of [...payments].sort(asc("created_at"))) {
    if (!paymentsOf.has(p.booking_id)) paymentsOf.set(p.booking_id, []);
    paymentsOf.get(p.booking_id).push(p);
  }
  const updatesOf = new Map();
  for (const u of [...updates].sort(asc("created_at"))) {
    if (!updatesOf.has(u.booking_id)) updatesOf.set(u.booking_id, []);
    updatesOf.get(u.booking_id).push(u);
  }
  return [...bookings]
    .sort(desc("created_at"))
    .map((b) => ({ ...b, payments: paymentsOf.get(b.id) || [], updates: updatesOf.get(b.id) || [] }));
}

/*
  Builds one live source out of three kinds of listener:
    watchBookings(onList, onError)        -> stop    (this customer's bookings)
    watchPayments(onList, onError)        -> stop    (this customer's payments)
    watchUpdates(bookingId, onList, onError) -> stop (updates of one booking)
  Nothing is delivered until every part has answered once, so the page never flashes an order
  with an empty history. Listeners for orders that disappear are stopped.
*/
export function createMineSource({ watchBookings, watchPayments, watchUpdates }) {
  return {
    start(onData, onError) {
      let bookings = null;
      let payments = null;
      let stopped = false;
      const updates = new Map(); // bookingId -> { loaded, items, stop }

      const fail = (error) => { if (!stopped) onError(error); };
      const ready = () => bookings !== null && payments !== null && bookings.every((b) => updates.get(b.id) && updates.get(b.id).loaded);
      const emit = () => {
        if (stopped || !ready()) return;
        const all = [];
        for (const b of bookings) all.push(...updates.get(b.id).items);
        onData(assembleMine({ bookings, payments, updates: all }));
      };

      const stopBookings = watchBookings((list) => {
        if (stopped) return;
        bookings = list;
        const ids = new Set(list.map((b) => b.id));
        for (const [id, entry] of [...updates]) {
          if (!ids.has(id)) {
            if (entry.stop) entry.stop();
            updates.delete(id);
          }
        }
        for (const id of ids) {
          if (updates.has(id)) continue;
          const entry = { loaded: false, items: [], stop: null };
          updates.set(id, entry);
          entry.stop = watchUpdates(id, (items) => {
            entry.items = items;
            entry.loaded = true;
            emit();
          }, fail);
        }
        emit();
      }, fail);

      const stopPayments = watchPayments((list) => {
        if (stopped) return;
        payments = list;
        emit();
      }, fail);

      return () => {
        stopped = true;
        for (const stop of [stopBookings, stopPayments]) if (typeof stop === "function") stop();
        for (const entry of updates.values()) if (entry.stop) entry.stop();
        updates.clear();
      };
    }
  };
}

/*
  Between "the server said yes" and "the live listener reports it" there can be a second or two.
  The overlay keeps what the customer just did on screen during that gap, and steps aside as soon as
  the live data catches up (or after ttlMs, so a stale overlay can never stay forever).
*/
export function createOverlay({ ttlMs = 30000 } = {}) {
  const added = new Map(); // bookingId -> { booking, at }
  const paid = new Map(); // bookingId -> { fromStage, toStage, payment, at }
  return {
    addBooking(booking, now = Date.now()) {
      added.set(booking.id, { booking, at: now });
    },
    addPayment(bookingId, { fromStage, toStage, payment }, now = Date.now()) {
      paid.set(bookingId, { fromStage, toStage, payment, at: now });
    },
    /* Slots the customer has just booked, even if the live list does not show them yet. */
    pendingBookings(now = Date.now()) {
      return [...added.values()].filter((e) => now - e.at <= ttlMs).map((e) => e.booking);
    },
    apply(list, now = Date.now()) {
      const out = [...list];
      const known = new Set(out.map((b) => b.id));
      for (const [id, entry] of [...added]) {
        if (known.has(id) || now - entry.at > ttlMs) added.delete(id);
        else out.push({ ...entry.booking });
      }
      for (const [id, entry] of [...paid]) {
        const i = out.findIndex((b) => b.id === id);
        if (i < 0 || now - entry.at > ttlMs) {
          paid.delete(id);
          continue;
        }
        const b = out[i];
        const livePay = (b.payments || []).find((p) => p.id === entry.payment.id);
        // A reviewed slip (verified or rejected) is the live truth. Do not paint it back to "under review",
        // including when a rejection returns the order to the same stage it was paid from.
        if ((livePay && livePay.status && livePay.status !== "submitted") || b.stage !== entry.fromStage) {
          paid.delete(id);
          continue;
        }
        const has = !!livePay;
        out[i] = { ...b, stage: entry.toStage, payments: has ? b.payments : [...(b.payments || []), entry.payment] };
      }
      return out.sort(desc("created_at"));
    }
  };
}

/*
  Finds slot-board events that are new since the page opened.
  The first list is only remembered (old events are shown by the page's own feed). After that, each
  call returns the rows not seen before, oldest first.
*/
export function createNewEventTracker() {
  let seen = null;
  return function fresh(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (seen === null) {
      seen = new Set(list.map((r) => r.id).filter(Boolean));
      return [];
    }
    const out = list.filter((r) => r.id && !seen.has(r.id)).sort(asc("created_at"));
    for (const r of list) if (r.id) seen.add(r.id);
    return out;
  };
}
