import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../shared/portal-store.js";
import { LATER_STEP_MESSAGE, OFFLINE_MESSAGE, createApiClient } from "../shared/portal-client.js";
import { checkDispatch, checkDispatchForm, checkDocs, checkDocsForm, checkFile, checkShippingForm } from "../shared/portal-validate.js";

/* A fake listener we control from the test. */
function fakeSource() {
  const handle = { stopped: false };
  return {
    handle,
    start(onData, onError) {
      handle.onData = onData;
      handle.onError = onError;
      return () => { handle.stopped = true; };
    }
  };
}

test("whenReady waits until every source has delivered", async () => {
  const a = fakeSource();
  const b = fakeSource();
  const store = createStore({ a: a.start ? a : a, b });
  let ready = false;
  const p = store.whenReady().then(() => { ready = true; });
  await Promise.resolve();
  a.handle.onData([1]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ready, false);
  b.handle.onData([2]);
  await p;
  assert.equal(ready, true);
  assert.deepEqual(store.get("a"), [1]);
  assert.deepEqual(store.get("b"), [2]);
});

test("whenReadyFor opens once the named sources arrive and leaves the rest loading", async () => {
  const fast = fakeSource();
  const slow = fakeSource();
  const store = createStore({ fast, slow });
  let ready = false;
  const p = store.whenReadyFor(["fast"]).then(() => { ready = true; });
  await Promise.resolve();
  fast.handle.onData([1]);
  await p;
  assert.equal(ready, true);
  assert.equal(store.get("slow"), undefined);
  slow.handle.onData([2]);
  await Promise.resolve();
  assert.deepEqual(store.get("slow"), [2]);
});

test("changes update the cache and tell subscribers which source changed", async () => {
  const a = fakeSource();
  const store = createStore({ a });
  const seen = [];
  store.subscribe((name) => seen.push(name));
  const p = store.whenReady();
  a.handle.onData([1]);
  await p;
  a.handle.onData([1, 2]);
  assert.deepEqual(store.get("a"), [1, 2]);
  assert.deepEqual(seen, ["a", "a"]);
});

test("an error before ready rejects whenReady with that error", async () => {
  const a = fakeSource();
  const b = fakeSource();
  const store = createStore({ a, b });
  const p = store.whenReady();
  a.handle.onError(new Error("permission-denied"));
  await assert.rejects(p, /permission-denied/);
  assert.equal(store.error().message, "permission-denied");
});

test("an error after ready is remembered and reported on the next whenReady", async () => {
  const a = fakeSource();
  const store = createStore({ a });
  const p = store.whenReady();
  a.handle.onData([]);
  await p;
  a.handle.onError(new Error("lost access"));
  await assert.rejects(store.whenReady(), /lost access/);
});

test("patch changes the cache at once and notifies", async () => {
  const a = fakeSource();
  const store = createStore({ a });
  const p = store.whenReady();
  a.handle.onData([{ id: 1, role: "customer" }]);
  await p;
  let notified = 0;
  store.subscribe(() => notified++);
  store.patch("a", (list) => list.map((x) => ({ ...x, role: "accounts" })));
  assert.equal(store.get("a")[0].role, "accounts");
  assert.equal(notified, 1);
});

test("stop unsubscribes every listener and ignores late data", async () => {
  const a = fakeSource();
  const store = createStore({ a });
  const p = store.whenReady();
  a.handle.onData([1]);
  await p;
  store.stop();
  assert.equal(a.handle.stopped, true);
  a.handle.onData([9]);
  assert.deepEqual(store.get("a"), [1]);
});

test("a subscriber that throws does not stop the others", async () => {
  const a = fakeSource();
  const store = createStore({ a });
  let good = 0;
  store.subscribe(() => { throw new Error("bad"); });
  store.subscribe(() => good++);
  const p = store.whenReady();
  a.handle.onData([]);
  await p;
  assert.equal(good, 1);
});

/* ---------- API client ---------- */
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("a good reply is returned", async () => {
  const call = createApiClient(reply(200, { ok: true, id: "x" }));
  assert.deepEqual(await call("setRole", { a: 1 }), { ok: true, id: "x" });
});

test("it posts JSON to the right address with the cookie", async () => {
  let seen;
  const call = createApiClient(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
  await call("saveSettings", { settings: { a: 1 } });
  assert.equal(seen.url, "/api/call/saveSettings");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(seen.init.body), { settings: { a: 1 } });
  await call("a/b", {});
  assert.equal(seen.url, "/api/call/a%2Fb");
});

test("the server's own sentence is passed on, with Admin detail when present", async () => {
  await assert.rejects(createApiClient(reply(400, { ok: false, error: { code: "invalid", message: "You cannot change your own access." } }))("setRole", {}), /You cannot change your own access\./);
  await assert.rejects(createApiClient(reply(500, { ok: false, error: { code: "x", message: "Nope", detail: "because" } }))("a", {}), /Nope \(because\)/);
});

