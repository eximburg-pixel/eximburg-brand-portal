import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../home.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../js/src/home.js", import.meta.url), "utf8");

test("the sign-up form asks for a brand name that can be given later", () => {
  assert.match(home, /Your Brand name\. You can inform later\. \(optional\)/);
  assert.doesNotMatch(home, /Brand name you have in mind/);
});

test("sign-up opens the dashboard and emails a password link, without the confirmation password page", () => {
  assert.match(home, /Your dashboard opens now/);
  assert.match(script, /\/api\/open-account/);
  assert.match(script, /requestPasswordRecovery\(email\)/);
  assert.match(script, /enterDashboard\(user\)/);
  assert.doesNotMatch(script, /await signup\(/);
  const signup = script.slice(script.indexOf('getElementById("signup-form").addEventListener'), script.indexOf('getElementById("signin-form").addEventListener'));
  assert.doesNotMatch(signup, /logout\(/);
});

test("the home sign-in form is for customers; staff are sent to the team sign-in page", () => {
  assert.match(script, /isStaff\(roleOf\(user\)\)/);
  assert.match(script, /staff\.html/);
  assert.doesNotMatch(home, /staff\.html/);
});
