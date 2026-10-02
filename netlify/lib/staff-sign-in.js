/*
  Staff sign-in against Netlify Identity.

  The public password check looks up the email exactly as it is stored, including capital letters.
  The Identity user list shows the account either way, so a lowercased email comes back as
  "no user found" even though the person is there. We look up the stored email first, then
  check the password against that spelling. Only Admin, Production and Account may continue.
*/
import { ApiError } from "./http.js";
import { isStaff, roleOf } from "../../js/src/session.js";

const PAGE = 100;
const MAX_PAGES = 50;
const NOT_FOUND = "No user found with that email, or password invalid.";

export function checkStaffSignIn(body) {
  const email = String((body || {}).email == null ? "" : body.email).trim();
  const password = typeof (body || {}).password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    throw new ApiError(400, "invalid", "Enter your email and password.");
  }
  return { email, password };
}

async function findIdentityUser(identity, email) {
  const want = email.toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const users = await identity.listUsers({ page, perPage: PAGE });
    if (!Array.isArray(users) || users.length === 0) return null;
    const found = users.find((user) => String(user.email || "").toLowerCase() === want);
    if (found) return found;
    if (users.length < PAGE) return null;
  }
  return null;
}

export async function staffSignIn(request, deps) {
  if (request.method !== "POST") throw new ApiError(405, "method", "Use POST.");
  try {
    deps.verifyOrigin(request);
  } catch {
    throw new ApiError(403, "origin", "This request was blocked. Reload the page and try again.");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "invalid", "Enter your email and password.");
  }
  const clean = checkStaffSignIn(body);
  let listed = null;
  try {
    listed = await findIdentityUser(deps.identity, clean.email);
  } catch {
    listed = null;
  }
  const username = listed && listed.email ? listed.email : clean.email;
  let token;
  try {
    token = await deps.passwordGrant(username, clean.password);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "invalid_grant", NOT_FOUND);
  }
  if (!token || !token.access_token) throw new ApiError(401, "invalid_grant", NOT_FOUND);
  const account = listed || {
    id: "",
    email: username,
    roles: [],
    appMetadata: {},
    userMetadata: {}
  };
  if (!isStaff(roleOf(account))) {
    throw new ApiError(403, "forbidden", "This page is for the Eximburg team. Customers sign in on the home page.");
  }
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || "",
    expires_in: Number(token.expires_in) || 3600,
    expires_at: token.expires_at || null,
    user: {
      id: account.id || "",
      email: account.email || username,
      roles: Array.isArray(account.roles) ? account.roles : [],
      role: account.role || "",
      appMetadata: account.appMetadata || {},
      userMetadata: account.userMetadata || {}
    }
  };
}
