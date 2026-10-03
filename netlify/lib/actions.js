/*
  Server actions. Each one declares which roles may call it; the dispatcher enforces that
  before the action runs. The role always comes from Netlify Identity (checked live on every call).
  Order actions (book, pay, verify) live in orders.js. Production and dispatch live in dispatch.js.
*/
import { ApiError, asApiError } from "./http.js";
import { ensureProfile, profileFields } from "./profiles.js";
import { roleOf } from "../../js/src/session.js";
import { NETLIFY_ROLE_NAME, SPEC_ROLES, cleanAgreedDeal, toAppRole, toSpecRole } from "../../shared/portal-rules.js";
import { factorySettings, validateSettings } from "../../shared/portal-settings.js";
import { ORDER_ACTIONS, recomputeSlotMonths } from "./orders.js";
import { DISPATCH_ACTIONS } from "./dispatch.js";
import { getStaffLogins, saveStaffLogin } from "./staff-accounts.js";
import { pingTargets, readMode, siteBase, writeMode } from "./warm.js";

const SETTINGS_PATH = "settings/portal";

async function saveSettings(ctx, payload) {
  let clean;
  try {
    clean = validateSettings(payload.settings);
  } catch (error) {
    throw asApiError(error);
  }
  if (clean.paymentQr && (!ctx.files || !(await ctx.files.exists(clean.paymentQr)))) {
    throw new ApiError(400, "invalid", "Upload the payment QR image again.");
  }
  const { db, serverTime } = ctx.firebase();
  // set() without merge: removing a brand in the form really removes it.
  await db.doc(SETTINGS_PATH).set({ ...clean, updated_at: serverTime(), updated_by: ctx.user.id });
  // Factory copy: slot counts and timeline only. Production cannot read the bank document.
  await db.doc("settings/factory").set({ ...factorySettings(clean), updated_at: serverTime() });
  // Slot counts or offline numbers may have changed, so refresh the public slot board now.
  // The settings are already saved; if this refresh fails the 10-minute job repairs it.
  try {
    await recomputeSlotMonths(db, ctx.now());
  } catch (error) {
    (ctx.log || console.error)("slot board refresh after settings failed:", error && error.message);
  }
  return { settings: clean };
}

async function setRole(ctx, payload) {
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const role = payload.role;
  if (!userId || userId.length > 128) throw new ApiError(400, "invalid", "Choose a person first.");
  if (!SPEC_ROLES.includes(role)) throw new ApiError(400, "invalid", "That access level does not exist.");
  if (userId === ctx.user.id) throw new ApiError(400, "invalid", "You cannot change your own access.");

  const { auth, db, serverTime } = ctx.firebase();

  let target;
  try {
    target = await ctx.identity.getUser(userId);
  } catch {
    throw new ApiError(404, "not_found", "That person was not found.");
  }
  if (!target) throw new ApiError(404, "not_found", "That person was not found.");

  // 1. Netlify is the source of truth: replace the roles with exactly the chosen one.
  const update = { app_metadata: { ...(target.appMetadata || {}), roles: [NETLIFY_ROLE_NAME[role]] } };
  // An account-level "role" field would still grant access, so clear it if it carries a portal role.
  const wantedApp = toAppRole(role);
  const accountRole = roleOf({ role: target.role });
  if (target.role && accountRole !== "user" && accountRole !== wantedApp) update.role = "";
  const updated = await ctx.identity.updateUser(userId, update);

  // 2. Check what Netlify now says. If it does not match, do not pretend it worked.
  const after = updated && updated.id ? updated : await ctx.identity.getUser(userId);
  if (roleOf(after) !== wantedApp) {
    throw new ApiError(
      500,
      "role_not_applied",
      "Netlify did not apply that change. Nothing else was changed. Please check the person's roles in Netlify.",
      `Netlify reports roles ${JSON.stringify(after.roles || [])} and role ${JSON.stringify(after.role || "")}.`
    );
  }

  // 3. Mirror into the profile that the Firestore rules read.
  const fields = profileFields(after);
  const ref = db.collection("profiles").doc(userId);
  const snap = await ref.get();
  if (snap.exists) await ref.update({ role: toSpecRole(wantedApp) });
  else await ref.set({ ...fields, role: toSpecRole(wantedApp), created_at: serverTime() });

  // 4. End their old Firebase sessions. A person who was never signed in to Firebase has nothing to end.
  try {
    await auth.revokeRefreshTokens(userId);
  } catch (error) {
    if (!(error && error.code === "auth/user-not-found")) throw error;
  }

  return { id: userId, role: toSpecRole(wantedApp) };
}

const SYNC_PAGE = 100;
const SYNC_MAX_PAGES = 50;

