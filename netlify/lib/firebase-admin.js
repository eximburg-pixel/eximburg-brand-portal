/*
  Connects the server to Firebase using the service account stored in the
  Netlify secret variable FIREBASE_SERVICE_ACCOUNT.
  The key is never logged, never sent to a browser, never written to a file.
*/
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, initializeFirestore, FieldValue } from "firebase-admin/firestore";
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

function envValue(name) {
  try {
    if (typeof process !== "undefined" && process.env && process.env[name]) return process.env[name];
  } catch {}
  try {
    if (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function") {
      return Netlify.env.get(name);
    }
  } catch {}
  return "";
}

/* Netlify may give a string, base64, or (rarely) an already-parsed object. */
export function readServiceAccountKey() {
  const value = envValue("FIREBASE_SERVICE_ACCOUNT");
  if (value && (typeof value === "object" || String(value).trim())) return value;
  return "";
}

/*
  Accepts the JSON text of the key, the same JSON encoded as base64, or the parsed object.
  Checks the shape and the project, and returns a clean object.
  Error messages say WHAT is wrong, never show the value.
*/
export function parseServiceAccount(raw) {
  let parsed;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.then !== "function") {
    parsed = raw;
  } else {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) throw configError("FIREBASE_SERVICE_ACCOUNT is not set in Netlify (or is empty).");
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        parsed = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
      } catch {
        throw configError("FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account file, or its base64.");
      }
    }
    // Some dashboards store the JSON as a quoted string (double-encoded).
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        throw configError("FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account file, or its base64.");
      }
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
  const account = parseServiceAccount(rawKey !== undefined ? rawKey : readServiceAccountKey());
  let app;
  let db;
  try {
    if (getApps().length) {
      app = getApps()[0];
      db = getFirestore(app);
    } else {
      app = initializeApp({ credential: cert(account), projectId: account.projectId });
      // REST avoids gRPC issues on Netlify's Node runtime.
      db = initializeFirestore(app, { preferRest: true });
    }
  } catch (error) {
    throw configError("Firebase rejected the service-account key: " + (error && error.message ? error.message : "unknown reason"));
  }
  cached = { auth: getAuth(app), db, serverTime: () => FieldValue.serverTimestamp() };
  return cached;
}
