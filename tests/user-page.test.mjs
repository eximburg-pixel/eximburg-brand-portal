import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const page = read("user.html");
const data = read("js/src/portal-data.js");
const bundle = read("js/dist/portal-data.js");
const build = read("scripts/build-auth.mjs");
const toml = read("netlify.toml");

const count = (text, needle) => text.split(needle).length - 1;
const mainScript = () => {
  const start = page.indexOf("   EXIMBURG CONFIG");
  const open = page.lastIndexOf("<script>", start);
  const close = page.indexOf("</script>", start);
  return page.slice(open + "<script>".length, close);
};

test("the page is the customer page, with a placeholder and the guard last", () => {
  assert.match(page, /<body data-portal="user">/);
  assert.match(page, /Opening your dashboard/);
  const guard = page.indexOf('<script type="module" src="js/dist/guard.js"></script>');
  assert.ok(guard > page.indexOf("window.startPortal"), "guard tag comes after startPortal is defined");
  assert.ok(page.indexOf("</body>") > guard);
});

test("scripts load in the right order: QR library, data layer (plain scripts), then the page script", () => {
  const qr = page.indexOf('<script src="js/vendor/qrcode.min.js"></script>');
  const dl = page.indexOf('<script src="js/dist/portal-data.js"></script>');
  const use = page.indexOf("const DBX = window.ExbDB");
  assert.ok(qr > 0 && dl > qr && use > dl, "order: qrcode, portal-data, page script");
  assert.ok(!/type="module"[^>]*portal-data/.test(page));
  assert.ok(!/type="module"[^>]*track\.js/.test(page), "the tracker is inside the data bundle, not a second bundle");
});

