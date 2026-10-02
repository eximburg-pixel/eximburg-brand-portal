import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEAT_MS, STEP_IDS, STEP_LABELS, STEP_NO, STEP_SCHEMA, stepNoOf } from "../shared/portal-steps.js";

test("the live schema is 14 steps, without Brands we built, and orders at 14", () => {
  assert.equal(STEP_SCHEMA, 3);
  assert.equal(STEP_IDS.length, 14);
  assert.deepEqual(STEP_IDS, [
    "home", "what", "market", "future", "target", "about",
    "benefits", "launchpad", "profit", "influencer", "process", "mindset", "book", "orders"
  ]);
  assert.equal(STEP_NO.brands, undefined);
  assert.equal(STEP_NO.benefits, 7);
  assert.equal(STEP_NO.launchpad, 8);
  assert.equal(STEP_NO.profit, 9);
  assert.equal(STEP_NO.mindset, 12);
  assert.equal(STEP_NO.book, 13);
  assert.equal(STEP_NO.orders, 14);
  assert.equal(stepNoOf("nope"), 0);
  assert.equal(STEP_LABELS.orders, "My orders");
  assert.equal(HEARTBEAT_MS, 60000);
});
