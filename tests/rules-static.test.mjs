import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
  These are text-level safety checks on the rules and the tracker.
  They do NOT replace running the rules in the Firestore emulator (Phase 8, needs Java).
  They catch the dangerous mistakes that are easy to make when editing.
*/
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const tracker = readFileSync(new URL("../js/src/track.js", import.meta.url), "utf8");

function block(name) {
  const start = rules.indexOf(`match /${name}/`);
  assert.ok(start >= 0, `rules for ${name} exist`);
  const next = rules.indexOf("\n    match /", start + 1);
  return rules.slice(start, next === -1 ? undefined : next);
}

test("nothing is open to everyone", () => {
  assert.ok(!/if\s+true\b/.test(rules), "no 'if true'");
  assert.ok(!/allow[^:]*:\s*if\s+request\.auth\s*==\s*null/.test(rules));
});

test("every rule that allows access has a condition", () => {
  for (const line of rules.split("\n")) {
    if (/\ballow\b/.test(line) && !/if\b/.test(line)) assert.fail("allow without a condition: " + line);
  }
});

test("money and orders are never writable from a browser", () => {
  for (const name of ["bookings", "payments", "utr_index", "production_orders", "profiles", "settings", "slot_months", "slot_events"]) {
    assert.match(block(name), /allow write: if false;|allow read, write: if false;/, name);
  }
});

test("Production can read the money-free mirror only", () => {
  assert.match(block("production_orders"), /isStaff\(\)/);
  for (const name of ["bookings", "payments", "profiles", "events", "users", "plans", "sessions", "calculations"]) {
    const b = block(name);
    assert.ok(!/isStaff\(\)/.test(b), `${name} must not use isStaff()`);
  }
});

test("analytics are readable by the office only, and writable only under your own login id", () => {
  for (const name of ["events", "users", "plans", "sessions", "calculations"]) {
    const b = block(name);
    assert.match(b, /allow read: if isOffice\(\);/, name);
    assert.match(b, /ownLogin|telemetry\(\)/, name);
  }
});

test("the role is read from the server-written profile, not from the token", () => {
  assert.match(rules, /get\(profilePath\(\)\)\.data\.role/);
  assert.ok(!/request\.auth\.token\.role/.test(rules));
});

test("the tracker no longer writes to the order collection", () => {
  assert.ok(!/["']bookings["']/.test(tracker), "no write to bookings");
});

test("the tracker never writes before Firebase sign-in", () => {
  assert.match(tracker, /ensureFirebaseSession\(\)/);
  assert.ok(!/initializeApp/.test(tracker), "track.js uses the shared connection");
});
