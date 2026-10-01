/*
  Signs the browser in to Firebase.
  The page is already signed in to Netlify. This asks OUR server (/api/session) to confirm that
  and hand back a Firebase token. The Firestore rules then decide what this person may read and write.
  The browser never decides its own role: the server takes it from Netlify.
*/
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, onIdTokenChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Latest ID token, kept ready so a "page is closing" write can use it without waiting.
let idToken = "";
onIdTokenChanged(auth, async (user) => {
  try {
    idToken = user ? await user.getIdToken() : "";
  } catch (error) {
    idToken = "";
  }
});

export function currentIdToken() {
  return idToken;
}

export class SessionError extends Error {
  constructor(message, status, code, detail) {
    super(message);
    this.name = "SessionError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function connect() {
  const response = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  let data = null;
  try { data = await response.json(); } catch (error) { data = null; }
  if (!response.ok || !data || !data.ok || !data.token) {
    const problem = (data && data.error) || {};
    const fallback = response.status >= 500
      ? "The server had a problem signing you in. Please reload in a few seconds."
      : "Could not connect. Please reload the page.";
    throw new SessionError(problem.message || fallback, response.status, problem.code, problem.detail);
  }
  await signInWithCustomToken(auth, data.token);
  return { uid: data.uid, role: data.role, appRole: data.appRole, profile: data.profile };
}

let pending = null;
let failedAt = 0;
let lastError = null;
const RETRY_AFTER_MS = 30000;

/*
  Returns a promise for { uid, role, appRole, profile }, or null if connecting failed.
  Safe to call many times: it connects once, and after a failure waits 30 seconds before trying again.
  Pages that must have data (the team panel) read lastSessionError() to show the reason.
*/
export function ensureFirebaseSession() {
  if (pending) return pending;
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
  pending = connect().then(
    (info) => {
      lastError = null;
      failedAt = 0;
      return info;
    },
    (error) => {
      lastError = error;
      failedAt = Date.now();
      pending = null;
      return null;
    }
  );
  return pending;
}

export function lastSessionError() {
  return lastError;
}

/* Forget the connection and try again straight away (for a "Try again" button). */
export function resetFirebaseSession() {
  pending = null;
  failedAt = 0;
  lastError = null;
}

// guard.js calls this on logout, if this module was loaded on the page.
window.exbFirebaseSignOut = async function exbFirebaseSignOut() {
  resetFirebaseSession();
  idToken = "";
  try { await signOut(auth); } catch (error) {}
};
