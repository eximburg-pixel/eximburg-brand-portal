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

export function roleOf(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (roles.includes("admin")) return "admin";
  if (roles.includes("sales")) return "sales";
  if (roles.includes("production")) return "production";
  return "user";
}

export function dashboardFor(user) {
  const role = roleOf(user);
  if (role === "admin") return "admin.html";
  if (role === "sales") return "sales.html";
  if (role === "production") return "production.html";
  return "index.html";
}

export function profileFrom(user) {
  const meta = user?.userMetadata || {};
  const email = user?.email || "";
  return {
    name: meta.full_name || user?.name || email,
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
