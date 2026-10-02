/*
  Keeps the user-facing Netlify functions loaded while Admin chooses a hot server.
  Each function is a separate process. A quiet stretch shuts it down, and the next
  visit waits while it starts. A hot server wakes those processes every few minutes.
  A cold server leaves them asleep. The wake-up token stays in Firestore and is
  never sent to the browser.
*/
import { randomBytes, timingSafeEqual } from "node:crypto";

export const WARM_HEADER = "x-exb-warm";
export const RUNTIME_PATH = "settings/runtime";
export const TOKEN_BYTES = 32;

/* Paths that load the same heavy server code a visitor or staff member hits. */
export const WARM_PATHS = Object.freeze([
  "/api/session",
  "/api/call/warm",
  "/api/open-account",
  "/api/staff-sign-in",
  "/api/upload/warm",
  "/api/file"
]);

export function newToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/* Missing settings mean hot: the site stays ready until Admin chooses cold. */
export function modeOf(data) {
  return data && data.mode === "cold" ? "cold" : "hot";
}

function tokenOf(data) {
  const token = data && typeof data.token === "string" ? data.token : "";
  return token.length === TOKEN_BYTES * 2 && /^[0-9a-f]+$/.test(token) ? token : "";
}

export function tokensMatch(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* A wake-up request ends here. A normal visitor request returns null and continues. */
export async function warmGate(request, getDb) {
  const header = request.headers.get(WARM_HEADER);
  if (!header) return null;
  let expected = "";
  try {
    const snap = await getDb().doc(RUNTIME_PATH).get();
    expected = tokenOf(snap.exists ? snap.data() : null);
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!tokensMatch(header, expected)) return new Response(null, { status: 401 });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export function siteBase() {
  return String(process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
}

export async function pingTargets(fetchImpl, siteUrl, token, paths = WARM_PATHS) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  if (!base || !token) return [];
  return Promise.all(paths.map(async (path) => {
    try {
      const res = await fetchImpl(base + path, {
        method: "GET",
        headers: { [WARM_HEADER]: token },
        redirect: "manual",
        signal: AbortSignal.timeout(8000)
      });
      return { path, ok: res.status === 204 };
    } catch {
      return { path, ok: false };
    }
  }));
}

export async function readMode(db) {
  const snap = await db.doc(RUNTIME_PATH).get();
  return modeOf(snap.exists ? snap.data() : null);
}

export async function writeMode(db, mode, by) {
  const snap = await db.doc(RUNTIME_PATH).get();
  const prev = snap.exists ? snap.data() : {};
  const next = {
    mode,
    token: tokenOf(prev) || newToken(),
    updated_at: new Date().toISOString(),
    updated_by: by || "keep-warm"
  };
  await db.doc(RUNTIME_PATH).set(next);
  return next;
}

/* Called on a timer. Hot wakes every visitor function. Cold does nothing. */
export async function keepWarm({ db, fetchImpl, siteUrl }) {
  const snap = await db.doc(RUNTIME_PATH).get();
  const prev = snap.exists ? snap.data() : null;
  if (modeOf(prev) === "cold") return { mode: "cold", ready: true, pinged: 0 };
  const stored = tokenOf(prev) ? prev : await writeMode(db, "hot", "keep-warm");
  const pinged = await pingTargets(fetchImpl, siteUrl, stored.token);
  return {
    mode: "hot",
    ready: pinged.length > 0 && pinged.every((row) => row.ok),
    pinged: pinged.length
  };
}
