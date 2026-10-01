/*
  Browser-side caller for the server actions (POST /api/call/<action>).
  fetchImpl is passed in so this can be tested without a network.
*/
export const LATER_STEP_MESSAGE = "This action is connected in a later step. Nothing was saved.";
export const OFFLINE_MESSAGE = "Could not reach the server. Check your internet connection and try again.";

export class ApiCallError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiCallError";
    this.status = status;
    this.code = code;
  }
}

/* Turns a Firestore error into a sentence a staff member can act on. */
export function friendlyDataError(error) {
  const code = String((error && error.code) || "").replace(/^firestore\//, "");
  if (code === "permission-denied") return "You do not have access to this data. Ask an Admin to check your access, then sign in again.";
  if (code === "unauthenticated") return "Your session ended. Sign in again.";
  if (code === "unavailable" || code === "deadline-exceeded") return OFFLINE_MESSAGE;
  if (code === "failed-precondition") return "The database needs a one-time update before this page can load. Please tell the developer.";
  if (code === "resource-exhausted") return "The free daily database limit was reached. It resets automatically; try again later.";
  return (error && error.message) || "Could not load the data. Please reload the page.";
}

export function createApiClient(fetchImpl) {
  return async function callApi(action, payload) {
    let response;
    try {
      response = await fetchImpl("/api/call/" + encodeURIComponent(action), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload || {})
      });
    } catch (error) {
      throw new ApiCallError(OFFLINE_MESSAGE, 0, "offline");
    }
    let body = null;
    try { body = await response.json(); } catch (error) { body = null; }
    if (response.ok && body && body.ok) return body;

    const problem = (body && body.error) || {};
    if (problem.code === "unknown_action") throw new ApiCallError(LATER_STEP_MESSAGE, response.status, "later_step");
    if (response.status === 401) throw new ApiCallError("Your session ended. Sign in again.", 401, "signed_out");
    // The server's own sentence is already written for people. Admin may also get a technical detail.
    const message = problem.message || "Something went wrong. Please try again.";
    throw new ApiCallError(problem.detail ? `${message} (${problem.detail})` : message, response.status, problem.code || "error");
  };
}
