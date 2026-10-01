import type { Config, Context } from "@netlify/functions";
import { admin, getUser, verifyRequestOrigin } from "@netlify/identity";
import { getFirebase } from "../lib/firebase-admin.js";
import { handleApi } from "../lib/api-endpoint.js";

// POST /api/call/<action>  ->  runs one server action after checking who is asking.
export default async (request: Request, context: Context) =>
  handleApi(request, context.params.action, {
    verifyOrigin: verifyRequestOrigin,
    getUser,
    identity: admin,
    firebase: () => getFirebase(Netlify.env.get("FIREBASE_SERVICE_ACCOUNT"))
  });

export const config: Config = { path: "/api/call/:action" };
