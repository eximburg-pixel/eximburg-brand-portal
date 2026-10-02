import { getUser, login, logout, requestPasswordRecovery } from "@netlify/identity";
import { persistIdentityCookie } from "../../shared/portal-identity-jwt.js";
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

function enterTeam(user) {
  persistIdentityCookie();
  localStorage.setItem("exb_session", JSON.stringify(profileFrom(user)));
  location.replace(dashboardFor(user));
}

document.getElementById("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("signin-email").value.trim().toLowerCase();
  const password = document.getElementById("signin-password").value;
  if (!emailOk(email) || !password) return say("Enter your email and password.");
  const button = event.submitter;
  button.disabled = true;
  try {
    const user = await login(email, password);
    if (!isStaff(roleOf(user))) {
      try { await logout(); } catch (error) {}
      say("This page is for the Eximburg team. Customers sign in on the home page.");
      button.disabled = false;
      return;
    }
    enterTeam(user);
  } catch (error) {
    say(error.message || "Email or password is incorrect.");
    button.disabled = false;
  }
});

document.getElementById("forgot-password").addEventListener("click", async () => {
  const email = document.getElementById("signin-email").value.trim().toLowerCase();
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
    if (isStaff(roleOf(existing))) enterTeam(existing);
    else {
      try { await logout(); } catch (error) {}
      say("This page is for the Eximburg team. Customers sign in on the home page.");
    }
  } catch (error) {}
}

boot();
