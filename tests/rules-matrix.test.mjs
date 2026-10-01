import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRules, collection, collectionGroup, doc, where } from "./helpers/browser-firestore.mjs";

/*
  Expected client access for every collection, for every role.
  Writes to orders, money, profiles and settings are always server-only (allow write: if false).
  The Firestore emulator (Java) is still the gold-standard run; this matrix is what we can
  prove on this machine, and it is the same table the emulator would execute.
*/
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

function block(name) {
  const start = rules.indexOf(`match /${name}/`);
  assert.ok(start >= 0, `rules for ${name} exist`);
  const next = rules.indexOf("\n    match /", start + 1);
  return rules.slice(start, next === -1 ? undefined : next);
}

const WRITE_FALSE = [
  "bookings", "payments", "utr_index", "production_orders",
  "profiles", "settings", "slot_months", "slot_events"
];

const OFFICE_READ = ["events", "users", "plans", "sessions", "calculations"];
const PUBLIC_SIGNED_IN = ["settings", "slot_months", "slot_events"];

test("every collection the portal uses has a match block", () => {
  for (const name of [
    "profiles", "settings", "slot_months", "slot_events", "bookings",
    "payments", "utr_index", "production_orders",
    "users", "plans", "sessions", "calculations", "events"
  ]) {
    assert.ok(rules.includes(`match /${name}/`), name);
  }
  assert.ok(rules.includes("match /{path=**}/updates/{updateId}"));
  assert.ok(rules.includes("match /updates/{updateId}"));
});

test("money, orders, profiles and settings are never writable from a browser", () => {
  for (const name of WRITE_FALSE) {
    assert.match(block(name), /allow write: if false;|allow read, write: if false;/, name);
  }
});

test("utr_index is invisible: no client read or write", () => {
  assert.match(block("utr_index"), /allow read, write: if false;/);
});

test("signed-in people may read the public slot board and settings; nobody else can", () => {
  for (const name of PUBLIC_SIGNED_IN) {
    assert.match(block(name), /allow read: if signedIn\(\);/, name);
    assert.match(block(name), /allow write: if false;/, name);
  }
});

test("a customer may read only their own bookings, payments and profile", () => {
  assert.match(block("bookings"), /resource\.data\.user_id == request\.auth\.uid \|\| isOffice\(\)/);
  assert.match(block("payments"), /resource\.data\.user_id == request\.auth\.uid \|\| isOffice\(\)/);
  assert.match(block("profiles"), /request\.auth\.uid == uid \|\| isOffice\(\)/);
});

test("Production is isStaff on production_orders only; office collections use isOffice", () => {
  assert.match(block("production_orders"), /allow read: if isStaff\(\);/);
  for (const name of OFFICE_READ) {
    assert.match(block(name), /allow read: if isOffice\(\);/, name);
    assert.ok(!/isStaff\(\)/.test(block(name)), name);
  }
  for (const name of ["bookings", "payments", "profiles"]) {
    assert.ok(!/isStaff\(\)/.test(block(name)), name);
  }
});

test("analytics creates are own-login only; deletes are off", () => {
  for (const name of OFFICE_READ) {
    assert.match(block(name), /allow delete: if false;|allow update, delete: if false;/, name);
    assert.match(block(name), /ownLogin|telemetry\(\)/, name);
  }
});

