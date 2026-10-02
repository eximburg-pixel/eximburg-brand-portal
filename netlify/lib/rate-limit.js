/*
  Slows repeated sign-up and staff sign-in attempts.
  The counter lives in Firestore and is invisible to the browser (see firestore.rules).
  If the counter cannot be written, the caller decides whether to continue.
*/
import { createHash } from "node:crypto";
import { ApiError } from "./http.js";

export function clientAddress(request) {
  const direct = request.headers.get("x-nf-client-connection-ip");
  if (direct) return direct.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export function rateKey(label, value) {
  return createHash("sha256").update(`${label}|${value}`).digest("hex").slice(0, 40);
}

export async function takeAttempt(db, id, { limit, windowMs, now = Date.now() }) {
  const ref = db.collection("rate_limits").doc(id);
  const allowed = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const data = snap.exists ? snap.data() : null;
    const fresh = data && typeof data.start === "number" && now - data.start < windowMs;
    const count = fresh ? Number(data.count) || 0 : 0;
    if (count >= limit) return false;
    t.set(ref, { start: fresh ? data.start : now, count: count + 1 });
    return true;
  });
  if (!allowed) throw new ApiError(429, "rate", "Too many attempts. Please wait a few minutes and try again.");
}
