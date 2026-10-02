import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDb } from "./helpers/fakes.mjs";
import { WARM_PATHS, keepWarm, newToken, warmGate, writeMode } from "../netlify/lib/warm.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("a normal request is left alone, and only the stored token may wake a function", async () => {
  const db = fakeDb();
  const saved = await writeMode(db, "hot", "admin1");
  const getDb = () => db;
  assert.equal(await warmGate(new Request("https://eximburg.test/api/session"), getDb), null);
  const bad = await warmGate(new Request("https://eximburg.test/api/session", { headers: { "x-exb-warm": "nope" } }), getDb);
  assert.equal(bad.status, 401);
  const ok = await warmGate(new Request("https://eximburg.test/api/session", { headers: { "x-exb-warm": saved.token } }), getDb);
  assert.equal(ok.status, 204);
});

test("a hot server wakes every visitor function, and a cold server does not", async () => {
  const db = fakeDb();
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, header: opts.headers["x-exb-warm"] });
    return new Response(null, { status: 204 });
  };
  const first = await keepWarm({ db, fetchImpl, siteUrl: "https://eximburg.test" });
  assert.equal(first.mode, "hot");
  assert.equal(first.ready, true);
  assert.equal(seen.length, WARM_PATHS.length);
  const token = db.store.get("settings/runtime").token;
  assert.ok(seen.every((row) => row.header === token));
  assert.ok(WARM_PATHS.every((path) => seen.some((row) => row.url === "https://eximburg.test" + path)));

  seen.length = 0;
  await writeMode(db, "cold", "admin1");
  const second = await keepWarm({ db, fetchImpl, siteUrl: "https://eximburg.test" });
  assert.equal(second.mode, "cold");
  assert.equal(second.pinged, 0);
  assert.equal(seen.length, 0);
  assert.equal(db.store.get("settings/runtime").token, token);
});

test("staying hot does not replace the wake-up token", async () => {
  const db = fakeDb();
  const fetchImpl = async () => new Response(null, { status: 204 });
  await keepWarm({ db, fetchImpl, siteUrl: "https://eximburg.test" });
  const token = db.store.get("settings/runtime").token;
  await keepWarm({ db, fetchImpl, siteUrl: "https://eximburg.test" });
  assert.equal(db.store.get("settings/runtime").token, token);
  assert.equal(newToken().length, 64);
});

test("every visitor function checks the wake-up before doing real work, on a 4 minute timer", () => {
  const schedule = read("netlify/functions/keep-warm.mts");
  assert.match(schedule, /schedule: "\*\/4 \* \* \* \*"/);
  assert.match(schedule, /keepWarm/);
  for (const file of [
    "netlify/functions/api.mts",
    "netlify/functions/firebase-token.mts",
    "netlify/functions/open-account.mts",
    "netlify/functions/staff-sign-in.mts",
    "netlify/functions/upload.mts",
    "netlify/functions/file.mts"
  ]) {
    const source = read(file);
    const gate = source.indexOf("await warmGate");
    const work = source.slice(gate).search(/return handle|openAccount\(|staffSignIn\(/);
    assert.ok(gate > 0 && work > 0, file);
  }
  const rules = read("firestore.rules");
  const settings = rules.slice(rules.indexOf("match /settings/"), rules.indexOf("match /slot_months/"));
  assert.match(settings, /doc == 'portal'/);
  assert.match(settings, /doc == 'factory'/);
  assert.match(settings, /allow write: if false/);
  assert.ok(!/doc == 'runtime'/.test(settings));
});
