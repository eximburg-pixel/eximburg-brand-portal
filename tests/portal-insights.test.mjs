import test from "node:test";
import assert from "node:assert/strict";
import { biggestLeak, dropRates, dropoutSeries, funnelFrom, isDroppedSession, medianHours, orderTiming, orderTimingSummary, repeatVisitors } from "../shared/portal-insights.js";
import { mapEvent } from "../shared/portal-mappers.js";

const T = Date.parse("2026-10-01T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("a session dropped only when they left, did not book, and did not come back", () => {
  assert.equal(isDroppedSession({ booked: false, leftAt: T, returnedAt: 0, status: "closed", exitStep: "profit" }), true);
  assert.equal(isDroppedSession({ booked: false, leftAt: T, returnedAt: 0, status: "hidden", exitStep: "profit" }), true);
  assert.equal(isDroppedSession({ booked: true, leftAt: T, returnedAt: 0, status: "closed", exitStep: "profit" }), false);
  assert.equal(isDroppedSession({ booked: false, leftAt: 0, returnedAt: 0, status: "open", exitStep: "profit" }), false);
  assert.equal(isDroppedSession({ booked: false, leftAt: T, returnedAt: T + 1, status: "closed", exitStep: "profit" }), false);
});

test("drop rate is dropped-at-step over sessions that opened that step", () => {
  const sessions = [
    { booked: false, leftAt: T, returnedAt: 0, status: "closed", exitStep: "profit", stepsVisited: ["home", "launchpad", "profit"] },
    { booked: false, leftAt: T, returnedAt: 0, status: "closed", exitStep: "profit", stepsVisited: ["home", "profit"] },
    { booked: false, leftAt: T, returnedAt: 0, status: "closed", exitStep: "home", stepsVisited: ["home"] },
    { booked: true, leftAt: T, returnedAt: 0, status: "closed", exitStep: "book", stepsVisited: ["home", "profit", "book"] }
  ];
  const rows = dropRates(sessions);
  const profit = rows.find((r) => r.id === "profit");
  assert.equal(profit.visited, 3);
  assert.equal(profit.dropped, 2);
  assert.equal(profit.rate, 2 / 3);
  const home = rows.find((r) => r.id === "home");
  assert.equal(home.visited, 4);
  assert.equal(home.dropped, 1);
});

test("dropout series groups sessions by week and counts people who left without booking", () => {
  const monday = new Date(2026, 8, 28);
  monday.setHours(0, 0, 0, 0);
  const start = monday.getTime();
  const sessions = [
    { booked: false, leftAt: start + 864e5, returnedAt: 0, status: "closed", started_at: iso(start + 864e5) },
    { booked: true, leftAt: start + 2 * 864e5, returnedAt: 0, status: "closed", started_at: iso(start + 2 * 864e5) },
    { booked: false, leftAt: start - 3 * 864e5, returnedAt: 0, status: "hidden", started_at: iso(start - 3 * 864e5) }
  ];
  const rows = dropoutSeries(sessions, "week", 2, start + 3 * 864e5);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].sessions, 2);
  assert.equal(rows[1].dropped, 1);
  assert.equal(rows[0].dropped, 1);
});

test("the biggest leak is the step where the most people left this week", () => {
  const now = T;
  const sessions = [
    { booked: false, leftAt: now - 864e5, returnedAt: 0, status: "closed", exitStep: "book", stepsVisited: ["home", "book"] },
    { booked: false, leftAt: now - 2 * 864e5, returnedAt: 0, status: "closed", exitStep: "book", stepsVisited: ["launchpad", "book"] },
    { booked: false, leftAt: now - 864e5, returnedAt: 0, status: "closed", exitStep: "profit", stepsVisited: ["profit"] },
    { booked: false, leftAt: now - 20 * 864e5, returnedAt: 0, status: "closed", exitStep: "home", stepsVisited: ["home"] }
  ];
  const leak = biggestLeak(sessions, now);
  assert.equal(leak.id, "book");
  assert.equal(leak.label, "Book your slot");
  assert.equal(leak.dropped, 2);
});

test("median hours ignores empty samples and picks the middle value", () => {
  assert.equal(medianHours([]), null);
  assert.equal(medianHours([10, 2, 8]), 8);
  assert.equal(medianHours([4, 10]), 7);
});

test("funnel counts match a test customer's clicks after tracker names are mapped", () => {
  const uid = "cust1";
  const raw = [
    { type: "session_start", sessionId: "S1", loginId: "EXB-a", ts: T },
    { type: "page_view", sessionId: "S1", loginId: "EXB-a", ts: T + 1, from: "home", to: "launchpad" },
    { type: "plan_change", sessionId: "S1", loginId: "EXB-a", ts: T + 2, packs: 7000, order: 630000, flavours: 1 },
    { type: "page_view", sessionId: "S1", loginId: "EXB-a", ts: T + 3, from: "launchpad", to: "book" }
  ];
  const events = raw.map((row, i) => mapEvent("e" + i, row, { "EXB-a": uid }));
  assert.deepEqual(events.map((e) => e.type), ["visit", "section_view", "plan_change", "section_view"]);
  const customers = [{ id: uid, created_at: iso(T), role: "customer" }];
  const P = {
    [uid]: {
      sections: new Set(events.filter((e) => e.type === "section_view").map((e) => e.meta.id)),
      plan: { packs: 7000, order: 630000, flavours: 1 },
      bk: []
    }
  };
  const funnel = funnelFrom({ events, customers, P, bookings: [], payments: [] }, 0, T + 10000);
  assert.equal(funnel.visits, 1);
  assert.equal(funnel.signups, 1);
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

test("repeat visitors are signed-in people who opened the portal more than twice", () => {
  const sessions = [
    { user_id: "u1", login_id: "L1", leftAt: T, started_at: iso(T) },
    { user_id: "u1", login_id: "L1", leftAt: T + 1, started_at: iso(T + 1) },
    { login_id: "L1", leftAt: T + 2, started_at: iso(T + 2) },
    { user_id: "u2", login_id: "L2", leftAt: T, started_at: iso(T) },
    { user_id: "u2", login_id: "L2", leftAt: T + 1, started_at: iso(T + 1) },
    { leftAt: T, started_at: iso(T) }
  ];
  const rows = repeatVisitors(sessions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, "u1");
  assert.equal(rows[0].visits, 3);
});

test("order timing sums customer payment steps and measures booking to dispatch", () => {
  const booking = {
    id: "b1",
    code: "EXB-1",
    stage: "dispatched",
    created_at: iso(T),
    upd: [
      { stage: "awaiting_payment", created_at: iso(T) },
      { stage: "payment_review", created_at: iso(T + 10 * 36e5) },
      { stage: "awaiting_40", created_at: iso(T + 20 * 36e5) },
      { stage: "approval_packaging", created_at: iso(T + 26 * 36e5) },
      { stage: "dispatched", created_at: iso(T + 100 * 36e5) }
    ]
  };
  const row = orderTiming(booking, T + 200 * 36e5);
  assert.equal(row.payHours, 16);
  assert.equal(row.totalHours, 100);
  assert.equal(row.complete, true);
  const waiting = { id: "b2", code: "EXB-2", stage: "awaiting_payment", created_at: iso(T), pay: [] };
  const open = orderTiming(waiting, T + 48 * 36e5);
  assert.equal(open.payHours, 48);
  assert.equal(open.totalHours, null);
  const summary = orderTimingSummary([booking, waiting], T + 48 * 36e5);
  assert.equal(summary.completed, 1);
  assert.equal(summary.medianTotalHours, 100);
  assert.equal(summary.slowPay[0].code, "EXB-2");
});
