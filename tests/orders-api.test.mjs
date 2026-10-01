import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../netlify/lib/api-endpoint.js";
import { fakeFiles, fakeFirestore } from "./helpers/fake-firestore.mjs";
import { makeRequest, netlifyUser, silent, verifyOrigin } from "./helpers/fakes.mjs";

const NOW = Date.parse("2026-10-01T10:00:00Z");
const FORM = {
  name: "Asha Patel", phone: "9876543210", brand: "Urban Leaf", city: "Surat", gstin: "", call_time: "Morning",
  packs: 7000, flavours: [{ name: "Clove", packs: 7000 }]
};

function setup(roles, id = "u1") {
  const db = fakeFirestore({});
  const files = fakeFiles();
  const deps = {
    verifyOrigin, getUser: async () => (roles ? netlifyUser(id, roles) : null), identity: {},
    firebase: () => ({ db, serverTime: () => new Date(NOW) }), files, now: () => NOW, random: () => 0.37, log: silent
  };
  const call = async (action, body) => {
    const res = await handleApi(makeRequest("/api/call/" + action, { body }), action, deps);
    return { status: res.status, body: await res.json() };
  };
  return { call, db, files };
}

test("a customer books through the real API door", async () => {
  const { call, db } = setup(["user"]);
  const { status, body } = await call("bookSlot", FORM);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.booking.slot_no, 5);
  assert.equal(db.list("bookings").length, 1);
});

test("only customers may book or pay; staff accounts and signed-out callers may not", async () => {
  for (const roles of [["Admin"], ["Production"], ["Account"]]) {
    const { call, db } = setup(roles);
    for (const action of ["bookSlot", "submitPayment"]) {
      const { status } = await call(action, FORM);
      assert.equal(status, 403, `${JSON.stringify(roles)} ${action}`);
    }
    assert.equal(db.list("bookings").length, 0);
  }
  assert.equal((await setup(null).call("bookSlot", FORM)).status, 401);
});

test("only Accounts and Admin may verify or reject a payment; customers and Production may not", async () => {
  for (const [roles, status] of [[["user"], 403], [["Production"], 403], [[], 403], /* no role = customer */ [["Account"], 404], [["Admin"], 404]]) {
    const { call } = setup(roles);
    // 404 means "allowed in, but there is no such payment" - the role gate was passed
    const out = await call("reviewPayment", { payment_id: "nothere0000000000001", ok: true });
    assert.equal(out.status, status, JSON.stringify(roles));
  }
});

test("a payment cannot be sent without a slip, over the API either", async () => {
  const { call } = setup(["user"]);
  const booked = (await call("bookSlot", FORM)).body.booking;
  const out = await call("submitPayment", { booking_id: booked.id, milestone: "booking10", amount: 63000, utr: "SBIN1234567", paid_on: "2026-10-01" });
  assert.equal(out.status, 400);
  assert.equal(out.body.error.message, "Attach your payment slip (photo or PDF).");
});

test("a rule problem reaches the customer as a short, plain message", async () => {
  const { call } = setup(["user"]);
  const out = await call("bookSlot", { ...FORM, packs: 5000, flavours: [{ name: "Clove", packs: 5000 }] });
  assert.equal(out.status, 400);
  assert.equal(out.body.error.message, "Invalid batch size. Minimum is 7,000 packs in lots of 1,000.");
});
