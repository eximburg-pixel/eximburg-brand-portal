import test from "node:test";
import assert from "node:assert/strict";
import { handleSession } from "../netlify/lib/session-endpoint.js";
import { ApiError } from "../netlify/lib/http.js";
import { SERVER_TIME, fakeAuth, fakeDb, makeRequest, netlifyUser, silent, verifyOrigin } from "./helpers/fakes.mjs";

function run({ user, request = makeRequest("/api/session"), db = fakeDb(), auth = fakeAuth(), firebaseError } = {}) {
  const deps = {
    verifyOrigin,
    getUser: async () => user,
    firebase: () => { if (firebaseError) throw firebaseError; return { auth, db, serverTime: () => SERVER_TIME }; },
    log: silent
  };
  return handleSession(request, deps).then(async (res) => ({ res, body: await res.json(), db, auth }));
}

test("signed-out visitors get 401 and no token", async () => {
  const { res, body, auth } = await run({ user: null });
  assert.equal(res.status, 401);
  assert.equal(body.ok, false);
  assert.equal(auth.calls.tokens.length, 0);
});

test("only POST is accepted", async () => {
  const { res } = await run({ user: netlifyUser("u1"), request: makeRequest("/api/session", { method: "GET" }) });
  assert.equal(res.status, 405);
});

test("a request from another website is refused", async () => {
  const { res, auth } = await run({ user: netlifyUser("u1"), request: makeRequest("/api/session", { origin: "https://evil.example" }) });
  assert.equal(res.status, 403);
  assert.equal(auth.calls.tokens.length, 0);
});

test("a request with no Origin header is refused", async () => {
  const { res } = await run({ user: netlifyUser("u1"), request: makeRequest("/api/session", { origin: null }) });
  assert.equal(res.status, 403);
});

test("a customer gets a token with role customer, and a new profile", async () => {
  const { res, body, db, auth } = await run({ user: netlifyUser("u1", ["user"]) });
  assert.equal(res.status, 200);
  assert.equal(body.token, "token-for-u1");
  assert.equal(body.role, "customer");
  assert.equal(body.appRole, "user");
  assert.deepEqual(auth.calls.tokens, [{ uid: "u1", claims: { role: "customer", login_id: "EXB-u1" } }]);
  const profile = db.store.get("profiles/u1");
  assert.equal(profile.role, "customer");
  assert.equal(profile.name, "Person u1");
  assert.equal(profile.phone, "9876543210");
  assert.equal(profile.login_id, "EXB-u1");
  assert.ok(profile.created_at instanceof Date);
});

test("each Netlify role maps to the right Firebase role", async () => {
  for (const [netlify, expected] of [["Admin", "admin"], ["Production", "production"], ["Account", "accounts"], ["user", "customer"]]) {
    const { body } = await run({ user: netlifyUser("u2", [netlify]) });
    assert.equal(body.role, expected, netlify);
  }
});

test("an unknown role such as the old 'sales' gets no staff access", async () => {
  const { body } = await run({ user: netlifyUser("u3", ["sales"]) });
  assert.equal(body.role, "customer");
});

test("the token is never given the browser's idea of the role: it comes from Netlify only", async () => {
  const request = makeRequest("/api/session", { body: { role: "admin" } });
  const { body } = await run({ user: netlifyUser("u4", ["user"]), request });
  assert.equal(body.role, "customer");
});

test("an existing profile is not rewritten when nothing changed", async () => {
  const db = fakeDb({ "profiles/u1": { name: "Old", role: "customer", phone: "1" } });
  const { body } = await run({ user: netlifyUser("u1", ["user"]), db });
  assert.equal(body.ok, true);
  assert.equal(db.writes.length, 0);
  assert.equal(db.store.get("profiles/u1").name, "Old");
});

test("a profile whose role is out of date is corrected from Netlify", async () => {
  const db = fakeDb({ "profiles/u1": { name: "Old", role: "customer" } });
  const { body } = await run({ user: netlifyUser("u1", ["Production"]), db });
  assert.equal(body.role, "production");
  assert.equal(db.store.get("profiles/u1").role, "production");
  assert.equal(db.store.get("profiles/u1").name, "Old");
});

test("missing Firebase key: customers see a calm message, Admin sees the reason", async () => {
  const error = new ApiError(503, "server_config", "The portal is still being set up. Please try again later.", "FIREBASE_SERVICE_ACCOUNT is not set in Netlify (or is empty).");
  const asCustomer = await run({ user: netlifyUser("u1", ["user"]), firebaseError: error });
  assert.equal(asCustomer.res.status, 503);
  assert.equal(asCustomer.body.error.detail, undefined);
  const asAdmin = await run({ user: netlifyUser("a1", ["Admin"]), firebaseError: error });
  assert.match(asAdmin.body.error.detail, /not set/);
});

test("unexpected failures return a generic message, not internals", async () => {
  const logged = [];
  const deps = {
    verifyOrigin,
    getUser: async () => netlifyUser("u1"),
    firebase: () => { throw new Error("secret internal /srv/path detail"); },
    log: (...a) => logged.push(a.join(" "))
  };
  const res = await handleSession(makeRequest("/api/session"), deps);
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error.code, "server_error");
  assert.ok(!JSON.stringify(body).includes("secret internal"));
  assert.equal(logged.length, 1);
});

test("responses are never cached", async () => {
  const { res } = await run({ user: netlifyUser("u1") });
  assert.equal(res.headers.get("cache-control"), "no-store");
});
