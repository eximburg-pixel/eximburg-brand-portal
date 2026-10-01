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

/* Reads a server answer. Returns the body when it worked; otherwise throws a short, plain message. */
async function readAnswer(response) {
  let body = null;
  try { body = await response.json(); } catch (error) { body = null; }
  if (response.ok && body && body.ok) return body;

  const problem = (body && body.error) || {};
  if (problem.code === "unknown_action") throw new ApiCallError(LATER_STEP_MESSAGE, response.status, "later_step");
  if (response.status === 401) throw new ApiCallError("Your session ended. Sign in again.", 401, "signed_out");
  if (!body && response.status === 413) throw new ApiCallError("That file is larger than 5 MB.", 413, "too_large");
  // The server's own sentence is already written for people. Admin may also get a technical detail.
  const message = problem.message || "Something went wrong. Please try again.";
  throw new ApiCallError(problem.detail ? `${message} (${problem.detail})` : message, response.status, problem.code || "error");
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
    return readAnswer(response);
  };
}

/*
  Sends one payment slip as raw bytes (not base64) to /api/upload/slip and returns its stored path.
  If the same file was already uploaded for the same order, that path is reused. This matters when
  a payment is refused after the upload (for example a mistyped UTR): the customer fixes the UTR and
  sends again without storing a second copy of the slip.
  `original` is the file the customer picked (the sent file may be a shrunk copy of it).
*/
export function createSlipUploader(fetchImpl) {
  const done = new Map();
  const keyOf = (bookingId, file) => [bookingId, file.name, file.size, file.lastModified, file.type].join("|");

  async function uploadSlip(bookingId, file, original = file) {
    const key = keyOf(bookingId, original);
    if (done.has(key)) return done.get(key);
    let response;
    try {
      response = await fetchImpl("/api/upload/slip?booking=" + encodeURIComponent(bookingId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": file.type },
        body: file
      });
    } catch (error) {
      throw new ApiCallError(OFFLINE_MESSAGE, 0, "offline");
    }
    const body = await readAnswer(response);
    if (!body.path) throw new ApiCallError("The slip could not be saved. Please try again.", response.status, "no_path");
    done.set(key, body.path);
    return body.path;
  }

  /* Call after a payment went through, so the next payment never reuses an old slip. */
  uploadSlip.forget = (bookingId) => {
    for (const key of [...done.keys()]) if (key.startsWith(bookingId + "|")) done.delete(key);
  };
  return uploadSlip;
}

/* The address that opens a stored file. The server checks who is asking every time. */
export const fileUrl = (path) => "/api/file?path=" + encodeURIComponent(path);
