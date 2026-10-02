/*
  Production plan dates (spec section 6.8).

  Customer waiting time is never counted against Production. Days the customer has
  not acted (the 10% hold, the 40% hold, the 50% hold, shipping, and the time
  Accounts is checking a slip) are added onto the plan. While that wait is open,
  the "behind plan" number stays at zero.
*/
import { stageIndex } from "./portal-rules.js";
import { DEFAULT_SETTINGS } from "./portal-settings.js";

export const HOLD_STAGES = [
  "awaiting_40", "awaiting_50", "shipping_quote", "awaiting_shipping", "docs_pending"
];

const DAY = 864e5;

export function addDays(date, days) {
  return new Date(date.getTime() + Number(days) * DAY);
}

export function manufacturingDays(packs, timeline = {}) {
  const T = { ...DEFAULT_SETTINGS.timeline, ...timeline };
  const n = Number(packs) || 0;
  const perDay = Number(T.packsPerDay) || 1;
  return Math.max(Number(T.minMfgDays) || 0, Math.ceil(n / perDay));
}

function firstAt(updates, stage) {
  const row = (updates || []).find((x) => x && x.stage === stage);
  if (!row || row.created_at == null) return null;
  const at = new Date(row.created_at);
  return Number.isNaN(at.getTime()) ? null : at;
}

function holdDays(updates, stage, next, currentStage, now) {
  const start = firstAt(updates, stage);
  if (!start) return 0;
  const resumed = firstAt(updates, next);
  if (resumed) return Math.max(0, (resumed - start) / DAY);
  const here = stageIndex(currentStage);
  const from = stageIndex(stage);
  const until = stageIndex(next);
  const stillWaiting = currentStage === stage
    || currentStage === "payment_review"
    || (here > from && here < until);
  if (!stillWaiting) return 0;
  return Math.max(0, (now - start) / DAY);
}

/*
  booking.upd (or .updates) is the history list. start is the first "confirmed" update,
  falling back to updated_at / created_at.
*/
export function orderPlan(booking, timeline = {}, nowInput = new Date()) {
  const b = booking || {};
  const T = { ...DEFAULT_SETTINGS.timeline, ...timeline };
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const updates = b.upd || b.updates || [];
  const idx = stageIndex(b.stage);
  const at = (k) => firstAt(updates, k);
  /* Before the customer pays the 10%, the plan date stays a full cycle away. */
  const waitingToStart = b.stage === "awaiting_payment";
  const start = waitingToStart ? now : (at("confirmed") || new Date(b.updated_at || b.created_at || now));
  const h40 = holdDays(updates, "awaiting_40", "approval_packaging", b.stage, now);
  const h50 = holdDays(updates, "awaiting_50", "ready_dispatch", b.stage, now);
  const md = manufacturingDays(b.packs, T);
  const lEnd = addDays(start, T.labelDays);
  const pS = addDays(lEnd, h40);
  const pE = addDays(pS, T.packagingDays);
  const mE = addDays(pE, md);
  const qE = addDays(mE, T.qcDays);
  const dS = addDays(new Date(Math.max(qE, addDays(pS, T.approvalMin))), h50);
  const dE = addDays(dS, T.dispatchDays);
  const dLate = addDays(addDays(new Date(Math.max(qE, addDays(pS, T.approvalMax))), h50), T.dispatchDays);
  const rows = [
    { name: "Label design", ps: start, pe: lEnd, from: "label_design", done: "awaiting_40" },
    {
      name: `Packaging (govt approval ${T.approvalMin}–${T.approvalMax} days runs alongside)`,
      ps: pS, pe: pE, from: "approval_packaging", done: "manufacturing"
    },
    { name: `Manufacturing: ${Number(b.packs) || 0} packs, about ${md} days`, ps: pE, pe: mE, from: "manufacturing", done: "qc" },
    { name: "Quality check", ps: mE, pe: qE, from: "qc", done: "awaiting_50" },
    { name: "Dispatch", ps: dS, pe: dE, from: "ready_dispatch", done: "dispatched" }
  ];
  let cur = null;
  for (const r of rows) {
    r.as = at(r.from);
    r.isDone = b.stage !== "cancelled" && idx >= stageIndex(r.done);
    r.ae = r.isDone ? (at(r.done) || null) : null;
    if (!r.isDone && !cur) cur = r;
  }
  const onHold = HOLD_STAGES.includes(b.stage) || b.stage === "awaiting_payment" || b.stage === "payment_review";
  const late = cur && !onHold ? Math.floor((now - cur.pe) / DAY) : 0;
  return {
    rows, cur, late, onHold,
    dispatchBy: dE, dispatchLatest: dLate,
    hold: Math.round(h40 + h50),
    h40, h50, md, start, at
  };
}
