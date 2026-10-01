import { getUser, logout } from "@netlify/identity";
import { dashboardFor, pageForRole, profileFrom, roleOf } from "./session.js";

// Each protected page sets <body data-portal="user"> or <body data-portal="team">.
const page = document.body.dataset.portal || "user";

window.portalLogout = async function portalLogout() {
  localStorage.removeItem("exb_session");
  try { await logout(); } catch (error) {}
  location.replace("home.html");
};

function openPortal(profile) {
  if (typeof window.startPortal === "function") window.startPortal(profile);
}

async function boot() {
  const hash = location.hash;
  if (/recovery_token|invite_token|confirmation_token/.test(hash)) {
    location.replace("home.html" + hash);
    return;
  }
  let user = null;
  try {
    user = await getUser();
  } catch (error) {
    user = null;
  }
  if (!user) {
    location.replace("home.html");
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
  openPortal(profile);
}

boot();
