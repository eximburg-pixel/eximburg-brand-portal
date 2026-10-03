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

test("the team panel stays on the light theme even when the phone is set to dark", () => {
  assert.ok(!/prefers-color-scheme:\s*dark/.test(team));
  assert.match(team, /color-scheme:\s*light/);
  assert.match(team, /--bg:#F4F3EE/);
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
  assert.match(toml, /from = "\/staff"/);
  assert.match(build, /staff-login\.js/);
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

test("Overview draws the funnel and drop-rate from the mapped analytics, not from a second event system", () => {
  const overview = team.slice(team.indexOf("VIEWS.overview"), team.indexOf("function slotRow"));
  assert.match(overview, /DBX\.funnelFrom\(D, Q\.range\)/);
  assert.match(overview, /DBX\.dropRates\(D\.sessions/);
  assert.match(overview, /Where people leave/);
  assert.match(overview, /behaviorCards\(\)/);
  assert.match(overview, /stuckWork\(\)/);
  assert.match(team, /People who leave without booking/);
  assert.match(team, /Biggest leak this week/);
  assert.match(team, /Follow up/);
  assert.match(team, /How long it usually takes/);
  assert.match(team, /Needs attention/);
  assert.match(team, /Holds ending within 6 hours/);
  assert.match(team, /Production and Accounts sign-in/);
  assert.match(team, /DB\.staffLogins\(\)/);
  assert.match(team, /DB\.saveStaffLogin/);
  assert.ok(!/function customerList/.test(team), "the Team page no longer lists every customer");
  assert.ok(!/<h2>Customers<\/h2>/.test(team));
  assert.match(team, /D\.plans/);
  assert.match(team, /DBX\.readinessFromEvents/);
  assert.match(team, /Readiness check/);
  assert.match(team, /\["hot","Hot"\]/);
  assert.match(team, /case "readiness_check"/);
  assert.match(team, /"Sales channel"/);
});

test("the Settings screen offers the two Admin tools and the hot or cold server choice", () => {
  assert.match(team, /id="chk"/);
  assert.match(team, /id="syn"/);
  assert.match(team, /DB\.checkSetup\(\)/);
  assert.match(team, /DB\.syncProfiles\(\)/);
  assert.match(team, /id="server-warmth"/);
  assert.match(team, /id="warm-hot"/);
  assert.match(team, /id="warm-cold"/);
  assert.match(team, /Hot server/);
  assert.match(team, /Cold server/);
  assert.match(team, /DB\.serverMode\(\)/);
  assert.match(team, /DB\.saveServerMode\(mode\)/);
  assert.match(team, /Use it during a campaign/);
});

test("Settings save writes bank, UPI, WhatsApp, GST, offer and testimonial consent for the customer portal", () => {
  assert.match(team, /DB\.saveSettings\(next\)/);
  assert.match(team, /whatsapp:v\("whatsapp"\)/);
  assert.match(team, /gstNote_en:v\("gstNote_en"\)/);
  assert.match(team, /bank:\{accountName/);
  assert.match(team, /upi:\{id:v\("u_id"\)/);
  assert.match(team, /offer:\{enabled/);
  assert.match(team, /data-k="consent"/);
  assert.match(team, /Written permission is on file/);
  assert.match(team, /consent:false/);
  assert.match(team, /Customers with the portal open see the new bank/);
  assert.match(team, /id="qr_file"/);
  assert.match(team, /DB\.uploadPaymentQr\(qrFile\)/);
  assert.match(team, /paymentQr/);
  assert.match(team, /function orderName/);
  assert.match(team, /leadName/);
  assert.match(team, /top:calc\(16px \+ env\(safe-area-inset-top,0px\)\)/);
});

test("label notes and flavour completion are on the production board and the order timeline", () => {
  assert.match(team, /Note from the customer: Customer Brand\/Design Logo, Brand Name, Marketed by Company name, Address, Contact Information/);
  assert.match(team, /Note on customer's design approval - time\/date, mode\./);
  assert.match(team, /data-mfg=/);
  assert.match(team, /data-qcform=/);
  assert.match(team, /DB\.saveFlavourMfg/);
  assert.match(team, /DB\.saveFlavourQc/);
  assert.match(team, /ME\.role!=="admin"/);
  assert.match(team, /Mfg \$\{/);
});

test("the Order timeline uses the shared plan formula, not a second copy of the dates", () => {
  const src = team.slice(team.indexOf("function plan("), team.indexOf("function timelineHTML"));
  assert.match(src, /DBX\.orderPlan\(b, SET\.timeline/);
  assert.doesNotMatch(src, /packsPerDay/);
  assert.match(team, /const HOLD = DBX\.HOLD_STAGES/);
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

test("the production board keeps its scroll, starts orders collapsed, and shows a busy label while a QC report uploads", () => {
  assert.match(team, /boardLeft/);
  assert.match(team, /nextBoard\.scrollLeft = boardLeft/);
  assert.match(team, /nextSide\.scrollLeft = sideLeft/);
  assert.match(team, /max-height:52px/);
  assert.match(team, /\.tabs button\{width:auto/);
  assert.match(team, /data-jobtog=/);
  assert.match(team, /jobbody" \$\{open\?"":"hidden"\}/);
  assert.match(team, /\.jobhead \.jobmeta\{display:none\}/);
  assert.match(team, /\.jobhead \.jobmore\{display:block/);
  assert.match(team, /OPEN_JOBS/);
  assert.match(team, /pickingFile/);
  assert.match(team, /Uploading report…/);
  assert.match(team, /usageCards\(\)/);
  assert.match(team, /DBX\.repeatVisitors/);
  assert.match(team, /DBX\.orderTimingSummary/);
  assert.match(team, /flex:0 0 280px/);
});

test("a failed connection offers Reload as well as Sign out", () => {
  assert.match(team, /id="retry"/);
  assert.match(team, /location\.reload\(\)/);
  assert.match(team, /id="so"/);
});
