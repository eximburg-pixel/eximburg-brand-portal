import test from "node:test";
import assert from "node:assert/strict";
import { clientAddress, rateKey, takeAttempt } from "../netlify/lib/rate-limit.js";
import { fakeFirestore } from "./helpers/fake-firestore.mjs";

test("the attempt key does not contain the raw address", () => {
  const key = rateKey("staff-email", "Admin@Eximburg.com");
  assert.equal(key.includes("Admin"), false);
  assert.equal(key.length, 40);
});

test("the client address prefers the Netlify connection header", () => {
  const request = new Request("https://eximburg-brands.netlify.app/api/staff-sign-in", {
    headers: { "x-nf-client-connection-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.2" }
  });
  assert.equal(clientAddress(request), "203.0.113.8");
});

test("attempts past the limit are refused and the counter resets after the window", async () => {
  const db = fakeFirestore();
  const id = rateKey("open-account", "203.0.113.8");
  let now = 1_000_000;
  for (let i = 0; i < 3; i++) await takeAttempt(db, id, { limit: 3, windowMs: 1000, now });
  await assert.rejects(
    takeAttempt(db, id, { limit: 3, windowMs: 1000, now }),
    (error) => error.status === 429
  );
  await takeAttempt(db, id, { limit: 3, windowMs: 1000, now: now + 1000 });
});
