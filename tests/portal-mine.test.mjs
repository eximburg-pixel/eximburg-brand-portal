import test from "node:test";
import assert from "node:assert/strict";
import { assembleMine, createMineSource, createNewEventTracker, createOverlay } from "../shared/portal-mine.js";

const b = (id, created_at, extra = {}) => ({ id, created_at, stage: "awaiting_payment", ...extra });
const p = (id, booking_id, created_at) => ({ id, booking_id, created_at });
const u = (id, booking_id, created_at) => ({ id, booking_id, created_at });

test("orders are newest first; payments and updates inside an order run oldest to newest", () => {
  const out = assembleMine({
    bookings: [b("a", "2026-10-01T10:00:00Z"), b("b", "2026-10-02T10:00:00Z")],
    payments: [p("p2", "a", "2026-10-03T00:00:00Z"), p("p1", "a", "2026-10-02T00:00:00Z"), p("px", "other", "2026-10-02T00:00:00Z")],
    updates: [u("u2", "a", "2026-10-03T00:00:00Z"), u("u1", "a", "2026-10-01T10:00:00Z")]
  });
  assert.deepEqual(out.map((x) => x.id), ["b", "a"]);
  assert.deepEqual(out[1].payments.map((x) => x.id), ["p1", "p2"], "someone else's payment is not attached");
  assert.deepEqual(out[1].updates.map((x) => x.id), ["u1", "u2"]);
  assert.deepEqual([out[0].payments, out[0].updates], [[], []]);
});

/* a fake set of listeners the test can drive by hand */
function listeners() {
  const l = { booking: null, payment: null, updates: new Map(), stops: [], errors: {} };
  const source = createMineSource({
    watchBookings: (on, err) => { l.booking = on; l.errors.booking = err; return () => l.stops.push("bookings"); },
    watchPayments: (on, err) => { l.payment = on; l.errors.payment = err; return () => l.stops.push("payments"); },
    watchUpdates: (id, on, err) => { l.updates.set(id, on); l.errors["u" + id] = err; return () => { l.stops.push("updates:" + id); l.updates.delete(id); }; }
  });
  const got = [];
  const errors = [];
  const stop = source.start((x) => got.push(x), (e) => errors.push(e));
  return { l, got, errors, stop };
}

test("nothing is delivered until bookings, payments and every order's updates have all answered", () => {
  const { l, got } = listeners();
  l.booking([b("a", "2026-10-01T10:00:00Z")]);
  assert.equal(got.length, 0, "payments and updates have not answered");
  l.payment([p("p1", "a", "2026-10-02T00:00:00Z")]);
  assert.equal(got.length, 0, "the updates of order a have not answered");
  l.updates.get("a")([u("u1", "a", "2026-10-01T10:00:00Z")]);
  assert.equal(got.length, 1);
  assert.deepEqual([got[0][0].payments.length, got[0][0].updates.length], [1, 1]);
});

test("a customer with no orders still gets an (empty) answer", () => {
  const { l, got } = listeners();
  l.payment([]);
  l.booking([]);
  assert.deepEqual(got, [[]]);
});

test("a change in an order's updates is delivered at once", () => {
  const { l, got } = listeners();
  l.booking([b("a", "2026-10-01T10:00:00Z")]);
  l.payment([]);
  l.updates.get("a")([u("u1", "a", "2026-10-01T10:00:00Z")]);
  l.updates.get("a")([u("u1", "a", "2026-10-01T10:00:00Z"), u("u2", "a", "2026-10-02T00:00:00Z")]);
  assert.equal(got.length, 2);
  assert.equal(got[1][0].updates.length, 2);
});

test("a new order starts its own updates listener; a removed order's listener is stopped", () => {
  const { l, got } = listeners();
  l.payment([]);
  l.booking([b("a", "2026-10-01T10:00:00Z")]);
  l.updates.get("a")([]);
  l.booking([b("a", "2026-10-01T10:00:00Z"), b("c", "2026-10-05T10:00:00Z")]);
  assert.ok(l.updates.has("c"));
  assert.equal(got.length, 1, "waits for the new order's updates");
  l.updates.get("c")([]);
  assert.deepEqual(got.at(-1).map((x) => x.id), ["c", "a"]);
  l.booking([b("c", "2026-10-05T10:00:00Z")]);
  assert.ok(l.stops.includes("updates:a"));
});

test("an existing order is not re-listened to when the list changes", () => {
  const { l } = listeners();
  l.payment([]);
  l.booking([b("a", "2026-10-01T10:00:00Z")]);
  const first = l.updates.get("a");
  l.booking([b("a", "2026-10-01T10:00:00Z", { stage: "payment_review" })]);
  assert.equal(l.updates.get("a"), first);
});

test("stopping stops every listener and nothing more is delivered", () => {
  const { l, got, stop } = listeners();
  l.payment([]);
  l.booking([b("a", "2026-10-01T10:00:00Z")]);
  const pushUpdates = l.updates.get("a");
  stop();
  assert.deepEqual(l.stops.sort(), ["bookings", "payments", "updates:a"]);
  pushUpdates([]);
  l.booking?.([b("zzz", "2026-10-09T00:00:00Z")]);
  assert.equal(got.length, 0);
});

