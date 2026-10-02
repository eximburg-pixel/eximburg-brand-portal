import type { Config, Context } from "@netlify/functions";
import { admin, verifyRequestOrigin } from "@netlify/identity";
import { ApiError, errorResponse, jsonResponse } from "../lib/http.js";
import { staffSignIn } from "../lib/staff-sign-in.js";

export default async (request: Request, _context: Context) => {
  try {
    const result = await staffSignIn(request, {
      verifyOrigin: verifyRequestOrigin,
      identity: admin,
      passwordGrant: async (username, password) => {
        const response = await fetch(new URL("/.netlify/identity/token", request.url), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "password", username, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = data.error_description || data.msg || "No user found with that email, or password invalid.";
          throw new ApiError(401, "invalid_grant", message);
        }
        return data;
      }
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error, { log: console.error });
  }
};

export const config: Config = { path: "/api/staff-sign-in" };
