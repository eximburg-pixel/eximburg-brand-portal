/*
  The real tracker (js/src/track.js) against in-memory Firestore.
  Proves: 14-step schema, 60 s heartbeat, staff write nothing, signup/login/section views land
  as the names the Admin Overview already draws.
*/
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { funnelFrom } from "../shared/portal-insights.js";
import { mapEvent } from "../shared/portal-mappers.js";
import { HEARTBEAT_MS, STEP_NO, STEP_SCHEMA } from "../shared/portal-steps.js";
import { fakeFirestore } from "./helpers/fake-firestore.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const bundled = await build({
  entryPoints: [here("../js/src/track.js")],
  bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent",
  plugins: [{
    name: "fakes",
    setup(b) {
      b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: here("./helpers/browser-firestore.mjs") }));
      b.onResolve({ filter: /firebase-session\.js$/ }, () => ({ path: here("./helpers/browser-session.mjs") }));
    }
  }]
});
const CODE = bundled.outputFiles[0].text;

function world({ role = "user", loginId = "EXB-asha", uid = "cust1" } = {}) {
  const db = fakeFirestore();
  const store = {};
  const timers = [];
  const fake = { db, uid, appRole: role, listeners: new Set(), queried: [] };
  const sandbox = {
    __FAKE__: fake,
    console,
    Date,
    Math,
    JSON,
    Promise,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval() {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    crypto: globalThis.crypto,
    queueMicrotask,
    document: { hidden: false, addEventListener() {} },
    navigator: { userAgent: "test" },
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    fetch: async () => ({ ok: true })
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  return { db, sandbox, timers, start: (extra) => sandbox.exbTrack.start({ loginId, name: "Asha", city: "Surat", brand: "Urban Leaf", role, email: "a@x" }, extra && extra.step || "home", extra) };
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

test("the heartbeat is 60 seconds and new rows carry the live step schema", async () => {
  const w = world();
  w.start();
  await flush();
  assert.equal(w.timers[0].ms, HEARTBEAT_MS);
  const events = w.db.list("events");
  assert.ok(events.length >= 2);
  assert.ok(events.every((e) => e.stepSchema === STEP_SCHEMA));
  assert.equal(STEP_NO.orders, 14);
});

test("staff logins write nothing", async () => {
  const w = world({ role: "admin", uid: "admin1" });
  w.start();
  await flush();
  assert.equal(w.db.list("events").length, 0);
  assert.equal(w.db.list("sessions").length, 0);
});

test("a first visit writes signup and login; section clicks become the funnel the Overview draws", async () => {
  const w = world();
  w.start({ step: "home" });
  await flush();
  w.sandbox.exbTrack.page("home", "launchpad", {});
  await flush();
  w.sandbox.exbTrack.page("launchpad", "book", {});
  await flush();
  w.sandbox.exbTrack.calc("launchpad", "input", { totalPacks: 7000, flavourCount: 1 }, { orderValue: 630000 });
  await flush();

  const raw = w.db.list("events");
  const types = raw.map((e) => e.type);
  assert.ok(types.includes("session_start"));
  assert.ok(types.includes("login"));
  assert.ok(types.includes("signup"));
  assert.ok(types.includes("page_view"));
  assert.ok(types.includes("plan_change"));
  const signup = raw.find((e) => e.type === "signup");
  assert.equal(signup.city, "Surat");
  assert.equal(signup.brand, "Urban Leaf");
  assert.equal(signup.stepNo, STEP_NO.home);

  const events = raw.map((e, i) => mapEvent(e.id || "e" + i, e, { "EXB-asha": "cust1" }));
  assert.ok(events.some((e) => e.type === "visit"));
  assert.ok(events.some((e) => e.type === "section_view" && e.meta.id === "launchpad"));
  assert.ok(events.some((e) => e.type === "section_view" && e.meta.id === "book"));
  const live = events.filter((e) => e.type === "section_view").map((e) => e.meta.id);
  assert.ok(live.includes("launchpad") && live.includes("book"));

  const customers = [{ id: "cust1", created_at: new Date().toISOString(), role: "customer" }];
  const P = {
    cust1: {
      sections: new Set(events.filter((e) => e.type === "section_view").map((e) => e.meta.id)),
      plan: events.find((e) => e.type === "plan_change") ? { packs: 7000 } : null,
      bk: []
    }
  };
  const funnel = funnelFrom({ events, customers, P });
  assert.deepEqual(funnel.steps, [
    ["Visitors", 1],
    ["Created account", 1],
    ["Planned a batch", 1],
    ["Opened booking", 1],
    ["Booked a slot", 0],
    ["Uploaded slip", 0],
    ["Payment verified", 0]
  ]);
});
