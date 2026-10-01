/*
  POST /api/call/:action
  One door for every server action. For each call it:
    1. accepts POST only and only from our own site (CSRF check),
    2. asks Netlify Identity who the caller is,
    3. checks that the caller's role may run this action,
    4. reads a small JSON body and runs the action.
*/
import { ApiError, errorResponse, jsonResponse, readJson } from "./http.js";
import { ACTIONS } from "./actions.js";
import { roleOf } from "../../js/src/session.js";
import { toSpecRole } from "../../shared/portal-rules.js";

export async function handleApi(request, actionName, deps) {
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

    const action = Object.prototype.hasOwnProperty.call(ACTIONS, actionName) ? ACTIONS[actionName] : null;
    if (!action) throw new ApiError(404, "unknown_action", "That action does not exist.");

    const role = toSpecRole(roleOf(user));
    if (!action.roles.includes(role)) throw new ApiError(403, "forbidden", "You do not have access to do this.");

    const payload = await readJson(request);
    const result = await action.run({
      user, role,
      firebase: deps.firebase, identity: deps.identity, files: deps.files,
      now: deps.now || Date.now, random: deps.random, log: deps.log
    }, payload);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const isAdmin = Boolean(user) && roleOf(user) === "admin";
    return errorResponse(error, { showDetail: isAdmin, log: deps.log });
  }
}
