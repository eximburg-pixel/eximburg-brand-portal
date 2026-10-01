import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { getFirebase } from "../lib/firebase-admin.js";
import { blobFiles } from "../lib/blob-files.js";
import { handleFile } from "../lib/files-endpoint.js";

// GET /api/file?path=<path>  ->  returns one file, only if this person may see it.
export default async (request: Request) =>
  handleFile(request, {
    getUser,
    firebase: () => getFirebase(Netlify.env.get("FIREBASE_SERVICE_ACCOUNT")),
    files: blobFiles()
  });

export const config: Config = { path: "/api/file" };
