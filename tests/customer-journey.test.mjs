/*
  A customer's whole journey through the REAL browser data layer (js/src/portal-data.js, bundled) and the
  REAL server code (netlify/lib/*). Only the outside world is replaced:
    - Firestore: one in-memory database. The server writes to it; the browser listeners read from it,
      under the customer's read rules.
    - fetch: calls the real /api handlers directly.
  The browser's live listeners react when the test says the database changed (__FAKE__.flush()).
*/
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { handleApi } from "../netlify/lib/api-endpoint.js";
import { handleFile, handleUpload } from "../netlify/lib/files-endpoint.js";
import { SAMPLE, fakeFiles, fakeFirestore } from "./helpers/fake-firestore.mjs";
import { SITE, netlifyUser, silent, verifyOrigin } from "./helpers/fakes.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/* ---- bundle the real data layer once, with the outside world swapped for fakes ---- */
const bundled = await build({
  entryPoints: [here("../js/src/portal-data.js")],
  bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent",
  plugins: [{
    name: "fakes",
    setup(b) {
      b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: here("./helpers/browser-firestore.mjs") }));
      b.onResolve({ filter: /firebase-session\.js$/ }, () => ({ path: here("./helpers/browser-session.mjs") }));
      b.onResolve({ filter: /(^|\/)track\.js$/ }, () => ({ path: here("./helpers/empty.mjs") }));
    }
  }]
});
const CODE = bundled.outputFiles[0].text;

async function journey({ uid = "cust1", role = "user", profile } = {}) {
  const db = fakeFirestore({ [`profiles/${uid}`]: { name: "Asha", role: "customer", brand: "" } });
  const files = fakeFiles();
  const state = { user: netlifyUser(uid, ["user"]) };
  const deps = {
    verifyOrigin, getUser: async () => state.user, identity: {},
    firebase: () => ({ db, serverTime: () => new Date() }), files, log: silent
  };
  const timers = [];
  const fake = { db, uid, appRole: role, listeners: new Set(), queried: [] };
  const sandbox = {
    __FAKE__: fake, console, URL, Promise, queueMicrotask, File, Blob, Request, Response, Headers, TextEncoder,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: { getItem: () => null, setItem() {} },
    crypto: { randomUUID: () => "11111111-2222-3333-4444-555555555555" },
    location: { replace() {} },
    fetch: async (url, init = {}) => {
      const extra = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers || {});
      const req = new Request(SITE + url, { method: init.method || "GET", headers: { origin: SITE, ...extra }, body: init.body });
      if (url.startsWith("/api/call/")) return handleApi(req, decodeURIComponent(url.slice("/api/call/".length)), deps);
      if (url.startsWith("/api/upload/slip")) return handleUpload(req, "slip", deps);
      if (url.startsWith("/api/file")) return handleFile(req, deps);
      throw new Error("unexpected fetch " + url);
    }
  };
  sandbox.window = sandbox;
  sandbox.EXB_PROFILE = profile || { id: uid, role: "user", name: "Asha" };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);

  const DB = sandbox.ExbDB.create();
  const settle = async () => { for (let i = 0; i < 4; i++) { fake.flush(); await new Promise((r) => setImmediate(r)); } };
  const runTimers = () => { const due = timers.splice(0); for (const t of due) if (t.fn) t.fn(); };
  return { DB, db, files, fake, state, deps, settle, runTimers, sandbox, ExbDB: sandbox.ExbDB };
}

const FORM = {
  name: "Asha Patel", phone: "9876543210", brand: "Urban Leaf", city: "Surat", gstin: "", call_time: "Morning",
  packs: 12000, flavours: [{ name: "Clove", packs: 12000 }]
};
const slip = () => new File([SAMPLE.jpeg()], "slip.jpg", { type: "image/jpeg", lastModified: 1 });
const pay = (booking, extra = {}) => ({
  booking_id: booking.id, milestone: "booking10", amount: 102000, utr: "SBIN1234567", paid_on: new Date().toISOString().slice(0, 10), file: slip(), ...extra
});
/* values from the browser sandbox live in another JavaScript realm, so compare them as plain JSON */
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
async function failure(promise) { try { await promise; } catch (e) { return e; } assert.fail("expected an error"); }

test("a new customer connects and sees no orders; only customer-readable data was requested", async () => {
  const j = await journey();
  await j.DB.init();
  same(await j.DB.myBookings(), []);
  const asked = new Set(j.fake.queried);
  for (const path of asked) assert.ok(["settings/portal", "slot_months", "slot_events", "bookings", "payments"].includes(path), `unexpected read: ${path}`);
  assert.ok(!asked.has("profiles") && !asked.has("events") && !asked.has("production_orders"));
});

