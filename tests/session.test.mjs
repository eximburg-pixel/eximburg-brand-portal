import test from "node:test";
import assert from "node:assert/strict";
import { dashboardFor, isStaff, normalizeRole, pageForRole, profileFrom, roleOf } from "../js/src/session.js";

const withRoles = (...roles) => ({ id: "u1", email: "a@b.co", roles });

test("exact Netlify role names map to app roles", () => {
  assert.equal(roleOf(withRoles("user")), "user");
  assert.equal(roleOf(withRoles("Admin")), "admin");
  assert.equal(roleOf(withRoles("Production")), "production");
  assert.equal(roleOf(withRoles("Account")), "accounts");
});

test("capital letters and spaces do not matter", () => {
  assert.equal(roleOf(withRoles("ADMIN")), "admin");
  assert.equal(roleOf(withRoles("admin")), "admin");
  assert.equal(roleOf(withRoles(" production ")), "production");
  assert.equal(roleOf(withRoles("account")), "accounts");
  assert.equal(roleOf(withRoles("Accounts")), "accounts");
});

test("no roles, empty roles, or missing user give a plain user", () => {
  assert.equal(roleOf({ id: "u1" }), "user");
  assert.equal(roleOf({ id: "u1", roles: [] }), "user");
  assert.equal(roleOf(null), "user");
  assert.equal(roleOf(undefined), "user");
});

test("unknown role names get no staff access (old 'sales' included)", () => {
  assert.equal(roleOf(withRoles("sales")), "user");
  assert.equal(roleOf(withRoles("Sales")), "user");
  assert.equal(roleOf(withRoles("superuser")), "user");
  assert.equal(roleOf(withRoles("")), "user");
  assert.equal(roleOf(withRoles(null, undefined, 5)), "user");
});

test("someone with several roles gets the strongest staff role", () => {
  assert.equal(roleOf(withRoles("user", "Production", "Admin")), "admin");
  assert.equal(roleOf(withRoles("Production", "Account")), "accounts");
  assert.equal(roleOf(withRoles("user", "Production")), "production");
});

test("roles are also read from appMetadata and the single role field", () => {
  assert.equal(roleOf({ appMetadata: { roles: ["Admin"] } }), "admin");
  assert.equal(roleOf({ role: "Production" }), "production");
});

test("a malformed roles value does not crash or grant access", () => {
  assert.equal(roleOf({ roles: "Admin" }), "user");
  assert.equal(roleOf({ roles: { 0: "Admin" } }), "user");
});

test("each role opens the right page", () => {
  assert.equal(dashboardFor(withRoles("user")), "user.html");
  assert.equal(dashboardFor({ id: "x" }), "user.html");
  assert.equal(dashboardFor(withRoles("Admin")), "team.html");
  assert.equal(dashboardFor(withRoles("Production")), "team.html");
  assert.equal(dashboardFor(withRoles("Account")), "team.html");
  assert.equal(pageForRole("user"), "user");
  assert.equal(pageForRole("accounts"), "team");
});

test("isStaff and normalizeRole", () => {
  assert.equal(isStaff("admin"), true);
  assert.equal(isStaff("accounts"), true);
  assert.equal(isStaff("production"), true);
  assert.equal(isStaff("user"), false);
  assert.equal(isStaff("Admin"), false); // app roles are already normalised
  assert.equal(normalizeRole(undefined), "");
});

test("profileFrom carries the user id and the normalised role", () => {
  const p = profileFrom({ id: "abc", email: "Staff@Eximburg.in", roles: ["Account"], userMetadata: { full_name: "Ravi", phone: "9876543210" } });
  assert.equal(p.id, "abc");
  assert.equal(p.role, "accounts");
  assert.equal(p.name, "Ravi");
  assert.equal(p.company, "");
  assert.equal(p.phone, "9876543210");
  assert.equal(profileFrom({ userMetadata: { company: "Acme Traders", full_name: "Ravi" } }).company, "Acme Traders");
  assert.match(p.loginId, /^EXB-/);
});
