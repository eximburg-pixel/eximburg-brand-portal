/*
  Production and Admin through the REAL browser data layer and the REAL server code.
  The in-memory Firestore stand-in enforces what each role may read (see browser-firestore.mjs),
  so a Production login that asked for bookings, payments, events or profiles would fail here.
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

const FORM = {
  name: "Asha Patel", phone: "9876543210", brand: "Urban Leaf", city: "Surat", gstin: "24ABCDE1234F1Z5", call_time: "Morning",
  packs: 7000, flavours: [{ name: "Clove", packs: 7000 }]
};
const MONEY = /[₹%]|\bUTR\b|\bslip\b|order_value|approval_fee|shipping_charge|"price"|gstin|hold_until/;

async function panel({ uid, role, netlifyRoles, db, files, clock }) {
  const state = { user: netlifyUser(uid, netlifyRoles) };
  const deps = {
    verifyOrigin, getUser: async () => state.user, identity: {},
    firebase: () => ({ db, serverTime: () => new Date(clock.now) }),
    files, now: () => clock.now, random: () => 0.37, log: silent
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
      if (url.startsWith("/api/upload/")) {
        const kind = decodeURIComponent(url.slice("/api/upload/".length).split("?")[0]);
        return handleUpload(req, kind, deps);
      }
      if (url.startsWith("/api/file")) return handleFile(req, deps);
      throw new Error("unexpected fetch " + url);
    }
  };
  sandbox.window = sandbox;
  sandbox.EXB_PROFILE = { id: uid, role, name: uid };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  const DB = sandbox.ExbDB.create();
  const settle = async () => { for (let i = 0; i < 4; i++) { fake.flush(); await new Promise((r) => setImmediate(r)); } };
  return { DB, db, files, fake, state, deps, settle, sandbox };
}

async function confirmedWorld() {
  const clock = { now: Date.parse("2026-10-01T10:00:00Z") };
  const db = fakeFirestore({
    "profiles/acct1": { name: "Meera", role: "accounts" },
    "profiles/prod1": { name: "Priya", role: "production" },
    "profiles/admin1": { name: "Hitesh", role: "admin" }
  });
  const files = fakeFiles();
  let current = netlifyUser("cust1", ["user"]);
  const deps = {
    verifyOrigin, getUser: async () => current, identity: {},
    firebase: () => ({ db, serverTime: () => new Date(clock.now) }),
    files, now: () => clock.now, random: () => 0.37, log: silent
  };
  const call = async (user, action, payload) => {
    current = user;
    const res = await handleApi(
      new Request(SITE + "/api/call/" + action, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify(payload) }),
      action,
      deps
    );
    clock.now += 1;
    return { status: res.status, body: await res.json() };
  };
  const booked = await call(netlifyUser("cust1", ["user"]), "bookSlot", FORM);
  const booking = booked.body.booking;
  const path = `payment-slips/cust1/${booking.id}/s.jpg`;
  files.store.set(path, { bytes: SAMPLE.jpeg(), meta: { contentType: "image/jpeg" } });
  const pay = await call(netlifyUser("cust1", ["user"]), "submitPayment", {
    booking_id: booking.id, milestone: "booking10", amount: 63000, utr: "SBINAAA111", paid_on: "2026-10-01", slip_path: path
  });
  clock.now += 60000;
  await call(netlifyUser("acct1", ["Account"]), "reviewPayment", { payment_id: pay.body.payment_id, ok: true, note: "" });
  return { db, files, clock, booking };
}

test("Production connects to the factory copy only; money collections are never requested", async () => {
  const { db, files, clock } = await confirmedWorld();
  const j = await panel({ uid: "prod1", role: "production", netlifyRoles: ["Production"], db, files, clock });
  await j.DB.init();
  const asked = new Set(j.fake.queried);
  for (const path of asked) {
    assert.ok(["settings/factory", "slot_months", "production_orders"].includes(path), `Production read ${path}`);
  }
  assert.ok(asked.has("production_orders"));
  assert.ok(!asked.has("bookings") && !asked.has("payments") && !asked.has("events") && !asked.has("profiles"));
});

test("after the 10% is verified the order is on the Production board, with no money fields", async () => {
  const { db, files, clock, booking } = await confirmedWorld();
  const j = await panel({ uid: "prod1", role: "production", netlifyRoles: ["Production"], db, files, clock });
  await j.DB.init();
  await j.settle();
  const staff = await j.DB.staffData();
  assert.equal(staff.productionOnly, true);
  assert.equal(staff.bookings.length, 1);
  assert.equal(staff.bookings[0].id, booking.id);
  assert.equal(staff.bookings[0].stage, "confirmed");
  assert.equal(staff.bookings[0].brand, "Urban Leaf");
  assert.equal(staff.payments.length, 0);
  const text = JSON.stringify(staff);
  assert.equal(MONEY.test(text), false, text.slice(0, 400));
});

test("Production moves one step through the data layer; skipping a payment is still refused", async () => {
  const { db, files, clock, booking } = await confirmedWorld();
  const j = await panel({ uid: "prod1", role: "production", netlifyRoles: ["Production"], db, files, clock });
  await j.DB.init();
  await j.DB.setStage(booking.id, "label_design", "Designer assigned");
  clock.now += 1;
  await j.settle();
  assert.equal((await j.DB.staffData()).bookings[0].stage, "label_design");
  await assert.rejects(j.DB.setStage(booking.id, "approval_packaging", ""), (e) => e.message === "Your role cannot move this order to that stage.");
});

test("Admin office data still has money; the factory copy used on Production tabs does not", async () => {
  const { db, files, clock, booking } = await confirmedWorld();
  const j = await panel({ uid: "admin1", role: "admin", netlifyRoles: ["Admin"], db, files, clock });
  await j.DB.init();
  await j.settle();
  const staff = await j.DB.staffData();
  const office = staff.bookings.find((b) => b.id === booking.id);
  assert.equal(office.order_value, 630000);
  assert.ok(office.gstin);
  const factory = staff.factory.find((b) => b.id === booking.id);
  assert.equal(factory.stage, "confirmed");
  assert.equal(factory.order_value, undefined);
  assert.equal(factory.gstin, undefined);
  assert.equal(MONEY.test(JSON.stringify(factory)), false);
});
