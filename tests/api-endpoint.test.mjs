import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../netlify/lib/api-endpoint.js";
import { DEFAULT_SETTINGS } from "../shared/portal-settings.js";
import { SERVER_TIME, fakeAuth, fakeDb, fakeIdentity, makeRequest, netlifyUser, silent, verifyOrigin } from "./helpers/fakes.mjs";

function setup({ user, users = [], db = fakeDb(), auth = fakeAuth(), identityOptions } = {}) {
  const identity = fakeIdentity(users, identityOptions);
  const deps = {
    verifyOrigin,
    getUser: async () => user,
    identity,
    firebase: () => ({ auth, db, serverTime: () => SERVER_TIME }),
    log: silent
  };
  const call = async (action, body, requestOptions) => {
    const res = await handleApi(makeRequest("/api/call/" + action, { body, ...requestOptions }), action, deps);
    return { res, body: await res.json() };
  };
  return { call, db, auth, identity };
}

const admin = () => netlifyUser("admin1", ["Admin"]);
const settings = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

/* ---------- the door ---------- */
test("signed-out callers get 401", async () => {
  const { call } = setup({ user: null });
  const { res } = await call("saveSettings", { settings: settings() });
  assert.equal(res.status, 401);
});

test("GET is refused, cross-site POST is refused", async () => {
  const { call } = setup({ user: admin() });
  assert.equal((await call("saveSettings", {}, { method: "GET" })).res.status, 405);
  assert.equal((await call("saveSettings", {}, { origin: "https://evil.example" })).res.status, 403);
});

test("unknown actions are 404, including names that exist on every JavaScript object", async () => {
  const { call } = setup({ user: admin() });
  for (const name of ["nope", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal((await call(name, {})).res.status, 404, name);
  }
});

test("bad bodies are refused with a friendly 4xx", async () => {
  const { call } = setup({ user: admin() });
  assert.equal((await call("saveSettings", "{broken")).res.status, 400);
  assert.equal((await call("saveSettings", "[1,2]")).res.status, 400);
  assert.equal((await call("saveSettings", "{}", { type: "text/plain" })).res.status, 415);
  assert.equal((await call("saveSettings", "x".repeat(250 * 1024))).res.status, 413);
});

/* ---------- who may do what ---------- */
test("only Admin may use admin actions: customers, Production and Accounts are refused", async () => {
  for (const roles of [["user"], ["Production"], ["Account"], ["sales"], []]) {
    const { call, db } = setup({ user: netlifyUser("x", roles), users: [netlifyUser("t1")] });
    for (const [action, body] of [["saveSettings", { settings: settings() }], ["setRole", { userId: "t1", role: "admin" }], ["syncProfiles", {}]]) {
      const { res } = await call(action, body);
      assert.equal(res.status, 403, `${JSON.stringify(roles)} ${action}`);
    }
    assert.equal(db.writes.length, 0);
  }
});

/* ---------- saveSettings ---------- */
test("Admin saves settings: validated copy is stored and returned", async () => {
  const { call, db } = setup({ user: admin() });
  const s = settings();
  s.monthSlots = 20;
  s.hacker = "x";
  const { res, body } = await call("saveSettings", { settings: s });
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  const saved = db.store.get("settings/portal");
  assert.equal(saved.monthSlots, 20);
  assert.equal(saved.hacker, undefined);
  assert.equal(saved.updated_by, "admin1");
  assert.deepEqual(saved.updated_at, SERVER_TIME);
  const factory = db.store.get("settings/factory");
  assert.equal(factory.monthSlots, 20);
  assert.equal(factory.bank, undefined);
  assert.equal(factory.upi, undefined);
  assert.equal(factory.paymentQr, undefined);
});

test("Admin bank, UPI, WhatsApp, GST, offer and consented brands are what customers will read", async () => {
  const { call, db } = setup({ user: admin() });
  const s = settings();
  s.whatsapp = "919876543210";
  s.bank = { accountName: "Eximburg International Pvt Ltd", bankName: "HDFC", accountNo: "1234567890", ifsc: "HDFC0001234", branch: "Surat", accountType: "Current" };
  s.upi = { id: "eximburg@okhdfcbank", payee: "Eximburg" };
  s.gstNote_en = "GST on invoice.";
  s.offer.title_en = "Free seller setup";
  s.testimonials = [
    { brand: "Royal Swag", consent: true, quote_en: "Ours" },
    { brand: "Hidden Co", consent: false, quote_en: "Not yet" }
  ];
  const { res } = await call("saveSettings", { settings: s });
  assert.equal(res.status, 200);
  const saved = db.store.get("settings/portal");
  assert.equal(saved.whatsapp, "919876543210");
  assert.equal(saved.bank.ifsc, "HDFC0001234");
  assert.equal(saved.upi.id, "eximburg@okhdfcbank");
  assert.equal(saved.gstNote_en, "GST on invoice.");
  assert.equal(saved.offer.title_en, "Free seller setup");
  assert.equal(saved.testimonials[0].consent, true);
  assert.equal(saved.testimonials[1].consent, false);
});

test("invalid settings are rejected with the plain sentence, and nothing is written", async () => {
  const { call, db } = setup({ user: admin() });
  const s = settings();
  s.royalSwagReserved = 15;
  const { res, body } = await call("saveSettings", { settings: s });
  assert.equal(res.status, 400);
  assert.equal(body.error.message, "Royal Swag slots must be fewer than total slots.");
  assert.equal(db.writes.length, 0);
  assert.equal((await call("saveSettings", {})).res.status, 400);
});

/* ---------- setRole ---------- */
test("Admin promotes a customer to Accounts: Netlify, profile and sessions all updated", async () => {
  const target = netlifyUser("t1", ["user"]);
  const { call, db, auth, identity } = setup({ user: admin(), users: [target], db: fakeDb({ "profiles/t1": { name: "T", role: "customer" } }) });
  const { res, body } = await call("setRole", { userId: "t1", role: "accounts" });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, id: "t1", role: "accounts" });
  assert.deepEqual(identity.map.get("t1").roles, ["Account"]);
  assert.equal(identity.map.get("t1").appMetadata.provider, "email"); // other metadata kept
  assert.equal(db.store.get("profiles/t1").role, "accounts");
  assert.deepEqual(auth.calls.revoked, ["t1"]);
});

