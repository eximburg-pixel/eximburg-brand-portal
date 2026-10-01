import { getUser, handleAuthCallback, logout } from "@netlify/identity";
import { dashboardFor, profileFrom, roleOf } from "./session.js";

const page = document.body.dataset.portal || "user";

function readSession() {
  try { return JSON.parse(localStorage.getItem("exb_session") || "null"); } catch (error) { return null; }
}

window.portalLogout = async function portalLogout() {
  localStorage.removeItem("exb_session");
  try { await logout(); } catch (error) {}
  location.replace("home.html");
};

function openPortal(profile) {
  if (typeof window.startPortal === "function") window.startPortal(profile);
}

async function boot() {
  let user = null;
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "recovery" || callback?.type === "invite") {
      location.replace("home.html" + location.hash);
      return;
    }
    user = callback?.user || await getUser();
  } catch (error) {
    user = null;
  }
  if (user) {
    const role = roleOf(user);
    if (role !== page) {
      location.replace(dashboardFor(user));
      return;
    }
    openPortal(profileFrom(user));
    return;
  }
  const local = readSession();
  if (local && (local.role || "user") === page) {
    openPortal(local);
    return;
  }
  if (local) {
    location.replace(dashboardFor({ roles: [local.role || "user"] }));
    return;
  }
  location.replace("home.html");
}

boot();
