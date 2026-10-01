import { getUser, logout } from "@netlify/identity";
import { dashboardFor, profileFrom, roleOf } from "./session.js";

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
  if (user) {
    const role = roleOf(user);
    if (role !== page) {
      location.replace(dashboardFor(user));
      return;
    }
    localStorage.setItem("exb_session", JSON.stringify(profileFrom(user)));
    openPortal(profileFrom(user));
    return;
  }
  location.replace("home.html");
}

boot();