/* Creates missing profiles (and fixes roles) for everyone who signed up before Firebase was connected. */
async function syncProfiles(ctx) {
  const { db, serverTime } = ctx.firebase();
  let created = 0;
  let fixed = 0;
  let seen = 0;
  for (let page = 1; page <= SYNC_MAX_PAGES; page++) {
    const users = await ctx.identity.listUsers({ page, perPage: SYNC_PAGE });
    if (!users || users.length === 0) break;
    for (const user of users) {
      const result = await ensureProfile(db, user, serverTime);
      seen++;
      if (result.created) created++;
      if (result.roleChanged) fixed++;
    }
    if (users.length < SYNC_PAGE) break;
  }
  return { seen, created, fixed };
}

/*
  A self-check Admin can run after setting up Netlify. Reports yes/no and a plain reason.
  It never returns the key or any secret value.
*/
async function checkSetup(ctx) {
  const checks = [];
  const add = (name, ok, note) => checks.push({ name, ok, note });

  let fb = null;
  try {
    fb = ctx.firebase();
    add("Firebase key in Netlify", true, "Found, readable, and for the right project.");
  } catch (error) {
    add("Firebase key in Netlify", false, (error && (error.detail || error.message)) || "Could not read the key.");
  }

  if (fb) {
    try {
      await fb.auth.createCustomToken("setup-check", { role: "customer" });
      add("Signing people in to Firebase", true, "Works.");
    } catch (error) {
      add("Signing people in to Firebase", false, "The key was refused when signing: " + (error && error.message ? error.message : "unknown reason"));
    }
    try {
      // Asking for a person who cannot exist: "not found" proves Authentication is switched on.
      await fb.auth.getUser("setup-check-does-not-exist");
      add("Firebase Authentication switched on", true, "Works.");
    } catch (error) {
      if (error && error.code === "auth/user-not-found") add("Firebase Authentication switched on", true, "Works.");
      else add("Firebase Authentication switched on", false, "Open Firebase console > Authentication > Get started. Details: " + (error && error.message ? error.message : "unknown reason"));
    }
    try {
      const snap = await fb.db.doc(SETTINGS_PATH).get();
      add("Database (Firestore)", true, snap.exists ? "Reachable. Settings have been saved before." : "Reachable. No settings saved yet, so built-in defaults are used.");
    } catch (error) {
      add("Database (Firestore)", false, "Could not read the database: " + (error && error.message ? error.message : "unknown reason"));
    }
  }

  try {
    const users = await ctx.identity.listUsers({ page: 1, perPage: 1 });
    add("Netlify user list", true, Array.isArray(users) ? "Works." : "Responded.");
  } catch (error) {
    add("Netlify user list", false, "Could not read users from Netlify: " + (error && error.message ? error.message : "unknown reason"));
  }

  return { allOk: checks.every((c) => c.ok), checks };
}

async function serverMode(ctx) {
  const { db } = ctx.firebase();
  return { mode: await readMode(db) };
}

/* Admin chooses hot (stay ready, including during a campaign) or cold (sleep when quiet). */
async function saveServerMode(ctx, payload) {
  const mode = payload && payload.mode;
  if (mode !== "hot" && mode !== "cold") throw new ApiError(400, "invalid", "Choose hot or cold.");
  const { db } = ctx.firebase();
  const saved = await writeMode(db, mode, ctx.user.id);
  if (mode === "cold") return { mode, ready: true };
  const pinged = await pingTargets(globalThis.fetch, siteBase(), saved.token);
  return { mode, ready: pinged.length > 0 && pinged.every((row) => row.ok) };
}

/* Admin sets one customer's pack price and batch. Approval fee and GST stay the public rates. */
async function saveCustomerDeal(ctx, payload) {
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId || userId.length > 128) throw new ApiError(400, "invalid", "Choose a customer first.");
  const { db, serverTime } = ctx.firebase();
  const ref = db.collection("profiles").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new ApiError(404, "not_found", "That customer was not found.");
  const current = snap.data() || {};
  if (current.role && current.role !== "customer") throw new ApiError(400, "invalid", "An agreed price is only for a customer.");
  if (payload.clear === true) {
    await ref.update({ deal: null, updated_at: serverTime() });
    return { id: userId, deal: null };
  }
  let deal;
  try {
    deal = cleanAgreedDeal(payload);
  } catch (error) {
    throw asApiError(error);
  }
  await ref.update({ deal, updated_at: serverTime() });
  return { id: userId, deal };
}

export const ACTIONS = {
  saveSettings: { roles: ["admin"], run: saveSettings },
  saveCustomerDeal: { roles: ["admin"], run: saveCustomerDeal },
  serverMode: { roles: ["admin"], run: serverMode },
  saveServerMode: { roles: ["admin"], run: saveServerMode },
  staffLogins: { roles: ["admin"], run: getStaffLogins },
  saveStaffLogin: { roles: ["admin"], run: saveStaffLogin },
  setRole: { roles: ["admin"], run: setRole },
  syncProfiles: { roles: ["admin"], run: syncProfiles },
  checkSetup: { roles: ["admin"], run: checkSetup },
  ...ORDER_ACTIONS,
  ...DISPATCH_ACTIONS
};
