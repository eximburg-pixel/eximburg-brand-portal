import type { Config } from "@netlify/functions";
import { getFirebase } from "../lib/firebase-admin.js";
import { blobFiles } from "../lib/blob-files.js";
import { getUserFromRequest } from "../lib/identity-request.js";
import { handleFile } from "../lib/files-endpoint.js";

// GET /api/file?path=<path>  ->  returns one file, only if this person may see it.
export default async (request: Request) =>
  handleFile(request, {
    getUser: () => getUserFromRequest(request),
    firebase: () => getFirebase(),
    files: blobFiles()
  });

export const config: Config = { path: "/api/file" };