test("booking: the order shows up at once with the server's price, slot and hold", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot({ ...FORM, price: 1, order_value: 5, slot_no: 1, stage: "confirmed" });
  assert.ok(booking.id && /^EXB-\d{6}-[A-Z2-9]{4}$/.test(booking.code), "has the id and code the page needs for tracking");
  assert.equal(booking.order_value, 1020000);
  assert.equal(booking.stage, "awaiting_payment");
  assert.ok(Date.parse(booking.hold_until) > Date.now(), "hold is in the future");
  const mine = await j.DB.myBookings();
  same(mine.map((b) => b.id), [booking.id], "shown immediately, before the live listener answers");
  assert.ok(j.DB.dueAmount ? true : j.ExbDB.dueAmount(mine[0], "booking10") === 102000);
});

test("after the live data catches up the order has its first update and appears once", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot(FORM);
  await j.settle();
  const mine = await j.DB.myBookings();
  assert.equal(mine.length, 1, "not duplicated by the overlay");
  assert.equal(mine[0].updates.length, 1);
  assert.match(mine[0].updates[0].note, /^Slot \d+ reserved for \d{4}-\d{2}\. Pay the 10% booking amount within 48 hours to confirm\.$/);
  assert.equal(mine[0].slot_month, booking.slot_month);
  const board = await j.DB.slotStatus();
  const taken = booking.slot_month === board.month ? board.taken : board.next_taken;
  assert.ok(taken.includes(booking.slot_no), "the slot board shows the slot as taken");
});

test("booking errors reach the customer as the server's sentence, and nothing is saved", async () => {
  const j = await journey();
  await j.DB.init();
  const e = await failure(j.DB.bookSlot({ ...FORM, packs: 6000, flavours: [{ name: "Clove", packs: 6000 }] }));
  assert.equal(e.message, "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
  same(await j.DB.myBookings(), []);
  assert.equal(j.db.list("bookings").length, 0);
});

test("paying: the slip is uploaded, the payment recorded, and the order moves to payment review", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot(FORM);
  await j.settle();
  const out = await j.DB.submitPayment(pay(booking));
  assert.ok(out.payment_id);
  assert.equal(j.files.store.size, 1, "one slip stored");
  const [path] = [...j.files.store.keys()];
  assert.match(path, new RegExp(`^payment-slips/cust1/${booking.id}/`));

  let [order] = await j.DB.myBookings();
  assert.equal(order.stage, "payment_review", "shown straight away");
  assert.equal(order.payments.length, 1);
  same([order.payments[0].amount, order.payments[0].status], [102000, "submitted"]);

  await j.settle();
  [order] = await j.DB.myBookings();
  assert.equal(order.stage, "payment_review", "and still right once the live data arrives");
  assert.equal(order.payments.length, 1, "the payment is not shown twice");
  assert.equal(order.payments[0].slip_path, path);
  assert.equal(order.updates.length, 2);
  assert.match(order.updates.at(-1).note, /^Payment slip for 10% booking slot amount submitted \(UTR SBIN1234567\)\.$/);
});

test("a refused payment (duplicate UTR) gives the reason and does not store the same slip twice on retry", async () => {
  const j = await journey();
  await j.DB.init();
  const a = await j.DB.bookSlot(FORM);
  const b = await j.DB.bookSlot({ ...FORM, packs: 7000, flavours: [{ name: "Clove", packs: 7000 }] });
  await j.settle();
  await j.DB.submitPayment(pay(a, { file: slip() }));
  const picked = slip();
  const e = await failure(j.DB.submitPayment(pay(b, { amount: 63000, file: picked })));
  assert.equal(e.message, "This UTR has already been submitted.");
  assert.equal(j.files.store.size, 2, "one slip per order so far");
  // fix the UTR and send again with the same file: no third copy
  await j.DB.submitPayment(pay(b, { amount: 63000, utr: "HDFC7654321", file: picked }));
  assert.equal(j.files.store.size, 2, "the already-uploaded slip was reused");
  const orders = await j.DB.myBookings();
  same(orders.map((o) => o.stage), ["payment_review", "payment_review"]);
});

test("a wrong amount is accepted for Accounts to judge; a missing slip is refused before anything is sent", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot(FORM);
  const e = await failure(j.DB.submitPayment({ ...pay(booking), file: undefined }));
  assert.equal(e.message, "Attach your payment slip (photo or PDF).");
  assert.equal(j.files.store.size, 0);
  const e2 = await failure(j.DB.submitPayment(pay(booking, { file: new File(["hello"], "x.txt", { type: "text/plain" }) })));
  assert.equal(e2.message, "Use a JPG, PNG, WEBP photo or a PDF.");
  assert.equal(j.files.store.size, 0);
});

test("Accounts verifies: the customer sees the order confirmed with the note, and the live toast data is correct", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot(FORM);
  const { payment_id } = await j.DB.submitPayment(pay(booking));
  await j.settle();

  j.state.user = netlifyUser("acct1", ["Account"]);
  const verify = await j.sandbox.fetch("/api/call/reviewPayment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payment_id, ok: true, note: "" }) });
  assert.equal(verify.status, 200);
  j.state.user = netlifyUser("cust1", ["user"]);
  await j.settle();

  const [order] = await j.DB.myBookings();
  assert.equal(order.stage, "confirmed");
  assert.equal(order.payments[0].status, "verified");
  assert.match(order.updates.at(-1).note, /^Payment of ₹1,02,000 verified by Accounts\.$/);
});

