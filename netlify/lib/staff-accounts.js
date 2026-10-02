/*
  Production and Accounts sign-in, set by Admin.
  Netlify Identity is updated on the same request. The password is kept here so Admin
  can read it back: Identity never returns a password. This document is not readable
  from a browser. Only the Admin action returns it.
*/
import { ApiError } from "./http.js";
import { loginIdForEmail, roleOf } from "../../js/src/session.js";
import { NETLIFY_ROLE_NAME, toAppRole } from "../../shared/portal-rules.js";
import { ensureProfile } from "./profiles.js";

const PATH = "staff_logins/desk";
const PAGE = 100;
const MAX_PAGES = 20;
const DESK = ["production", "accounts"];

export function checkStaffCredential(payload) {
  const role = payload && payload.role;
  if (!DESK.includes(role)) throw new ApiError(400, "invalid", "Choose Production or Accounts.");
  const email = String(payload.email == null ? "" : payload.email).trim().toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "invalid", "Enter a valid email.");
  if (password.length < 8 || password.length > 72) throw new ApiError(400, "invalid", "Use a password of 8 to 72 characters.");
  return { role, email, password };
}

async function eachUser(identity, visit) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const users = await identity.listUsers({ page, perPage: PAGE });
    if (!Array.isArray(users) || users.length === 0) return null;
    const found = users.find(visit);
    if (found) return found;
    if (users.length < PAGE) return null;
  }
  return null;
}

async function findByRole(identity, role) {
  const want = toAppRole(role);
  return eachUser(identity, (user) => roleOf(user) === want);
}

async function findByEmail(identity, email) {
  const want = email.toLowerCase();
  return eachUser(identity, (user) => String(user.email || "").toLowerCase() === want);
}

export async function getStaffLogins(ctx) {
  const { db } = ctx.firebase();
  const snap = await db.doc(PATH).get();
  const stored = snap.exists ? snap.data() || {} : {};
  const logins = {};
  for (const role of DESK) {
    const row = stored[role] || {};
    let email = typeof row.email === "string" ? row.email : "";
    if (row.userId) {
      try {
        const user = await ctx.identity.getUser(row.userId);
        if (user && user.email) email = user.email;
      } catch { /* keep the email we stored */ }
    } else if (!email) {
      const user = await findByRole(ctx.identity, role);
      if (user && user.email) email = user.email;
    }
    logins[role] = { email, password: typeof row.password === "string" ? row.password : "" };
  }
  return { logins };
}

export async function saveStaffLogin(ctx, payload) {
  const clean = checkStaffCredential(payload);
  const { db, auth, serverTime } = ctx.firebase();
  const ref = db.doc(PATH);
  const snap = await ref.get();
  const stored = snap.exists ? snap.data() || {} : {};
  const row = stored[clean.role] || {};

  let user = null;
  if (row.userId) {
    try { user = await ctx.identity.getUser(row.userId); } catch { user = null; }
  }
  if (!user) user = await findByRole(ctx.identity, clean.role);

  const other = await findByEmail(ctx.identity, clean.email);
  if (other && (!user || other.id !== user.id)) {
    throw new ApiError(409, "exists", "That email already belongs to another account.");
  }

  const appRole = toAppRole(clean.role);
  const identityFields = {
    email: clean.email,
    password: clean.password,
    confirm: true,
    app_metadata: { ...((user && user.appMetadata) || {}), roles: [NETLIFY_ROLE_NAME[clean.role]] },
    user_metadata: {
      ...((user && user.userMetadata) || {}),
      full_name: clean.role === "production" ? "Production" : "Accounts",
      login_id: loginIdForEmail(clean.email)
    }
  };

  let saved;
  if (user) saved = await ctx.identity.updateUser(user.id, identityFields);
  else {
    saved = await ctx.identity.createUser({
      email: clean.email,
      password: clean.password,
      data: {
        app_metadata: identityFields.app_metadata,
        user_metadata: identityFields.user_metadata
      }
    });
  }
  const userId = (saved && saved.id) || (user && user.id);
  if (!userId) throw new ApiError(500, "identity", "Netlify did not save that sign-in. Nothing was stored here.");
  if (roleOf(saved && saved.id ? saved : await ctx.identity.getUser(userId)) !== appRole) {
    throw new ApiError(500, "role_not_applied", "Netlify did not apply that role. Check the person's roles in Netlify.");
  }

  await ensureProfile(db, saved && saved.id ? saved : { id: userId, email: clean.email, roles: [NETLIFY_ROLE_NAME[clean.role]], userMetadata: identityFields.user_metadata, appMetadata: identityFields.app_metadata }, serverTime);
  await db.collection("profiles").doc(userId).update({ email: clean.email, role: clean.role });

  try {
    await auth.revokeRefreshTokens(userId);
  } catch (error) {
    if (!(error && error.code === "auth/user-not-found")) throw error;
  }

  const next = {
    ...stored,
    [clean.role]: { userId, email: clean.email, password: clean.password },
    updated_at: serverTime(),
    updated_by: ctx.user.id
  };
  await ref.set(next);
  return { role: clean.role, email: clean.email, password: clean.password };
}
