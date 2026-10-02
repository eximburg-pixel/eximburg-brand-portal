import type { Config, Context } from "@netlify/functions";
import { admin, verifyRequestOrigin } from "@netlify/identity";
import { getFirebase } from "../lib/firebase-admin.js";
import { blobFiles } from "../lib/blob-files.js";
import { getUserFromRequest } from "../lib/identity-request.js";
import { handleApi } from "../lib/api-endpoint.js";
import { warmGate } from "../lib/warm.js";

// POST /api/call/<action>  ->  runs one server action after checking who is asking.
export default async (request: Request, context: Context) => {
  const warm = await warmGate(request, () => getFirebase().db);
  if (warm) return warm;
  return handleApi(request, context.params.action, {
    verifyOrigin: verifyRequestOrigin,
    getUser: () => getUserFromRequest(request),
    identity: admin,
    firebase: () => getFirebase(),
    files: blobFiles()
  });
};

export const config: Config = { path: "/api/call/:action" };
