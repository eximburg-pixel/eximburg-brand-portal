import test from "node:test";
import assert from "node:assert/strict";
import {
  READINESS_QUESTIONS, bandLabel, normalizeReadiness, offerNote, readinessFromEvents, scoreReadiness, tipFor
} from "../shared/portal-readiness.js";

test("each question scores the answers in the readiness table, and 18 is the maximum", () => {
  const expected = [
    [0, 2, 3, 3],
    [0, 1, 2, 3],
    [3, 3, 2, 0],
    [3, 2, 1, 1],
    [0, 1, 3, 3],
    [3, 2, 1, 0]
  ];
  READINESS_QUESTIONS.forEach((q, i) => {
    assert.deepEqual(q.options.map((o) => o.score), expected[i], q.id);
  });
  const perfect = scoreReadiness([3, 3, 0, 0, 2, 0], true);
  assert.equal(perfect.total, 18);
  assert.equal(perfect.band, "hot");
  assert.equal(perfect.complete, true);
  assert.equal(perfect.offer, true);
  assert.equal(perfect.channel, "shops");
  assert.equal(perfect.timing, "month");
});

test("14–18 is Hot, 9–13 is Warm, and 0–8 is Cold", () => {
  assert.equal(scoreReadiness([1, 2, 0, 0, 2, 2], true).total, 14);
  assert.equal(scoreReadiness([1, 2, 0, 0, 2, 2], true).band, "hot");
  assert.equal(scoreReadiness([1, 2, 2, 1, 2, 1], true).total, 13);
  assert.equal(scoreReadiness([1, 2, 2, 1, 2, 1], true).band, "warm");
  assert.equal(scoreReadiness([1, 1, 2, 2, 1, 1], true).total, 9);
  assert.equal(scoreReadiness([1, 1, 2, 2, 1, 1], true).band, "warm");
  assert.equal(scoreReadiness([1, 0, 2, 2, 1, 1], true).total, 8);
  assert.equal(scoreReadiness([1, 0, 2, 2, 1, 1], true).band, "cold");
  assert.equal(scoreReadiness([0, 0, 3, 2, 0, 3], true).total, 1);
  assert.equal(scoreReadiness([0, 0, 3, 2, 0, 3], true).band, "cold");
});

test("a budget below ₹6.3 lakh can never be Ready, even when the other answers are perfect", () => {
  const scored = scoreReadiness([0, 3, 0, 0, 3, 0], true);
  assert.equal(scored.total, 15);
  assert.equal(scored.band, "warm");
  assert.deepEqual(scored.rules, ["budget"]);
  assert.match(tipFor(0, 0).en, /7,000 packs/);
});

test("a 3-month horizon caps a ready score at Close, and a low score stays Cold", () => {
  const high = scoreReadiness([3, 3, 0, 0, 0, 0], true);
  assert.equal(high.total, 15);
  assert.equal(high.band, "warm");
  assert.deepEqual(high.rules, ["horizon"]);
  const low = scoreReadiness([0, 0, 3, 3, 0, 3], true);
  assert.equal(low.band, "cold");
  assert.deepEqual(low.rules, ["budget", "horizon"]);
});

test("the result stays hidden until the commitment is ticked, and low answers carry a note", () => {
  const hidden = scoreReadiness([3, 3, 0, 0, 2, 0], false);
  assert.equal(hidden.allAnswered, true);
  assert.equal(hidden.complete, false);
  assert.equal(hidden.band, "hot");
  assert.equal(tipFor(1, 0).en, "Brands that skip marketing usually stall. Plan at least ₹1 lakh. Influencer posts drive most first sales.");
  assert.match(tipFor(1, 1).en, /₹1 lakh/);
  assert.match(tipFor(2, 3).en, /Influencer sales plan/);
  assert.match(tipFor(3, 2).en, /focus on selling/);
  assert.match(tipFor(3, 3).en, /focus on selling/);
  assert.match(tipFor(4, 1).en, /12 months/);
  assert.match(tipFor(5, 3).en, /this month/);
  assert.equal(tipFor(0, 2), null);
  assert.equal(tipFor(2, 0), null);
  assert.deepEqual(offerNote(0, 3), { en: "This budget unlocks the ₹90,000 offer.", hi: "यह बजट ₹90,000 का ऑफ़र खोलता है।" });
  assert.equal(offerNote(0, 2), null);
});

test("old yes/no answers are not treated as the new choices", () => {
  const fresh = normalizeReadiness(null);
  assert.deepEqual(fresh.answers, [null, null, null, null, null, null]);
  assert.equal(fresh.commit, false);
  const kept = normalizeReadiness({ answers: [3, "1", 9, null, -1, 0], commit: "true" });
  assert.deepEqual(kept.answers, [3, 1, null, null, null, 0]);
  assert.equal(kept.commit, true);
});

test("the team reads the latest readiness check, including one that is still in progress", () => {
  const events = [
    { type: "readiness_check", created_at: "2026-10-01T00:00:00.000Z", meta: { answers: [0, 0, 0, 0, 0, 0], commit: true } },
    { type: "visit", created_at: "2026-10-03T00:00:00.000Z", meta: {} },
    { type: "readiness_check", created_at: "2026-10-02T00:00:00.000Z", meta: { answers: [3, 3, 1, 0, 2, 0], commit: true } }
  ];
  const latest = readinessFromEvents(events);
  assert.equal(latest.band, "hot");
  assert.equal(latest.channelLabel, "Has an online audience");
  assert.equal(latest.timingLabel, "This month");
  assert.equal(bandLabel(latest.band), "Hot");
  const partial = readinessFromEvents([
    { type: "readiness_check", created_at: "2026-10-02T00:00:00.000Z", meta: { answers: [-1, -1, 0, -1, -1, 3], commit: false } }
  ]);
  assert.equal(partial.complete, false);
  assert.equal(partial.channel, "shops");
  assert.equal(partial.timing, "exploring");
  assert.equal(readinessFromEvents([]), null);
});
