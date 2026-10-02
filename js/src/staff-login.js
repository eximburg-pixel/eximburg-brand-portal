import { getUser, logout, requestPasswordRecovery } from "@netlify/identity";
import { dashboardFor, isStaff, profileFrom, roleOf } from "./session.js";

const status = document.getElementById("form-status");

function say(message, ok) {
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("ok", Boolean(ok));
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function remember(result) {
  const user = result.user || {};
  const token = {
    access_token: result.access_token,
    token_type: "bearer",
    expires_in: result.expires_in,
    refresh_token: result.refresh_token || "",
    expires_at: result.expires_at
  };
  localStorage.setItem("gotrue.user", JSON.stringify({
    url: location.origin + "/.netlify/identity",
    token,
    id: user.id || "",
    email: user.email || "",
    app_metadata: user.appMetadata || {},
    user_metadata: user.userMetadata || {},
    role: user.role || ""
  }));
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = "nf_jwt=" + encodeURIComponent(result.access_token) + "; path=/; samesite=lax" + secure;
  if (result.refresh_token) {
    document.cookie = "nf_refresh=" + encodeURIComponent(result.refresh_token) + "; path=/; samesite=lax" + secure;
  }
  const sessionUser = {
    id: user.id,
    email: user.email,
    roles: user.roles,
    role: user.role,
    appMetadata: user.appMetadata,
    userMetadata: user.userMetadata
  };
  localStorage.setItem("exb_session", JSON.stringify(profileFrom(sessionUser)));
  location.replace(dashboardFor(sessionUser));
}

document.getElementById("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  if (!emailOk(email) || !password) return say("Enter your email and password.");
  const button = event.submitter;
  button.disabled = true;
  try {
    const response = await fetch("/api/staff-sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      say((body.error && body.error.message) || "Email or password is incorrect.");
      button.disabled = false;
      return;
    }
    remember(body);
  } catch (error) {
    say(error.message || "Email or password is incorrect.");
    button.disabled = false;
  }
});

document.getElementById("forgot-password").addEventListener("click", async () => {
  const email = document.getElementById("signin-email").value.trim();
  if (!emailOk(email)) return say("Enter your email, then ask for the password link.");
  const button = document.getElementById("forgot-password");
  button.disabled = true;
  try {
    await requestPasswordRecovery(email);
    say("Check your email and set your password from that link. Then sign in here.", true);
  } catch (error) {
    say(error.message || "The password email could not be sent.");
  }
  button.disabled = false;
});

async function boot() {
  try {
    const existing = await getUser();
    if (!existing) return;
    if (isStaff(roleOf(existing))) {
      localStorage.setItem("exb_session", JSON.stringify(profileFrom(existing)));
      location.replace(dashboardFor(existing));
    }
    else {
      try { await logout(); } catch (error) {}
      say("This page is for the Eximburg team. Customers sign in on the home page.");
    }
  } catch (error) {}
}

boot();