test("every role name goes to the exact Netlify spelling", async () => {
  for (const [role, netlify] of [["customer", "user"], ["production", "Production"], ["accounts", "Account"], ["admin", "Admin"]]) {
    const start = role === "customer" ? ["Admin"] : ["user"];
    const { call, identity } = setup({ user: admin(), users: [netlifyUser("t1", start)] });
    const { res } = await call("setRole", { userId: "t1", role });
    assert.equal(res.status, 200, role);
    assert.deepEqual(identity.map.get("t1").roles, [netlify]);
  }
});

test("Admin cannot change their own access", async () => {
  const { call, identity } = setup({ user: admin(), users: [admin()] });
  const { res, body } = await call("setRole", { userId: "admin1", role: "customer" });
  assert.equal(res.status, 400);
  assert.equal(body.error.message, "You cannot change your own access.");
  assert.equal(identity.calls.updates.length, 0);
});

test("setRole rejects bad input and unknown people", async () => {
  const { call, identity } = setup({ user: admin(), users: [netlifyUser("t1")] });
  assert.equal((await call("setRole", { userId: "", role: "admin" })).res.status, 400);
  assert.equal((await call("setRole", { userId: "t1", role: "superuser" })).res.status, 400);
  assert.equal((await call("setRole", { userId: "t1", role: "Admin" })).res.status, 400); // spec names only
  assert.equal((await call("setRole", { userId: "t1" })).res.status, 400);
  assert.equal((await call("setRole", { userId: 5, role: "admin" })).res.status, 400);
  assert.equal((await call("setRole", { userId: "ghost", role: "admin" })).res.status, 404);
  assert.equal(identity.calls.updates.length, 0);
});

test("a stray account-level role that would keep staff access is cleared", async () => {
  const target = netlifyUser("t1", ["user"], { role: "Admin" });
  const { call, identity } = setup({ user: admin(), users: [target] });
  const { res } = await call("setRole", { userId: "t1", role: "customer" });
  assert.equal(res.status, 200);
  assert.equal(identity.map.get("t1").role, undefined);
  assert.equal(identity.calls.updates[0].attrs.role, "");
});

