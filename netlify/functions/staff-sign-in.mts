import type { Config, Context } from "@netlify/functions";
import { admin, verifyRequestOrigin } from "@netlify/identity";
import { ApiError, errorResponse, jsonResponse } from "../lib/http.js";
import { getFirebase } from "../lib/firebase-admin.js";
import { clientAddress, rateKey, takeAttempt } from "../lib/rate-limit.js";
import { staffSignIn } from "../lib/staff-sign-in.js";

const WINDOW_MS = 15 * 60 * 1000;

async function consumeAttempt(request: Request, email: string) {
  let db;
  try {
    db = getFirebase().db;
  } catch {
    return;
  }
  const now = Date.now();
  await takeAttempt(db, rateKey("staff-ip", clientAddress(request)), { limit: 30, windowMs: WINDOW_MS, now });
  await takeAttempt(db, rateKey("staff-email", String(email || "").toLowerCase()), { limit: 12, windowMs: WINDOW_MS, now });
}

export default async (request: Request, _context: Context) => {
  try {
    const result = await staffSignIn(request, {
      verifyOrigin: verifyRequestOrigin,
      identity: admin,
      consumeAttempt: (email: string) => consumeAttempt(request, email),
      passwordGrant: async (username, password) => {
        const response = await fetch(new URL("/.netlify/identity/token", request.url), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "password", username, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new ApiError(401, "invalid_grant", "No user found with that email, or password invalid.");
        }
        return data;
      }
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error, { log: console.error });
  }
};

export const config: Config = { path: "/api/staff-sign-in" };
