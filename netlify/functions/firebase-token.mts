import type { Config } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import { getFirebase } from "../lib/firebase-admin.js";
import { getUserFromRequest } from "../lib/identity-request.js";
import { handleSession } from "../lib/session-endpoint.js";

// POST /api/session  ->  returns a Firebase sign-in token for the signed-in Netlify user.
export default async (request: Request) =>
  handleSession(request, {
    verifyOrigin: verifyRequestOrigin,
    getUser: () => getUserFromRequest(request),
    firebase: () => getFirebase(Netlify.env.get("FIREBASE_SERVICE_ACCOUNT"))
  });

export const config: Config = { path: "/api/session" };