test("no old backend, demo mode, own sign-in card or third-party script is left", () => {
  for (const word of ["supabase", "renderLogin", "EXB_CONFIG", "config.js", "signUp(", "signIn(", "authMode", "admin.html", "DB.mode", "demoImpl"]) {
    assert.ok(!page.includes(word), `still contains ${word}`);
  }
  assert.ok(!/<script[^>]+src="https?:/.test(page), "no script loaded from another website");
  assert.ok(!/class="demopill"/.test(page), "no demo pill");
});

test("the main page script is valid JavaScript", () => {
  assert.doesNotThrow(() => new vm.Script(mainScript(), { filename: "user.html" }));
});

test("signed-out visitors are sent to home.html, never shown a login", () => {
  assert.match(page, /if\(!S\.user\)\{[^}]*location\.replace\("home\.html"\)/);
});

test("the sidebar still lists the 15 sections in the agreed order", () => {
  const ids = [...mainScript().matchAll(/\{id:"(\w+)", en:/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["home", "what", "market", "future", "target", "about", "brands", "benefits", "launchpad", "profit", "influencer", "process", "mindset", "book", "orders"]);
});

test("every analytics hook from the gap analysis is attached", () => {
  const src = mainScript();
  for (const hook of [
    'exbTrack.page(from, id, trackMeta())',
    'exbTrack.start(S.user, S.current, trackMeta())',
    'exbTrack.leave("logout", trackMeta())',
    'exbTrack.booking(',
    'exbTrack.event("quick_plan"',
    'exbTrack.event("mind_answer"',
    'exbTrack.event("call_request"',
    'exbTrack.event("lang"',
    'exbTrack.event("nav"',
    'exbTrack.event("faq"',
    'exbTrack.event("select"',
    'exbTrack.event("action"'
  ]) assert.ok(src.includes(hook), `missing ${hook}`);
  for (const field of ["name", "phone", "confirm"]) assert.ok(src.includes(`exbTrack.event("booking_error", { field:"${field}" })`), `booking_error ${field}`);
  for (const reason of ["quick_plan", "input", "hero", "mrp", "selling_cost", "reorders", "mind_answer", "booking", "call_request", "session", "view"]) {
    assert.ok(src.includes(`planSnapshot(`) && new RegExp(`planSnapshot\\([^)]*"${reason}"`).test(src), `planSnapshot reason ${reason}`);
  }
});

test("each event has one source: logEv is a no-op and the old logging calls are gone", () => {
  const src = mainScript();
  assert.match(src, /function logEv\(\)\{ \/\*/);
  assert.ok(!src.includes("DB.log("), "the page no longer logs through the data layer");
  assert.ok(!src.includes('logEv("section_view"'));
  assert.ok(!/logEv\("[a-z_]+"/.test(src), "no leftover logEv(...) call");
  assert.equal(count(src, 'exbTrack.event("call_request"'), 1, "call_request is recorded once");
});

test("logout records the exit first, then signs out of Netlify and Firebase through the data layer", () => {
  const src = mainScript();
  const at = src.indexOf('if(act==="logout")');
  const line = src.slice(at, src.indexOf("\n", at));
  assert.ok(line.indexOf("exbTrack.leave") < line.indexOf("DB.signOut()"));
  assert.match(data, /async signOut\(\)[\s\S]*portalLogout/);
});

test("everything the page asks of the data layer exists there", () => {
  const src = mainScript();
  const dbCalls = [...new Set([...src.matchAll(/\bDB\.([a-zA-Z]+)\(/g)].map((m) => m[1]))];
  assert.ok(dbCalls.length >= 8, "found the DB calls");
  for (const name of dbCalls) assert.ok(new RegExp(`(^|\\s)(async\\s+)?${name}\\s*\\(|\\b${name}:`, "m").test(data), `data layer lacks DB.${name}`);
  const dbxCalls = [...new Set([...src.matchAll(/\bDBX\.([a-zA-Z]+)/g)].map((m) => m[1]))];
  const exported = data.slice(data.indexOf("window.ExbDB = {"));
  for (const name of dbxCalls) assert.ok(new RegExp(`\\b${name}\\b`).test(exported), `window.ExbDB lacks ${name}`);
});

test("customers get slot numbers, settings and their own orders only; staff-only sources are not requested for them", () => {
  const body = data.slice(data.indexOf("function sourcesFor"), data.indexOf("/* ---------- the data layer"));
  const open = body.indexOf('if (role === "user") {');
  const gate = body.indexOf("return sources;", open);
  assert.ok(open > 0 && gate > open, "customer gate exists and returns before any staff source");
  assert.ok(body.slice(open, gate).includes("sources.mine = mineSource(uid)"), "the gate adds only the customer's own orders");
  for (const staffOnly of ["sources.profiles", "sources.events", "sources.payments", "sources.updates", "sources.production_orders"]) {
    assert.ok(body.indexOf(staffOnly) > gate, `${staffOnly} comes after the customer gate`);
  }
});

test("booking, payment and file links are connected to the real order system", () => {
  assert.doesNotMatch(data, /async bookSlot\(\) \{ await later\(\); \}/);
  assert.match(data, /callApi\("bookSlot"/);
  assert.match(data, /callApi\("submitPayment"/);
  assert.match(data, /slipUrl: async/);
  assert.match(data, /docUrl: async/);
  assert.doesNotMatch(data, /slipUrl: later|docUrl: later/);
});

test("booking sends only what the customer typed; the server decides price, fees, slot and hold", () => {
  const call = data.slice(data.indexOf('callApi("bookSlot"'), data.indexOf("const booking = {"));
  for (const typed of ["name", "phone", "brand", "city", "gstin", "call_time", "packs", "flavours"]) assert.match(call, new RegExp("\\b" + typed + ":"), typed);
  for (const decided of ["price", "order_value", "approval_fee", "offer", "slot_no", "slot_month", "stage", "hold_until", "user_id"]) {
    assert.ok(!new RegExp("\\b" + decided + ":").test(call), `${decided} is never sent by the browser`);
  }
});

test("a payment slip is uploaded first and only its stored path is sent with the payment", () => {
  const body = data.slice(data.indexOf("async submitPayment"), data.indexOf("async staffData"));
  assert.ok(body.indexOf("uploadSlip(") > -1 && body.indexOf("uploadSlip(") < body.indexOf('callApi("submitPayment"'), "upload comes first");
  assert.match(body, /slip_path: path/);
  assert.doesNotMatch(body, /base64|FileReader|readAsDataURL/, "files travel as raw bytes");
});

test("a customer listens to their own orders and the public slot board, and nothing staff-only", () => {
  const sources = data.slice(data.indexOf("function sourcesFor"), data.indexOf("/* ---------- the data layer"));
  const customer = sources.slice(sources.indexOf('if (role === "user")'), sources.indexOf('if (role === "production")'));
  assert.match(customer, /sources\.mine = mineSource\(uid\)/);
  assert.match(customer, /return sources/);
  const mine = data.slice(data.indexOf("function mineSource"), data.indexOf("function sourcesFor"));
  assert.match(mine, /where\("user_id", "==", uid\)/g);
  assert.equal((mine.match(/where\("user_id", "==", uid\)/g) || []).length, 2, "bookings and payments are both limited to this customer");
  assert.ok(!/collectionGroup/.test(mine), "never the staff-only collection group of updates");
});

test("every data-layer method the customer page calls exists", () => {
  const used = [...new Set([...page.matchAll(/\bDB\.(\w+)\(/g)].map((m) => m[1]))];
  assert.ok(used.length >= 8, "the page really calls the data layer");
  for (const name of used) assert.match(data, new RegExp(`\\b(async )?${name}\\(|${name}:`), name);
});

test("the tracker is bundled with the data layer, so a page has one Firebase connection", () => {
  assert.match(data, /import "\.\/track\.js";/);
  assert.match(bundle, /exbTrack/);
  assert.ok(!/js\/src\/track\.js/.test(build.slice(build.indexOf("entryPoints"), build.indexOf("format"))), "track.js is not a separate entry point");
  assert.ok(!existsSync(new URL("../js/dist/track.js", import.meta.url)), "no stale second tracker bundle");
  assert.ok(!toml.includes("js/dist/track.js"), "no stale secret-scan exception");
});

test("the QR library is hosted here, unchanged from the pinned cdnjs 1.0.0 file", () => {
  const sum = createHash("sha256").update(readFileSync(new URL("../js/vendor/qrcode.min.js", import.meta.url))).digest("hex").toUpperCase();
  assert.equal(sum, "C541EF06327885A8415BCA8DF6071E14189B4855336DEF4F36DB54BDE8484F36");
});

test("customers see the approval fee where they agree to the payment terms", () => {
  assert.match(page, /40% plus the one-time government approval fee \(\$\{inr\(s\.approval\)\}\)/);
  assert.match(page, /40% और एक बार की सरकारी अप्रूवल फीस \(\$\{inr\(s\.approval\)\}\)/);
  assert.match(page, /Paid together with the approval fee in the next row/);
});

test("Docs/user.html (Claude's original) is kept untouched as the reference", () => {
  const docs = read("Docs/user.html");
  assert.ok(docs.includes("renderLogin"), "the reference copy still has its original sign-in card");
});
