import test from "node:test";
import assert from "node:assert/strict";
import { HOLD_STAGES, manufacturingDays, orderPlan } from "../shared/portal-timeline.js";
import { DEFAULT_SETTINGS } from "../shared/portal-settings.js";

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);
const oct1 = new Date("2026-10-01T10:00:00Z");

function cleared(extra = {}) {
  return {
    packs: 7000,
    stage: "confirmed",
    created_at: oct1.toISOString(),
    updated_at: oct1.toISOString(),
    upd: [{ stage: "confirmed", created_at: oct1.toISOString() }],
    ...extra
  };
}

test("7,000 packs is 30 manufacturing days at 235 packs/day, never below the 20-day floor", () => {
  assert.equal(manufacturingDays(7000), 30);
  assert.equal(manufacturingDays(1000), 20);
  assert.equal(manufacturingDays(12000), Math.ceil(12000 / 235));
});

test("a 7,000-pack order cleared on 1 Oct: target dispatch 20 Dec, latest 19 Jan", () => {
  const p = orderPlan(cleared(), DEFAULT_SETTINGS.timeline, oct1);
  assert.equal(iso(p.start), "2026-10-01");
  assert.equal(p.md, 30);
  assert.equal(p.hold, 0);
  assert.equal(iso(p.dispatchBy), "2026-12-20");
  assert.equal(iso(p.dispatchLatest), "2027-01-19");
});

test("days waiting for the 40% are added to the plan, not counted as Production being behind", () => {
  const now = new Date(oct1.getTime() + 20 * DAY);
  const held = cleared({
    stage: "awaiting_40",
    upd: [
      { stage: "confirmed", created_at: oct1.toISOString() },
      { stage: "label_design", created_at: new Date(oct1.getTime() + 2 * DAY).toISOString() },
      { stage: "awaiting_40", created_at: new Date(oct1.getTime() + 10 * DAY).toISOString() }
    ]
  });
  const p = orderPlan(held, DEFAULT_SETTINGS.timeline, now);
  assert.ok(p.onHold);
  assert.equal(p.late, 0, "on a finance hold: never behind plan");
  assert.ok(p.h40 > 0);
  const free = orderPlan(cleared({ stage: "label_design" }), DEFAULT_SETTINGS.timeline, now);
  assert.equal(iso(p.dispatchBy) > iso(free.dispatchBy), true, "hold pushes the target out");
});

test("once the 40% clears, those hold days stay in the plan dates", () => {
  const ten = new Date(oct1.getTime() + 10 * DAY);
  const twenty = new Date(oct1.getTime() + 20 * DAY);
  const p = orderPlan(cleared({
    stage: "approval_packaging",
    upd: [
      { stage: "confirmed", created_at: oct1.toISOString() },
      { stage: "awaiting_40", created_at: ten.toISOString() },
      { stage: "approval_packaging", created_at: twenty.toISOString() }
    ]
  }), DEFAULT_SETTINGS.timeline, twenty);
  assert.equal(Math.round(p.h40), 10);
  assert.equal(iso(p.dispatchBy), iso(new Date(Date.parse("2026-12-20T10:00:00Z") + 10 * DAY)));
});

test("missing confirmed update falls back to updated_at", () => {
  const p = orderPlan({ packs: 7000, stage: "confirmed", updated_at: oct1.toISOString(), upd: [] });
  assert.equal(iso(p.start), "2026-10-01");
  assert.equal(iso(p.dispatchBy), "2026-12-20");
});

test("the finance-hold list is the stages Production must wait on", () => {
  assert.deepEqual(HOLD_STAGES, ["awaiting_40", "awaiting_50", "shipping_quote", "awaiting_shipping", "docs_pending"]);
});