test("a listener error is passed on once the source is running, and not after stop", () => {
  const { l, errors, stop } = listeners();
  l.errors.payment(new Error("denied"));
  assert.equal(errors.length, 1);
  stop();
  l.errors.payment(new Error("late"));
  assert.equal(errors.length, 1);
});

/* ---------------------------------------------------------------- overlay */

const NOW = 1_000_000;

test("a just-booked order is shown until the live list has it, then the live copy wins", () => {
  const o = createOverlay();
  o.addBooking({ ...b("new", "2026-10-02T10:00:00Z"), payments: [], updates: [] }, NOW);
  const live = [b("old", "2026-10-01T10:00:00Z")];
  assert.deepEqual(o.apply(live, NOW + 1000).map((x) => x.id), ["new", "old"]);
  assert.deepEqual(o.pendingBookings(NOW + 1000).map((x) => x.id), ["new"]);
  const caught = [b("new", "2026-10-02T10:00:00Z", { stage: "confirmed" }), b("old", "2026-10-01T10:00:00Z")];
  const merged = o.apply(caught, NOW + 2000);
  assert.deepEqual(merged.map((x) => `${x.id}:${x.stage}`), ["new:confirmed", "old:awaiting_payment"]);
  assert.deepEqual(o.pendingBookings(NOW + 2000), [], "forgotten once the live list has it");
});

test("a just-booked order that never shows up is dropped after the time limit", () => {
  const o = createOverlay({ ttlMs: 30000 });
  o.addBooking(b("ghost", "2026-10-02T10:00:00Z"), NOW);
  assert.equal(o.apply([], NOW + 29000).length, 1);
  assert.equal(o.apply([], NOW + 31000).length, 0);
});

test("a just-sent payment moves the order to payment review and shows the payment right away", () => {
  const o = createOverlay();
  const payment = { id: "pay1", booking_id: "a", milestone: "booking10", amount: 102000, status: "submitted" };
  o.addPayment("a", { fromStage: "awaiting_payment", toStage: "payment_review", payment }, NOW);
  const live = [{ ...b("a", "2026-10-01T10:00:00Z"), payments: [], updates: [] }];
  const out = o.apply(live, NOW + 500);
  assert.equal(out[0].stage, "payment_review");
  assert.deepEqual(out[0].payments, [payment]);
  assert.equal(live[0].stage, "awaiting_payment", "the live data itself is not changed");
});

test("the payment overlay never shows a payment twice", () => {
  const o = createOverlay();
  const payment = { id: "pay1", booking_id: "a" };
  o.addPayment("a", { fromStage: "awaiting_payment", toStage: "payment_review", payment }, NOW);
  const live = [{ ...b("a", "2026-10-01T10:00:00Z"), payments: [payment], updates: [] }]; // payment arrived, stage not yet
  const out = o.apply(live, NOW + 500);
  assert.equal(out[0].payments.length, 1);
  assert.equal(out[0].stage, "payment_review");
});

test("once the live stage has moved on, the payment overlay steps aside for good", () => {
  const o = createOverlay();
  o.addPayment("a", { fromStage: "awaiting_payment", toStage: "payment_review", payment: { id: "p" } }, NOW);
  const reviewed = [{ ...b("a", "2026-10-01T10:00:00Z", { stage: "confirmed" }), payments: [], updates: [] }];
  assert.equal(o.apply(reviewed, NOW + 1000)[0].stage, "confirmed");
  // even if the order goes back to the old stage later (a rejected slip), the old overlay does not come back
  const rejected = [{ ...b("a", "2026-10-01T10:00:00Z"), payments: [], updates: [] }];
  assert.equal(o.apply(rejected, NOW + 2000)[0].stage, "awaiting_payment");
});

test("the payment overlay also expires", () => {
  const o = createOverlay({ ttlMs: 30000 });
  o.addPayment("a", { fromStage: "awaiting_payment", toStage: "payment_review", payment: { id: "p" } }, NOW);
  const live = [{ ...b("a", "2026-10-01T10:00:00Z"), payments: [], updates: [] }];
  assert.equal(o.apply(live, NOW + 31000)[0].stage, "awaiting_payment");
});

/* ----------------------------------------------------------- new slot events */

test("the first list of slot events is only remembered; later new ones are returned oldest first", () => {
  const fresh = createNewEventTracker();
  const e = (id, t) => ({ id, created_at: t, slot_no: 1 });
  assert.deepEqual(fresh([e("1", "2026-10-01T10:00:00Z"), e("2", "2026-10-01T11:00:00Z")]), []);
  assert.deepEqual(fresh([e("1", "2026-10-01T10:00:00Z"), e("2", "2026-10-01T11:00:00Z")]), [], "same list again");
  const out = fresh([e("4", "2026-10-02T10:00:00Z"), e("3", "2026-10-01T12:00:00Z"), e("2", "2026-10-01T11:00:00Z")]);
  assert.deepEqual(out.map((x) => x.id), ["3", "4"]);
  assert.deepEqual(fresh([e("4", "2026-10-02T10:00:00Z")]), [], "never repeated");
});

test("rows without an id are ignored and bad input is safe", () => {
  const fresh = createNewEventTracker();
  assert.deepEqual(fresh(undefined), []);
  assert.deepEqual(fresh([{ created_at: "x" }]), []);
});
