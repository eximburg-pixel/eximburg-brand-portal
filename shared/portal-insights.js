/*
  Overview numbers: conversion funnel and drop rate.

  The tracker stores camelCase fields (ts, loginId, sessionId, session_start, page_view).
  mapEvent / mapSession turn those into the shapes this file reads, so the panel never
  has to know both names.
*/
import { STEP_IDS, STEP_LABELS } from "./portal-steps.js";

export function inRangeIso(iso, rangeDays, now = Date.now()) {
  if (!rangeDays) return true;
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && now - at <= rangeDays * 864e5;
}

/*
  A session dropped at exitStep when they left, did not book, and did not come back.
  See ANALYTICS.md "Drop rate".
*/
export function isDroppedSession(session) {
  if (!session || session.booked) return false;
  const left = Number(session.leftAt) || 0;
  const back = Number(session.returnedAt) || 0;
  if (left <= 0 || left <= back) return false;
  return session.status === "hidden" || session.status === "closed";
}

function bucketStart(now, unit, stepsBack) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (unit === "month") {
    d.setDate(1);
    d.setMonth(d.getMonth() - stepsBack);
    return d;
  }
  const monday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - monday - 7 * stepsBack);
  return d;
}

function sessionAt(session) {
  const left = Number(session && session.leftAt) || 0;
  const started = Number(session && session.startedAt) || Date.parse((session && session.started_at) || "");
  return left || (Number.isFinite(started) ? started : 0);
}

/* Dropout rate for each of the last `count` weeks (Monday start) or calendar months. */
export function dropoutSeries(sessions, unit = "week", count = 8, now = Date.now()) {
  const list = Array.isArray(sessions) ? sessions : [];
  const rows = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = bucketStart(now, unit, i);
    const end = bucketStart(now, unit, i - 1);
    const inBucket = list.filter((s) => {
      const at = sessionAt(s);
      return at >= start.getTime() && at < end.getTime();
    });
    const dropped = inBucket.filter(isDroppedSession).length;
    rows.push({
      start: start.toISOString(),
      label: start.toLocaleDateString("en-IN", unit === "month" ? { month: "short" } : { day: "numeric", month: "short" }),
      sessions: inBucket.length,
      dropped,
      rate: inBucket.length ? dropped / inBucket.length : 0
    });
  }
  return rows;
}

/* The step where the most people left without booking in the last 7 days. */
export function biggestLeak(sessions, now = Date.now(), stepIds = STEP_IDS) {
  const recent = (Array.isArray(sessions) ? sessions : []).filter((s) => {
    const at = sessionAt(s);
    return at && now - at <= 7 * 864e5;
  });
  const rows = dropRates(recent, stepIds).filter((r) => r.dropped > 0);
  rows.sort((a, b) => b.dropped - a.dropped || b.rate - a.rate);
  return rows[0] || null;
}

export function medianHours(samples) {
  const nums = (Array.isArray(samples) ? samples : []).filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function dropRates(sessions, stepIds = STEP_IDS) {
  const list = Array.isArray(sessions) ? sessions : [];
  return stepIds.map((id) => {
    const visited = list.filter((s) => Array.isArray(s.stepsVisited) && s.stepsVisited.includes(id)).length;
    const dropped = list.filter((s) => isDroppedSession(s) && s.exitStep === id).length;
    return {
      id,
      label: STEP_LABELS[id] || id,
      visited,
      dropped,
      rate: visited ? dropped / visited : 0
    };
  });
}

/*
  Conversion funnel. `D` is staffData after the panel has attached sections/plans/bookings
  to each customer (team.html derive()). Range 0 = all time.
*/
export function funnelFrom(D, rangeDays = 0, now = Date.now()) {
  const events = (D && D.events) || [];
  const customers = (D && D.customers) || [];
  const P = (D && D.P) || {};
  const inRange = (iso) => inRangeIso(iso, rangeDays, now);
  const visits = new Set(events.filter((e) => e.type === "visit" && inRange(e.created_at)).map((e) => e.session_id)).size;
  const cust = customers.filter((c) => inRange(c.created_at));
  const has = (fn) => cust.filter((c) => fn(P[c.id] || { sections: new Set(), bk: [], plan: null })).length;
  const planned = has((p) => p.plan || (p.sections && p.sections.has("launchpad")));
  const openedBook = has((p) => (p.sections && p.sections.has("book")) || (p.bk && p.bk.length));
  const booked = has((p) => p.bk && p.bk.length);
  const slipped = has((p) => (p.bk || []).some((b) => b.pay && b.pay.length));
  const verified = has((p) => (p.bk || []).some((b) => (b.pay || []).some((pay) => pay.status === "verified")));
  return {
    visits,
    signups: cust.length,
    steps: [
      ["Visitors", visits],
      ["Created account", cust.length],
      ["Planned a batch", planned],
      ["Opened booking", openedBook],
      ["Booked a slot", booked],
      ["Uploaded slip", slipped],
      ["Payment verified", verified]
    ]
  };
}
