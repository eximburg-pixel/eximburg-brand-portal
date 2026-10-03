import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as rules from "../shared/portal-rules.js";
import * as settings from "../shared/portal-settings.js";
import * as readiness from "../shared/portal-readiness.js";
import { toHinglish } from "../shared/hinglish.js";

function element() {
  return {
    innerHTML: "",
    textContent: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
  };
}

function loadCustomerPage() {
  const html = fs.readFileSync(new URL("../user.html", import.meta.url), "utf8");
  const start = html.indexOf("const CONFIG = {");
  const end = html.indexOf("</script>", start);
  const code = html.slice(start, end).replace(
    'root.addEventListener("click"',
    "window.__probe = { summary, applyDeal, applySettings, setFlavourCount, offerInner, VIEWS, S };\nroot.addEventListener(\"click\""
  );
  const root = element();
  const sandbox = {
    console,
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      visibilityState: "hidden",
      body: element(),
      addEventListener() {},
      getElementById(id) { return id === "root" ? root : null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    ExbDB: {
      ...rules,
      ...settings,
      ...readiness,
      toHinglish,
      monthKey: (date = new Date()) => rules.monthKeyIST(date),
      create() {
        return { init() {}, getSettings() {}, myProfile() {}, subscribe() {}, signOut() {} };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.ExbDB = sandbox.ExbDB;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "user.html" });
  const page = sandbox.__probe;
  page.S.user = { name: "Tom", brand: "Tom", company: "", email: "", phone: "9876543210", city: "" };
  return page;
}

const page = loadCustomerPage();

test("Tom's agreed ₹88 for 10,000 packs is what the customer page calculates", () => {
  page.applyDeal({ deal: { price: 88, packs: 10000 } });
  page.setFlavourCount(6);
  const s = page.summary();
  assert.equal(s.p, 88);
  assert.equal(s.packs, 10000);
  assert.equal(s.order, 880000);
  assert.equal(s.approval, 36000);
  assert.equal(s.gstOrder, 44000);
  assert.equal(s.gstApproval, 6480);
  assert.equal(s.invest, 966480);
  assert.equal(s.token, 96648);
  assert.equal(s.pre, 386592);
  assert.equal(s.dispatch, 483240);
  assert.equal(s.token + s.pre + s.dispatch, s.invest);

  const book = page.VIEWS.book();
  assert.match(book, /₹8,80,000/);
  assert.match(book, /₹36,000/);
  assert.match(book, /₹44,000/);
  assert.match(book, /₹6,480/);
  assert.match(book, /₹9,66,480/);
  assert.match(book, /₹96,648/);
  assert.match(book, /₹3,86,592/);
  assert.match(book, /₹4,83,240/);
  assert.doesNotMatch(book, /Volume saving/);

  const home = page.VIEWS.home();
  assert.match(home, /agreed price/);
  assert.match(home, /₹88/);
  assert.doesNotMatch(home, /data-qb=/);

  const launch = page.VIEWS.launchpad();
  assert.doesNotMatch(launch, /id="bud"/);
  assert.match(launch, /Your price is agreed: ₹88 per pack for 10,000 packs/);
  assert.doesNotMatch(page.offerInner(), /data-act="offerup"/);
  assert.match(page.VIEWS.benefits(), /Your agreed price stays ₹88 per pack/);
});

test("one flavour keeps the same pack price and only changes the approval fee", () => {
  page.applyDeal({ deal: { price: 88, packs: 10000 } });
  page.setFlavourCount(1);
  const s = page.summary();
  assert.equal(s.order, 880000);
  assert.equal(s.approval, 6000);
  assert.equal(s.gstOrder, 44000);
  assert.equal(s.gstApproval, 1080);
  assert.equal(s.invest, 931080);
  assert.equal(s.token, 93108);
  assert.equal(s.pre, 372432);
  assert.equal(s.dispatch, 465540);
  assert.equal(s.token + s.pre + s.dispatch, s.invest);
});

test("without an agreed price, 10,000 packs uses the public ₹87 tier", () => {
  page.applyDeal(null);
  page.setFlavourCount(6);
  const s = page.summary();
  assert.equal(s.packs, 10000);
  assert.equal(s.p, 87);
  assert.equal(s.order, 870000);
  assert.match(page.offerInner(), /data-act="offerup"/);
  assert.match(page.VIEWS.benefits(), /Bigger orders also get a lower price per pack/);
});

test("a public GST change updates the plan, and an already booked order keeps its own rates", () => {
  page.applySettings(settings.mergeSettings({
    pricing: {
      tiers: [
        { packs: 0, price: 90 },
        { packs: 9000, price: 87 },
        { packs: 12000, price: 85 },
        { packs: 14000, price: 83 }
      ],
      approvalFeePerFlavour: 6000,
      gstOrderPct: 12,
      gstApprovalPct: 0
    }
  }));
  page.applyDeal({ deal: { price: 88, packs: 10000 } });
  page.setFlavourCount(6);
  const s = page.summary();
  assert.equal(s.gstOrder, 105600);
  assert.equal(s.gstApproval, 0);
  assert.equal(s.invest, 880000 + 36000 + 105600);
  assert.equal(s.token + s.pre + s.dispatch, s.invest);

  const booked = rules.orderTotals(880000, 36000, rules.gstRatesOf({ gst_order_pct: 5, gst_approval_pct: 18 }));
  assert.equal(booked.total, 966480);
  assert.equal(rules.dueAmount({ order_value: 880000, approval_fee: 36000, gst_order_pct: 5, gst_approval_pct: 18 }, "booking10"), 96648);

  page.applySettings(settings.mergeSettings({}));
});
