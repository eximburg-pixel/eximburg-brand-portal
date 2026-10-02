import type { Config } from "@netlify/functions";
import { getFirebase } from "../lib/firebase-admin.js";
import { blobFiles } from "../lib/blob-files.js";
import { getUserFromRequest } from "../lib/identity-request.js";
import { handleFile } from "../lib/files-endpoint.js";
import { warmGate } from "../lib/warm.js";

// GET /api/file?path=<path>  ->  returns one file, only if this person may see it.
export default async (request: Request) => {
  const warm = await warmGate(request, () => getFirebase().db);
  if (warm) return warm;
  return handleFile(request, {
    getUser: () => getUserFromRequest(request),
    firebase: () => getFirebase(),
    files: blobFiles()
  });
};

export const config: Config = { path: "/api/file" };