test("if Netlify does not apply the change, Admin is told and the profile is NOT changed", async () => {
  const { call, db, auth } = setup({
    user: admin(), users: [netlifyUser("t1", ["user"])], identityOptions: { ignoreRoleUpdate: true },
    db: fakeDb({ "profiles/t1": { role: "customer" } })
  });
  const { res, body } = await call("setRole", { userId: "t1", role: "admin" });
  assert.equal(res.status, 500);
  assert.equal(body.error.code, "role_not_applied");
  assert.ok(body.error.detail); // Admin sees the technical reason
  assert.equal(db.store.get("profiles/t1").role, "customer");
  assert.equal(auth.calls.revoked.length, 0);
});

test("setRole creates the profile when the person never signed in to Firebase", async () => {
  const { call, db } = setup({ user: admin(), users: [netlifyUser("t1", ["user"])] });
  await call("setRole", { userId: "t1", role: "production" });
  const p = db.store.get("profiles/t1");
  assert.equal(p.role, "production");
  assert.equal(p.name, "Person t1");
});

test("a person with no Firebase account yet is fine; other revoke errors are reported", async () => {
  const notFound = Object.assign(new Error("no user"), { code: "auth/user-not-found" });
  let r = setup({ user: admin(), users: [netlifyUser("t1")], auth: fakeAuth({ revokeError: notFound }) });
  assert.equal((await r.call("setRole", { userId: "t1", role: "accounts" })).res.status, 200);
  r = setup({ user: admin(), users: [netlifyUser("t1")], auth: fakeAuth({ revokeError: new Error("boom") }) });
  assert.equal((await r.call("setRole", { userId: "t1", role: "accounts" })).res.status, 500);
});

/* ---------- checkSetup ---------- */
test("checkSetup reports all good when everything works", async () => {
  const { call } = setup({ user: admin(), users: [netlifyUser("t1")] });
  const { res, body } = await call("checkSetup", {});
  assert.equal(res.status, 200);
  assert.equal(body.allOk, true);
  assert.equal(body.checks.length, 5);
});

test("checkSetup tells Admin to switch on Firebase Authentication when it is off", async () => {
  const off = Object.assign(new Error("CONFIGURATION_NOT_FOUND"), { code: "auth/configuration-not-found" });
  const { call } = setup({ user: admin(), users: [], auth: fakeAuth({ getUserError: off }) });
  const { body } = await call("checkSetup", {});
  assert.equal(body.allOk, false);
  const check = body.checks.find((c) => c.name === "Firebase Authentication switched on");
  assert.equal(check.ok, false);
  assert.match(check.note, /Authentication > Get started/);
});

test("checkSetup says what is wrong when the key is missing, and never leaks anything secret", async () => {
  const identity = fakeIdentity([]);
  const deps = {
    verifyOrigin, getUser: async () => admin(), identity, log: silent,
    firebase: () => { throw Object.assign(new Error("The portal is still being set up."), { status: 503, detail: "FIREBASE_SERVICE_ACCOUNT is not set in Netlify (or is empty)." }); }
  };
  const res = await handleApi(makeRequest("/api/call/checkSetup", { body: {} }), "checkSetup", deps);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.allOk, false);
  assert.equal(body.checks[0].ok, false);
  assert.match(body.checks[0].note, /not set/);
  assert.equal(body.checks.length, 2); // key problem + Netlify users; Firebase checks are skipped
});

test("checkSetup reports a refused key and an unreachable database separately", async () => {
  const auth = { async createCustomToken() { throw new Error("invalid_grant"); }, async getUser() { throw Object.assign(new Error("x"), { code: "auth/user-not-found" }); } };
  const db = { doc() { return { async get() { throw new Error("PERMISSION_DENIED"); } }; } };
  const identity = fakeIdentity([]);
  const deps = { verifyOrigin, getUser: async () => admin(), identity, log: silent, firebase: () => ({ auth, db, serverTime: () => SERVER_TIME }) };
  const res = await handleApi(makeRequest("/api/call/checkSetup", { body: {} }), "checkSetup", deps);
  const body = await res.json();
  assert.equal(body.allOk, false);
  assert.match(body.checks[1].note, /refused/);
  assert.match(body.checks[3].note, /PERMISSION_DENIED/);
});

