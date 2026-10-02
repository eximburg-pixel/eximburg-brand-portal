/*
  profiles/{uid}: one document per person, written ONLY by the server.
  The Firestore rules read the "role" in this document to decide who is staff,
  so changing a role here takes effect at once (no waiting for an old token to expire).
  uid = the Netlify Identity user id.
*/
import { profileFrom, roleOf } from "../../js/src/session.js";
import { toSpecRole } from "../../shared/portal-rules.js";

const clip = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/* Builds the profile fields from a Netlify user. The role is taken from Netlify. */
export function profileFields(user) {
  const p = profileFrom(user);
  return {
    name: clip(p.name, 120),
    company: clip(p.company, 120),
    email: clip(p.email, 160),
    phone: clip(p.phone, 20),
    city: clip(p.city, 80),
    brand: clip(p.brand, 120),
    login_id: clip(p.loginId, 60),
    role: toSpecRole(roleOf(user))
  };
}

function createdAtOf(user, serverTime) {
  const parsed = user && user.createdAt ? new Date(user.createdAt) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : serverTime();
}

/*
  Makes sure the profile exists and its role matches Netlify.
  Returns { profile, created, roleChanged }. Writes only when something changed.
*/
export async function ensureProfile(db, user, serverTime) {
  const ref = db.collection("profiles").doc(user.id);
  const snap = await ref.get();
  const fields = profileFields(user);
  if (!snap.exists) {
    await ref.set({ ...fields, created_at: createdAtOf(user, serverTime) });
    return { profile: { id: user.id, ...fields }, created: true, roleChanged: false };
  }
  const current = snap.data() || {};
  const patch = {};
  if (current.role !== fields.role) patch.role = fields.role;
  // Fill a company collected at sign-up when the profile was created before that field existed.
  if (!String(current.company || "").trim() && fields.company) patch.company = fields.company;
  if (Object.keys(patch).length) {
    await ref.update(patch);
    return { profile: { id: user.id, ...current, ...patch }, created: false, roleChanged: patch.role != null };
  }
  return { profile: { id: user.id, ...current }, created: false, roleChanged: false };
}
