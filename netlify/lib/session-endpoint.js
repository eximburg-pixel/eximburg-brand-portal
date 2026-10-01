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

    const { profile } = await ensureProfile(db, user, serverTime);
    // login_id lets the rules accept analytics writes only under this person's own login id.
    let token;
    try {
      token = await auth.createCustomToken(user.id, { role, login_id: profileFrom(user).loginId });
    } catch (error) {
      throw new ApiError(
        503,
        "firebase_auth",
        "The portal is still being set up. Please try again later.",
        error && error.message ? error.message : "createCustomToken failed"
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
    return errorResponse(error, { showDetail: isAdmin, log: deps.log });
  }
}
