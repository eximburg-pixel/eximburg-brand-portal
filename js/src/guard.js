import { getUser, logout } from "@netlify/identity";
import { dashboardFor, pageForRole, profileFrom, roleOf } from "./session.js";

// Each protected page sets <body data-portal="user"> or <body data-portal="team">.
const page = document.body.dataset.portal || "user";

window.portalLogout = async function portalLogout() {
  localStorage.removeItem("exb_session");
  // End the Firebase sign-in too, if this page connected to Firebase.
  try { if (window.exbFirebaseSignOut) await window.exbFirebaseSignOut(); } catch (error) {}
  try { await logout(); } catch (error) {}
  location.replace(page === "team" ? "staff.html" : "home.html");
};

function openPortal(profile) {
  if (typeof window.startPortal === "function") window.startPortal(profile);
}

function cachedProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem("exb_session") || "null");
    return saved && saved.role ? saved : null;
  } catch (error) {
    return null;
  }
}

async function boot() {
  const hash = location.hash;
  if (/recovery_token|invite_token|confirmation_token/.test(hash)) {
    location.replace("home.html" + hash);
    return;
  }
  // The database sign-in can run while Netlify confirms the account. The page does not wait twice.
  if (window.ExbDB && typeof window.ExbDB.prefetchSession === "function") window.ExbDB.prefetchSession();
  const cached = cachedProfile();
  let opened = false;
  if (cached && pageForRole(cached.role) === page) {
    opened = true;
    openPortal(cached);
  }
  let user = null;
  try {
    user = await getUser();
  } catch (error) {
    user = null;
  }
  if (!user) {
    location.replace(page === "team" ? "staff.html" : "home.html");
    return;
  }
  const role = roleOf(user);
  // The page must match the role. user -> user.html. Admin, Production, Account -> team.html.
  if (pageForRole(role) !== page) {
    location.replace(dashboardFor(user));
    return;
  }
  const profile = profileFrom(user);
  localStorage.setItem("exb_session", JSON.stringify(profile));
  if (!opened) openPortal(profile);
}

boot();
