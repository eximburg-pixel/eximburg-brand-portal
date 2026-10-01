import { getUser, handleAuthCallback, logout } from "@netlify/identity";
import { dashboardFor, profileFrom, roleOf } from "./session.js";

const page = document.body.dataset.portal || "user";

window.portalLogout = async function portalLogout() {
  try { await logout(); } catch (error) {}
  location.replace("home.html");
};

async function boot() {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "recovery" || callback?.type === "invite") {
      location.replace("home.html" + location.hash);
      return;
    }
    const user = callback?.user || await getUser();
    if (!user) {
      location.replace("home.html");
      return;
    }
    const role = roleOf(user);
    if (role !== page) {
      location.replace(dashboardFor(user));
      return;
    }
    if (typeof window.startPortal === "function") window.startPortal(profileFrom(user));
  } catch (error) {
    const root = document.getElementById("root");
    if (root) {
      root.textContent = error.name === "MissingIdentityError" || /not found|failed to fetch/i.test(error.message || "")
        ? "Netlify Identity is not enabled for this site yet."
        : "Your account could not be opened.";
    }
  }
}

boot();
