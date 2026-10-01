import test from "node:test";
import assert from "node:assert/strict";
import { dropRates, funnelFrom, isDroppedSession } from "../shared/portal-insights.js";
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
