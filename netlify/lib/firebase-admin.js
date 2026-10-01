/*
  Connects the server to Firebase using the service account stored in the
  Netlify secret variable FIREBASE_SERVICE_ACCOUNT.
  The key is never logged, never sent to a browser, never written to a file.
*/
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ApiError } from "./http.js";

export const FIREBASE_PROJECT_ID = "eximburg-brand-portal";

function configError(reason) {
  return new ApiError(
    503,
    "server_config",
    "The portal is still being set up. Please try again later.",
    reason
  );
}

/*
  Accepts the JSON text of the key, or the same JSON encoded as base64.
  Checks the shape and the project, and returns a clean object.
  Error messages say WHAT is wrong, never show the value.
*/
export function parseServiceAccount(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw configError("FIREBASE_SERVICE_ACCOUNT is not set in Netlify (or is empty).");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
    } catch {
      throw configError("FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account file, or its base64.");
    }
  }

  if (!parsed || typeof parsed !== "object" || parsed.type !== "service_account") {
    throw configError('FIREBASE_SERVICE_ACCOUNT is not a service-account key (its "type" must be "service_account").');
  }
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      throw configError(`FIREBASE_SERVICE_ACCOUNT is missing "${field}".`);
    }
  }
  if (parsed.project_id !== FIREBASE_PROJECT_ID) {
    throw configError(`FIREBASE_SERVICE_ACCOUNT belongs to project "${parsed.project_id}", but this site uses "${FIREBASE_PROJECT_ID}".`);
  }
  // Some dashboards store line breaks in the key as the two characters \n.
  const privateKey = parsed.private_key.replace(/\\n/g, "\n");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw configError('The "private_key" in FIREBASE_SERVICE_ACCOUNT does not look like a key.');
  }
  return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey };
}

let cached = null;

/* Returns { auth, db, serverTime }. Throws a friendly ApiError if the key is missing or wrong. */
export function getFirebase(rawKey) {
  if (cached) return cached;
  const account = parseServiceAccount(rawKey);
  let app;
  try {
    app = getApps()[0] || initializeApp({ credential: cert(account), projectId: account.projectId });
  } catch (error) {
    throw configError("Firebase rejected the service-account key: " + (error && error.message ? error.message : "unknown reason"));
  }
  cached = { auth: getAuth(app), db: getFirestore(app), serverTime: () => FieldValue.serverTimestamp() };
  return cached;
}
