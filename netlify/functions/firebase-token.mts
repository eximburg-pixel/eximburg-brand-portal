import type { Config } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import { getFirebase } from "../lib/firebase-admin.js";
import { getUserFromRequest } from "../lib/identity-request.js";
import { handleSession } from "../lib/session-endpoint.js";
import { warmGate } from "../lib/warm.js";

// POST /api/session  ->  returns a Firebase sign-in token for the signed-in Netlify user.
export default async (request: Request) => {
  const warm = await warmGate(request, () => getFirebase().db);
  if (warm) return warm;
  return handleSession(request, {
    verifyOrigin: verifyRequestOrigin,
    getUser: () => getUserFromRequest(request),
    firebase: () => getFirebase()
  });
};

export const config: Config = { path: "/api/session" };