test("the role comes from the server-written profile, never from the token", () => {
  assert.match(rules, /get\(profilePath\(\)\)\.data\.role/);
  assert.ok(!/request\.auth\.token\.role/.test(rules));
  assert.match(rules, /function isOffice\(\) \{\s*return role\(\) in \['admin', 'accounts'\];/);
  assert.match(rules, /function isStaff\(\) \{\s*return role\(\) in \['admin', 'accounts', 'production'\];/);
});

const UID = { user: "cust1", production: "prod1", accounts: "acct1", admin: "admin1" };

function asRole(role) {
  const uid = UID[role];
  globalThis.__FAKE__ = {
    uid, appRole: role,
    db: {
      read: (path) => (path === "bookings/bk1" ? { user_id: "cust1" } : { user_id: "someone-else" })
    }
  };
  return uid;
}

function allows(target, constraints = []) {
  try { checkRules(target, constraints); return true; } catch { return false; }
}

const db = {};

function readsFor(uid) {
  const own = [where("user_id", "==", uid)];
  return [
    ["settings/portal", doc(db, "settings", "portal"), []],
    ["slot_months/x", doc(db, "slot_months", "2026-10"), []],
    ["slot_events", collection(db, "slot_events"), []],
    ["own profile", doc(db, "profiles", uid), []],
    ["other profile", doc(db, "profiles", "other"), []],
    ["own bookings", collection(db, "bookings"), own],
    ["all bookings", collection(db, "bookings"), []],
    ["own payments", collection(db, "payments"), own],
    ["all payments", collection(db, "payments"), []],
    ["customer booking updates", collection(db, "bookings", "bk1", "updates"), []],
    ["other booking updates", collection(db, "bookings", "other", "updates"), []],
    ["updates group", collectionGroup(db, "updates"), []],
    ["production_orders", collection(db, "production_orders"), []],
    ["events", collection(db, "events"), []],
    ["sessions", collection(db, "sessions"), []],
    ["plans", collection(db, "plans"), []],
    ["users", collection(db, "users"), []],
    ["profiles list", collection(db, "profiles"), []]
  ];
}

/*
  app roles: user = customer, production, accounts, admin.
  Cells: what the browser data layer is allowed to query (the same decision the rules make).
  "customer booking updates" is the customer's order history — Production must not see it.
*/
const ALLOW = {
  user: {
    "settings/portal": true, "slot_months/x": true, "slot_events": true,
    "own profile": true, "other profile": false,
    "own bookings": true, "all bookings": false,
    "own payments": true, "all payments": false,
    "customer booking updates": true, "other booking updates": false, "updates group": false,
    "production_orders": false,
    "events": false, "sessions": false, "plans": false, "users": false, "profiles list": false
  },
  production: {
    "settings/portal": true, "slot_months/x": true, "slot_events": true,
    "own profile": true, "other profile": false,
    "own bookings": false, "all bookings": false,
    "own payments": false, "all payments": false,
    "customer booking updates": false, "other booking updates": false, "updates group": false,
    "production_orders": true,
    "events": false, "sessions": false, "plans": false, "users": false, "profiles list": false
  },
  accounts: {
    "settings/portal": true, "slot_months/x": true, "slot_events": true,
    "own profile": true, "other profile": true,
    "own bookings": true, "all bookings": true,
    "own payments": true, "all payments": true,
    "customer booking updates": true, "other booking updates": true, "updates group": true,
    "production_orders": true,
    "events": true, "sessions": true, "plans": true, "users": true, "profiles list": true
  },
  admin: {
    "settings/portal": true, "slot_months/x": true, "slot_events": true,
    "own profile": true, "other profile": true,
    "own bookings": true, "all bookings": true,
    "own payments": true, "all payments": true,
    "customer booking updates": true, "other booking updates": true, "updates group": true,
    "production_orders": true,
    "events": true, "sessions": true, "plans": true, "users": true, "profiles list": true
  }
};

for (const role of Object.keys(ALLOW)) {
  test(`read matrix: ${role}`, () => {
    const uid = asRole(role);
    for (const [label, target, constraints] of readsFor(uid)) {
      assert.equal(allows(target, constraints), ALLOW[role][label], `${role} ${label}`);
    }
  });
}

test("Accounts and Admin have the same client read rights; Production does not", () => {
  assert.deepEqual(ALLOW.accounts, ALLOW.admin);
  assert.notEqual(ALLOW.production.production_orders, ALLOW.user.production_orders);
  assert.equal(ALLOW.production["all bookings"], false);
  assert.equal(ALLOW.production.events, false);
});
