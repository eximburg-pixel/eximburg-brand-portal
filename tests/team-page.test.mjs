import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const team = read("team.html");
const rules = read("firestore.rules");
const toml = read("netlify.toml");
const build = read("scripts/build-auth.mjs");

test("team.html loads the data layer as a plain script BEFORE the panel script reads window.ExbDB", () => {
  const data = team.indexOf('<script src="js/dist/portal-data.js"></script>');
  const panel = team.indexOf("const DBX = window.ExbDB");
  assert.ok(data > 0, "portal-data.js tag exists");
  assert.ok(panel > data, "panel script comes after the data layer");
  assert.ok(!/type="module"[^>]*portal-data/.test(team), "must not be a deferred module");
});

test("team.html guard comes last and the page is marked as the team page", () => {
  assert.match(team, /<body[^>]*data-portal="team"/);
  assert.ok(team.indexOf("js/dist/guard.js") > team.indexOf("window.startPortal"));
});

test("the placeholder data layer and old backends are gone from team.html", () => {
  for (const word of ["pendingImpl", "supabase", "demoImpl", "EXB_CONFIG", "temporary placeholder"]) {
    assert.ok(!new RegExp(word, "i").test(team), word);
  }
});

test("the data layer is built as a plain (iife) script, and is exempt from the secret scan (it holds the public web key)", () => {
  assert.match(build, /portal-data\.js[\s\S]*format: "iife"/);
  assert.match(toml, /js\/dist\/portal-data\.js/);
  assert.match(toml, /js\/dist\/portal-data\.js\.map/);
});

test("the built bundle exists and sets window.ExbDB", () => {
  assert.ok(existsSync(new URL("../js/dist/portal-data.js", import.meta.url)), "run npm run build");
  assert.match(read("js/dist/portal-data.js"), /ExbDB/);
});

test("the all-orders updates query is office-only", () => {
  const at = rules.indexOf("match /{path=**}/updates/{updateId}");
  assert.ok(at > 0, "collection-group rule exists");
  const body = rules.slice(at, rules.indexOf("\n    }", at) + 6);
  assert.match(body, /allow read: if isOffice\(\);/);
  assert.ok(!/isStaff\(\)/.test(body), "Production must not read order updates");
  assert.ok(!/write/.test(body));
});

test("the Settings screen offers the two Admin tools", () => {
  assert.match(team, /id="chk"/);
  assert.match(team, /id="syn"/);
  assert.match(team, /DB\.checkSetup\(\)/);
  assert.match(team, /DB\.syncProfiles\(\)/);
});

test("the Production board and Order timeline read the money-free factory list, including for Admin", () => {
  assert.match(team, /function factoryOrders\(/);
  assert.match(team, /function boardOrders\(\)/);
  assert.match(team, /PRODVIEW \? factoryOrders\(\) : D\.bookings/);
  const prod = team.slice(team.indexOf("VIEWS.production"), team.indexOf("function jobCard"));
  const sched = team.slice(team.indexOf("VIEWS.schedule"), team.indexOf("/* live activity"));
  assert.match(prod, /boardOrders\(\)/);
  assert.match(sched, /boardOrders\(\)/);
  assert.doesNotMatch(prod, /D\.bookings/);
});

test("Production screens in the panel have no rupee signs, percentages, UTRs or slips", () => {
  const chunks = [
    team.slice(team.indexOf("/* production */"), team.indexOf("/* planned vs actual")),
    team.slice(team.indexOf("function prodKpis"), team.indexOf("function plan(")),
    team.slice(team.indexOf("function prodDrawer"), team.indexOf("function wireDrawer")),
    team.slice(team.indexOf("VIEWS.schedule"), team.indexOf("/* live activity"))
  ];
  const text = chunks.join("\n");
  assert.ok(text.length > 400, "production screen source was found");
  assert.doesNotMatch(text, /₹/);
  assert.doesNotMatch(text, /\binr\s*\(/);
  assert.doesNotMatch(text, /\blakh\s*\(/);
  assert.doesNotMatch(text, /\bUTR\b/i);
  assert.doesNotMatch(text, /\bslip\b/i);
  assert.doesNotMatch(text, /order_value|approval_fee|shipping_charge|\.price\b/);
});