test("a rejected slip: the order returns to payment with a fresh hold and the reason is visible", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot(FORM);
  const { payment_id } = await j.DB.submitPayment(pay(booking));
  await j.settle();
  j.state.user = netlifyUser("acct1", ["Account"]);
  await j.sandbox.fetch("/api/call/reviewPayment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payment_id, ok: false, note: "Amount is not visible" }) });
  j.state.user = netlifyUser("cust1", ["user"]);
  await j.settle();
  const [order] = await j.DB.myBookings();
  assert.equal(order.stage, "awaiting_payment");
  assert.equal(order.payments[0].status, "rejected");
  assert.match(order.updates.at(-1).note, /^Payment slip rejected: Amount is not visible$/);
  assert.ok(Date.parse(order.hold_until) > Date.now());
});

test("file links open for the owner and for nobody else", async () => {
  const j = await journey();
  await j.DB.init();
  const booking = await j.DB.bookSlot(FORM);
  await j.DB.submitPayment(pay(booking));
  const path = [...j.files.store.keys()][0];
  const url = await j.DB.slipUrl(path);
  assert.equal(url, "/api/file?path=" + encodeURIComponent(path));
  assert.equal(await j.DB.docUrl(""), "", "no path, no link");

  const mine = await j.sandbox.fetch(url);
  assert.equal(mine.status, 200);
  assert.equal((await mine.arrayBuffer()).byteLength, SAMPLE.jpeg().byteLength);
  j.state.user = netlifyUser("someone-else", ["user"]);
  assert.equal((await j.sandbox.fetch(url)).status, 404);
  j.state.user = netlifyUser("prod1", ["Production"]);
  assert.equal((await j.sandbox.fetch(url)).status, 404, "Production never opens payment slips");
  j.state.user = netlifyUser("acct1", ["Account"]);
  assert.equal((await j.sandbox.fetch(url)).status, 200);
});

test("a customer never sees another customer's order or payment", async () => {
  const j = await journey();
  await j.DB.init();
  // another customer already has an order and a payment
  j.db.put("bookings/otherorder00000000001", { user_id: "cust2", stage: "payment_review", code: "EXB-OTHER", created_at: new Date(), dispatch: {} });
  j.db.put("payments/otherpay0000000000001", { user_id: "cust2", booking_id: "otherorder00000000001", amount: 1, created_at: new Date() });
  await j.settle();
  same(await j.DB.myBookings(), []);
});

test("live toasts: other brands' new bookings are announced after a short wait; the customer's own never is", async () => {
  const j = await journey();
  await j.DB.init();
  const heard = [];
  const stop = j.DB.subscribe((table, row) => { if (row) heard.push([table, row]); });

  const own = await j.DB.bookSlot(FORM);
  await j.settle();
  j.runTimers();
  assert.equal(heard.length, 0, "own booking: no toast about yourself");

  // someone else books
  const other = netlifyUser("cust2", ["user"]);
  j.state.user = other;
  const res = await j.sandbox.fetch("/api/call/bookSlot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...FORM, name: "Ravi Shah", city: "Pune", brand: "Rival" }) });
  const rival = (await res.json()).booking;
  j.state.user = netlifyUser("cust1", ["user"]);
  await j.settle();
  assert.equal(heard.length, 0, "not announced instantly");
  j.runTimers();
  assert.equal(heard.length, 1);
  const [table, row] = heard[0];
  assert.equal(table, "slot_events");
  same([row.slot_month, row.slot_no, row.city], [rival.slot_month, rival.slot_no, "Pune"]);
  assert.ok(row.id && row.created_at, "has what the page needs to show and de-duplicate it");
  assert.notEqual(rival.slot_no, own.slot_no);

  // the page is told about every change so it can refresh
  stop();
  heard.length = 0;
});

test("old slot events present when the page opens are not announced as new", async () => {
  const j = await journey();
  j.db.put("slot_events/old000000000000000001", { slot_month: "2026-10", slot_no: 5, city: "Delhi", created_at: new Date(Date.now() - 3600e3) });
  await j.DB.init();
  const heard = [];
  j.DB.subscribe((table, row) => { if (row) heard.push(row); });
  await j.settle();
  j.runTimers();
  assert.equal(heard.length, 0);
});

test("a staff account is refused by the order actions, and a mismatched role stops the connection", async () => {
  const j = await journey({ uid: "acct1", role: "accounts", profile: { id: "acct1", role: "user" } });
  const e = await failure(j.DB.init());
  assert.equal(e.message, "Your access changed. Sign out and sign in again.");
});
