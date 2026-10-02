/*
  POST /api/session
  The page calls this after sign-in. The server:
    1. checks the request came from our own site,
    2. asks Netlify Identity who the user is (validated server-side, not trusted from the browser),
    3. makes sure a profile exists and carries the right role,
    4. returns a Firebase sign-in token so the page can read/write only what the rules allow.
*/
import { ApiError, errorResponse, jsonResponse } from "./http.js";
import { ensureProfile } from "./profiles.js";
import { profileFrom, roleOf } from "../../js/src/session.js";
import { toSpecRole } from "../../shared/portal-rules.js";
import { factorySettings } from "../../shared/portal-settings.js";

export async function handleSession(request, deps) {
  let user = null;
  try {
    if (request.method !== "POST") throw new ApiError(405, "method", "Use POST.");
    try {
      deps.verifyOrigin(request);
    } catch {
      throw new ApiError(403, "origin", "This request was blocked. Reload the page and try again.");
    }
    user = await deps.getUser();
    if (!user) throw new ApiError(401, "signed_out", "Please sign in again.");

    const appRole = roleOf(user);
    const role = toSpecRole(appRole);
    const { auth, db, serverTime } = deps.firebase();

    let profile;
    try {
      ({ profile } = await ensureProfile(db, user, serverTime));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "firestore",
        "The portal is still being set up. Please try again later.",
        (error && (error.code || (error.errorInfo && error.errorInfo.code))) || "Could not write the profile."
      );
    }
    // login_id lets the rules accept analytics writes only under this person's own login id.
    if (role !== "customer") {
      try {
        const portal = await db.doc("settings/portal").get();
        if (portal.exists) {
          await db.doc("settings/factory").set({ ...factorySettings(portal.data()), updated_at: serverTime() });
        }
      } catch (error) {
        (deps.log || console.error)("factory settings mirror:", error && error.message);
      }
    }

    let token;
    try {
      token = await auth.createCustomToken(user.id, { role, login_id: profileFrom(user).loginId });
    } catch (error) {
      (deps.log || console.error)("createCustomToken failed:", error && error.code, error && error.message);
      throw new ApiError(
        503,
        "firebase_auth",
        "The portal is still being set up. Please try again later.",
        (error && (error.code || (error.errorInfo && error.errorInfo.code))) || "Could not create a sign-in token."
      );
    }

    return jsonResponse({
      ok: true,
      token,
      uid: user.id,
      role,
      appRole,
      profile: { id: user.id, name: profile.name || "", role }
    });
  } catch (error) {
    const isAdmin = Boolean(user) && roleOf(user) === "admin";
    const setup = error instanceof ApiError && error.status === 503;
    if (setup) (deps.log || console.error)("portal setup:", error.code, error.detail || error.message);
    return errorResponse(error, { showDetail: isAdmin || setup, log: deps.log });
  }
}
