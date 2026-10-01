import {
  acceptInvite,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  oauthLogin,
  requestPasswordRecovery,
  signup,
  updateUser
} from "@netlify/identity";
import { goToDashboard, loginIdForEmail, temporaryPassword } from "./session.js";

const status = document.getElementById("status");
const authPanel = document.getElementById("auth-panel");
const passwordPanel = document.getElementById("password-panel");
const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
const passwordForm = document.getElementById("password-form");
const recoveryForm = document.getElementById("recovery-form");
const tabs = document.querySelectorAll("[data-tab]");
const panels = document.querySelectorAll("[data-panel]");

let inviteToken = "";
let mode = "set";

function say(message, kind) {
  status.hidden = !message;
  status.textContent = message || "";
  status.dataset.kind = kind || "";
}

function showPassword(nextMode, heading, detail) {
  mode = nextMode;
  authPanel.hidden = true;
  passwordForm.hidden = false;
  passwordPanel.hidden = false;
  document.getElementById("password-heading").textContent = heading;
  document.getElementById("password-detail").textContent = detail;
  document.getElementById("new-password").focus();
}

function identityMessage(error) {
  const message = error?.message || "";
  if (error?.name === "MissingIdentityError" || /not found|failed to fetch|network/i.test(message)) {
    return "Netlify Identity is not enabled for this site yet. In the Netlify dashboard open Project configuration, then Identity, choose Enable, and turn Autoconfirm on. Autoconfirm is what lets a new signup open the dashboard immediately.";
  }
  return message || "Login is unavailable right now.";
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function phoneOk(value) {
  return /^[6-9]\d{9}$/.test(value);
}

async function sendSetPasswordMail(email) {
  await requestPasswordRecovery(email);
  sessionStorage.setItem(
    "exb_notice",
    "Your dashboard is open. We emailed you a link to set the password you will use next time."
  );
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.setAttribute("aria-selected", item === tab ? "true" : "false"));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    });
    say("");
  });
});

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("reset-email").value.trim().toLowerCase();
  if (!emailOk(email)) {
    say("Enter the email on your account.", "bad");
    return;
  }
  try {
    await requestPasswordRecovery(email);
    say("If that email has an account, a reset link is on its way.", "ok");
    recoveryForm.reset();
  } catch (error) {
    say(error.message || "The reset email could not be sent.", "bad");
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  if (!emailOk(email) || !password) {
    say("Enter your email and password.", "bad");
    return;
  }
  try {
    const user = await login(email, password);
    goToDashboard(user);
  } catch (error) {
    say(error.message || "Email or password is incorrect.", "bad");
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim().toLowerCase();
  const phone = document.getElementById("signup-phone").value.replace(/\D/g, "");
  const city = document.getElementById("signup-city").value.trim();
  const brand = document.getElementById("signup-brand").value.trim();
  const adult = document.getElementById("signup-adult").checked;
  if (!name) return say("Enter your name.", "bad");
  if (!emailOk(email)) return say("Enter a valid email.", "bad");
  if (!phoneOk(phone)) return say("Enter a 10-digit Indian mobile number.", "bad");
  if (!adult) return say("Please confirm you are 18+.", "bad");

  const button = signupForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const user = await signup(email, temporaryPassword(), {
      full_name: name,
      phone,
      city,
      brand,
      login_id: loginIdForEmail(email)
    });
    if (user.emailVerified) {
      try {
        await sendSetPasswordMail(email);
      } catch (error) {
        sessionStorage.setItem(
          "exb_notice",
          "Your dashboard is open. Use Forgot password on the login page if the set-password email does not arrive."
        );
      }
      goToDashboard(user);
      return;
    }
    say("Account created. Open the confirmation email, then use the set-password link to choose a password. You can enter the dashboard after confirming.", "ok");
  } catch (error) {
    const message = /already|registered|exists/i.test(error.message || "")
      ? "An account with this email already exists. Log in, or reset the password."
      : identityMessage(error);
    say(message, "bad");
  } finally {
    button.disabled = false;
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("new-password").value;
  const confirm = document.getElementById("confirm-password").value;
  if (password.length < 8) return say("Use at least 8 characters.", "bad");
  if (password !== confirm) return say("The two passwords do not match.", "bad");
  const button = passwordForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const user = mode === "invite"
      ? await acceptInvite(inviteToken, password)
      : await updateUser({ password });
    sessionStorage.setItem("exb_notice", "Your password is saved. Use it the next time you log in.");
    goToDashboard(user);
  } catch (error) {
    say(error.message || "The password could not be saved.", "bad");
    button.disabled = false;
  }
});

document.getElementById("oauth").addEventListener("click", (event) => {
  const button = event.target.closest("[data-provider]");
  if (!button) return;
  oauthLogin(button.dataset.provider);
});

async function boot() {
  try {
    const settings = await getSettings();
    if (settings.disableSignup) {
      document.querySelector("[data-tab=signup]").hidden = true;
      document.querySelector("[data-panel=signup]").hidden = true;
      document.querySelector("[data-tab=login]").click();
    }
    const oauth = document.getElementById("oauth");
    for (const [provider, enabled] of Object.entries(settings.providers || {})) {
      if (!enabled || provider === "email") continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost";
      button.dataset.provider = provider;
      button.textContent = "Continue with " + provider.charAt(0).toUpperCase() + provider.slice(1);
      oauth.append(button);
    }

    const callback = await handleAuthCallback();
    if (callback?.type === "recovery") {
      showPassword("set", "Set your password", "Choose the password you will use the next time you log in.");
    } else if (callback?.type === "invite" && callback.token) {
      inviteToken = callback.token;
      showPassword("invite", "Accept your invite", "Set a password to activate this account.");
    } else if (callback?.type === "confirmation" && callback.user?.email) {
      try { await sendSetPasswordMail(callback.user.email); } catch (error) {}
      goToDashboard(callback.user);
    } else if (callback?.user) {
      goToDashboard(callback.user);
    } else {
      const existing = await getUser();
      if (existing) goToDashboard(existing);
      else document.getElementById("signup-name").focus();
    }
  } catch (error) {
    authPanel.hidden = false;
    say(identityMessage(error), "bad");
  }
}

boot();