/* ---------- syncProfiles ---------- */
test("syncProfiles creates missing profiles, fixes wrong roles, leaves correct ones alone", async () => {
  const users = [netlifyUser("a", ["user"]), netlifyUser("b", ["Production"]), netlifyUser("c", ["Account"])];
  const db = fakeDb({ "profiles/b": { name: "B", role: "customer" }, "profiles/c": { name: "C", role: "accounts" } });
  const { call } = setup({ user: admin(), users, db });
  const { res, body } = await call("syncProfiles", {});
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, seen: 3, created: 1, fixed: 1 });
  assert.equal(db.store.get("profiles/a").role, "customer");
  assert.equal(db.store.get("profiles/b").role, "production");
  assert.equal(db.writes.filter(([, p]) => p === "profiles/c").length, 0);
});

test("Admin sets Production and Accounts sign-in, and can read those credentials back", async () => {
  const { call, db, auth, identity } = setup({ user: admin() });
  const denied = await setup({ user: netlifyUser("p1", ["Production"]) }).call("saveStaffLogin", { role: "production", email: "line@eximburg.test", password: "line-pass-1" });
  assert.equal(denied.res.status, 403);
  const accountsDenied = await setup({ user: netlifyUser("a1", ["Account"]) }).call("staffLogins", {});
  assert.equal(accountsDenied.res.status, 403);

  const created = await call("saveStaffLogin", { role: "production", email: "line@eximburg.test", password: "line-pass-1" });
  assert.equal(created.res.status, 200);
  const prod = [...identity.map.values()].find((u) => u.email === "line@eximburg.test");
  assert.equal(prod.password, "line-pass-1");
  assert.deepEqual(prod.roles, ["Production"]);
  assert.equal(db.store.get("staff_logins/desk").production.password, "line-pass-1");
  assert.ok(auth.calls.revoked.includes(prod.id));
  assert.equal(db.store.get("profiles/" + prod.id).role, "production");
  assert.equal(db.store.get("profiles/" + prod.id).password, undefined);

  const again = await call("saveStaffLogin", { role: "production", email: "floor@eximburg.test", password: "line-pass-2" });
  assert.equal(again.res.status, 200);
  assert.equal(identity.map.get(prod.id).email, "floor@eximburg.test");
  assert.equal(identity.map.get(prod.id).password, "line-pass-2");

  await call("saveStaffLogin", { role: "accounts", email: "books@eximburg.test", password: "books-pass-1" });
  const listed = await call("staffLogins", {});
  assert.deepEqual(listed.body.logins.production, { email: "floor@eximburg.test", password: "line-pass-2" });
  assert.deepEqual(listed.body.logins.accounts, { email: "books@eximburg.test", password: "books-pass-1" });

  assert.equal((await call("saveStaffLogin", { role: "accounts", email: "bad", password: "books-pass-1" })).res.status, 400);
  assert.equal((await call("saveStaffLogin", { role: "accounts", email: "books@eximburg.test", password: "short" })).res.status, 400);
  assert.equal((await call("saveStaffLogin", { role: "admin", email: "boss@eximburg.test", password: "boss-pass-1" })).res.status, 400);
  const clash = await call("saveStaffLogin", { role: "accounts", email: "floor@eximburg.test", password: "books-pass-9" });
  assert.equal(clash.res.status, 409);
});

test("an existing Production account is updated in place", async () => {
  const existing = netlifyUser("prod1", ["Production"]);
  const { call, identity } = setup({ user: admin(), users: [existing] });
  const { res } = await call("saveStaffLogin", { role: "production", email: "new-line@eximburg.test", password: "new-line-pass" });
  assert.equal(res.status, 200);
  assert.equal(identity.map.get("prod1").email, "new-line@eximburg.test");
  assert.equal(identity.map.get("prod1").password, "new-line-pass");
  assert.equal(identity.map.size, 1);
});

test("syncProfiles reads every page of users", async () => {
  const users = Array.from({ length: 230 }, (_, i) => netlifyUser("u" + i, ["user"]));
  const { call, db } = setup({ user: admin(), users });
  const { body } = await call("syncProfiles", {});
  assert.equal(body.seen, 230);
  assert.equal(body.created, 230);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("profiles/")).length, 230);
});
