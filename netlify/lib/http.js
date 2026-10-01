/*
  Small HTTP helpers shared by the Netlify Functions.
  Rules: friendly messages for people, never a stack trace, never a secret.
*/

export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail; // extra explanation, only shown to Admin users
  }
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/*
  Turns any error into a safe response.
  showDetail: true only for a signed-in Admin, who may read the technical reason.
*/
export function errorResponse(error, { showDetail = false, log = console.error } = {}) {
  if (error instanceof ApiError) {
    const body = { ok: false, error: { code: error.code, message: error.message } };
    if (showDetail && error.detail) body.error.detail = error.detail;
    return jsonResponse(body, error.status);
  }
  // Unknown problem: log the kind of error only, send a generic message.
  log("portal function error:", error && error.name, error && error.code, error && error.message);
  return jsonResponse(
    { ok: false, error: { code: "server_error", message: "Something went wrong on our side. Please try again in a moment." } },
    500
  );
}

const MAX_BODY_BYTES = 200 * 1024;

/* Reads a small JSON body. Refuses anything too large or not an object. */
export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "bad_request", "The request was not understood.");
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError(413, "too_large", "That request is too large.");
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "bad_request", "The request was not understood.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "bad_request", "The request was not understood.");
  }
  return parsed;
}