test("an action the server does not have yet says it is a later step", async () => {
  await assert.rejects(createApiClient(reply(404, { ok: false, error: { code: "unknown_action", message: "That action does not exist." } }))("reviewPayment", {}), (e) => e.message === LATER_STEP_MESSAGE && e.code === "later_step");
});

test("signed out, offline and garbage replies all give friendly messages", async () => {
  await assert.rejects(createApiClient(reply(401, { ok: false, error: { code: "signed_out", message: "x" } }))("a", {}), /Sign in again/);
  await assert.rejects(createApiClient(async () => { throw new TypeError("Failed to fetch"); })("a", {}), (e) => e.message === OFFLINE_MESSAGE);
  await assert.rejects(createApiClient(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }))("a", {}), /Something went wrong/);
});

/* ---------- validators ---------- */
const docs = (over = {}) => ({ invoice_no: "I1", invoice_date: "2026-10-01", eway_no: "123456789012", eway_valid_till: "2026-10-05", invoiceFile: {}, ewayFile: {}, ...over });

test("checkDocs accepts complete documents and uses the exact messages otherwise", () => {
  checkDocs(docs());
  checkDocs(docs({ invoiceFile: null, invoice_path: "p", ewayFile: null, eway_path: "q", eway_no: "1234 5678 9012" }));
  assert.throws(() => checkDocs(docs({ invoice_no: " " })), /Fill invoice number, invoice date, e-way bill number and e-way bill valid-till date\./);
  assert.throws(() => checkDocs(docs({ eway_no: "12345" })), /E-way bill number must be 12 digits\./);
  assert.throws(() => checkDocs(docs({ invoiceFile: null })), /Attach the tax invoice/);
  assert.throws(() => checkDocs(docs({ ewayFile: null })), /Attach the e-way bill/);
  assert.throws(() => checkDocs(null), /Fill invoice number/);
});

test("checkDispatch needs all three fields", () => {
  checkDispatch({ transporter: "T", vehicle_no: "GJ05", lr_no: "1" });
  for (const missing of ["transporter", "vehicle_no", "lr_no"]) {
    const x = { transporter: "T", vehicle_no: "GJ05", lr_no: "1", [missing]: "  " };
    assert.throws(() => checkDispatch(x), /Fill transporter, vehicle number and LR \/ docket number\./);
  }
});

test("checkFile: type and size rules, and tells big photos to shrink", () => {
  assert.throws(() => checkFile(null), /Attach the payment slip/);
  assert.throws(() => checkFile(null, "Attach the QC report (PDF or photo)."), /QC report/);
  assert.throws(() => checkFile({ type: "image/gif", size: 10 }), /Use a JPG, PNG, WEBP photo or a PDF\./);
  assert.throws(() => checkFile({ type: "application/pdf", size: 6 * 1024 * 1024 }), /PDF must be under 5 MB\./);
  assert.equal(checkFile({ type: "application/pdf", size: 1024 }), false);
  assert.equal(checkFile({ type: "image/jpeg", size: 100 * 1024 }), false);
  assert.equal(checkFile({ type: "image/png", size: 3 * 1024 * 1024 }), true);
});

test("server shipping, document and dispatch forms use the exact sentences", () => {
  assert.deepEqual(checkShippingForm({ amount: 12500, note: "By road" }), { amount: 12500, note: "By road" });
  assert.equal(checkShippingForm({ amount: 0 }).amount, 0);
  assert.throws(() => checkShippingForm({ amount: "" }), /Enter the shipping charge \(0 if none\)\./);
  assert.throws(() => checkShippingForm({ amount: -1 }), /Shipping charge cannot be negative\./);
  const docsOk = checkDocsForm({
    invoice_no: "INV-1", invoice_date: "2026-10-01", eway_no: "1234 5678 9012",
    eway_date: "2026-10-01", eway_valid_till: "2026-10-02"
  }, "2026-10-01");
  assert.equal(docsOk.eway_no, "123456789012");
  assert.throws(() => checkDocsForm({ invoice_no: "I", invoice_date: "2026-10-01", eway_no: "1", eway_valid_till: "2026-10-02" }, "2026-10-01"), /E-way bill number must be 12 digits\./);
  assert.throws(() => checkDocsForm({
    invoice_no: "I", invoice_date: "2026-10-01", eway_no: "123456789012", eway_date: "2026-10-01", eway_valid_till: "2026-09-30"
  }, "2026-10-01"), /The e-way bill validity date has already passed\./);
  const d = checkDispatchForm({ transporter: "SafeRoad", vehicle_no: "gj05-ab-1234", lr_no: "LR-1" }, "2026-10-01");
  assert.equal(d.vehicle_no, "GJ05AB1234");
  assert.equal(d.dispatched_on, "2026-10-01");
  assert.throws(() => checkDispatchForm({ transporter: "T", vehicle_no: "GJ05", lr_no: "" }, "2026-10-01"), /Fill transporter, vehicle number and LR \/ docket number\./);
  assert.throws(() => checkDispatchForm({ transporter: "T", vehicle_no: "GJ05", lr_no: "1", dispatched_on: "2026-10-02" }, "2026-10-01"), /Dispatch date cannot be in the future\./);
});
