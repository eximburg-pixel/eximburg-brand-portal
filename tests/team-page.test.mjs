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
