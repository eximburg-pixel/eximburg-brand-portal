import type { Config, Context } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import { getFirebase } from "../lib/firebase-admin.js";
import { blobFiles } from "../lib/blob-files.js";
import { getUserFromRequest } from "../lib/identity-request.js";
import { handleUpload } from "../lib/files-endpoint.js";

// POST /api/upload/<kind>?booking=<id>  ->  stores one file after checking who is sending it.
export default async (request: Request, context: Context) =>
  handleUpload(request, context.params.kind, {
    verifyOrigin: verifyRequestOrigin,
    getUser: () => getUserFromRequest(request),
    firebase: () => getFirebase(Netlify.env.get("FIREBASE_SERVICE_ACCOUNT")),
    files: blobFiles()
  });

export const config: Config = { path: "/api/upload/:kind" };
