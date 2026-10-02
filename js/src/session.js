export function loginIdForEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const local = (value.split("@")[0] || "user").replace(/[^a-z0-9]/g, "").slice(0, 10) || "user";
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const code = (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  return "EXB-" + local + "-" + code;
}

export function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let password = "Aa1!";
  for (const byte of bytes) password += alphabet[byte % alphabet.length];
  return password;
}

/*
  Roles
  Netlify role names (exact):  user, Admin, Production, Account
  Names used inside the app:   user, admin, production, accounts
  Matching ignores capital letters, so "Admin" and "admin" are the same role.
  A role name that is not listed here (for example the old "sales") is NOT a staff role.
  That person is treated as a plain user, which is the safest result.
*/
const ROLE_NAMES = {
  user: "user",
  admin: "admin",
  production: "production",
  account: "accounts",
  accounts: "accounts"
};

// If someone holds more than one role, the first match in this list wins.
const STAFF_PRIORITY = ["admin", "accounts", "production"];

export const STAFF_ROLES = STAFF_PRIORITY.slice();

export function normalizeRole(value) {
  return ROLE_NAMES[String(value == null ? "" : value).trim().toLowerCase()] || "";
}

function roleNamesOf(user) {
  const names = [];
  if (Array.isArray(user?.roles)) names.push(...user.roles);
  if (Array.isArray(user?.appMetadata?.roles)) names.push(...user.appMetadata.roles);
  if (typeof user?.role === "string") names.push(user.role);
  return names;
}

export function roleOf(user) {
  const found = new Set(roleNamesOf(user).map(normalizeRole).filter(Boolean));
  for (const role of STAFF_PRIORITY) {
    if (found.has(role)) return role;
  }
  return "user";
}

export function isStaff(role) {
  return STAFF_PRIORITY.includes(role);
}

// Which page each role opens. Staff share one page (team.html); it shows tabs by role.
export function pageForRole(role) {
  return isStaff(role) ? "team" : "user";
}

export function dashboardFor(user) {
  return pageForRole(roleOf(user)) + ".html";
}

export function profileFrom(user) {
  const meta = user?.userMetadata || {};
  const email = user?.email || "";
  return {
    id: user?.id || "",
    name: meta.full_name || user?.name || email,
    company: meta.company || "",
    email,
    phone: meta.phone || "",
    city: meta.city || "",
    brand: meta.brand || "",
    role: roleOf(user),
    loginId: meta.login_id || loginIdForEmail(email)
  };
}

export function goToDashboard(user) {
  location.replace(dashboardFor(user));
}
