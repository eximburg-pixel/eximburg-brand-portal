import type { Config, Context } from "@netlify/functions";
import { admin, verifyRequestOrigin } from "@netlify/identity";
import { errorResponse, jsonResponse } from "../lib/http.js";
import { openAccount } from "../lib/open-account.js";

export default async (request: Request, _context: Context) => {
  try {
    const result = await openAccount(request, { verifyOrigin: verifyRequestOrigin, identity: admin });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error, { log: console.error });
  }
};

export const config: Config = { path: "/api/open-account" };
