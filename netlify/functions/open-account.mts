import type { Config, Context } from "@netlify/functions";
import { admin, verifyRequestOrigin } from "@netlify/identity";
import { errorResponse, jsonResponse } from "../lib/http.js";
import { getFirebase } from "../lib/firebase-admin.js";
import { clientAddress, rateKey, takeAttempt } from "../lib/rate-limit.js";
import { openAccount } from "../lib/open-account.js";
import { warmGate } from "../lib/warm.js";

async function consumeAttempt(request: Request) {
  let db;
  try {
    db = getFirebase().db;
  } catch {
    return;
  }
  await takeAttempt(db, rateKey("open-account", clientAddress(request)), { limit: 8, windowMs: 60 * 60 * 1000 });
}

export default async (request: Request, _context: Context) => {
  const warm = await warmGate(request, () => getFirebase().db);
  if (warm) return warm;
  try {
    const result = await openAccount(request, {
      verifyOrigin: verifyRequestOrigin,
      identity: admin,
      consumeAttempt: () => consumeAttempt(request)
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error, { log: console.error });
  }
};

export const config: Config = { path: "/api/open-account" };
