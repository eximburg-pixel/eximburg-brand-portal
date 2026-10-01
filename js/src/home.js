import { acceptInvite, confirmEmail, getUser, login, logout, recoverPassword, requestPasswordRecovery, signup, updateUser } from "@netlify/identity";
import { persistIdentityCookie } from "../../shared/portal-identity-jwt.js";
import { dashboardFor, loginIdForEmail, profileFrom, temporaryPassword } from "./session.js";

const status = document.getElementById("form-status");

function say(message, ok) {
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("ok", Boolean(ok));
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function phoneOk(value) {
  return /^[6-9]\d{9}$/.test(value);
}

function hashParams() {
  return new URLSearchParams(location.hash.replace(/^#/, ""));
}

function enterDashboard(user) {
  persistIdentityCookie();
  const profile = profileFrom(user);
  localStorage.setItem("exb_session", JSON.stringify(profile));
  // user -> user.html. Admin, Production, Account -> team.html (decided by the role in Netlify).
  location.replace(dashboardFor(user));
}

function showSignIn() {
  document.getElementById("password-form").hidden = true;
  document.getElementById("signup-form").hidden = true;
  document.getElementById("signin-form").hidden = false;
  document.getElementById("signin-email").focus();
  say("");
}

function showSignUp() {
  document.getElementById("password-form").hidden = true;
  document.getElementById("signin-form").hidden = true;
  document.getElementById("signup-form").hidden = false;
  say("");
}

function showPasswordForm() {
  document.getElementById("signup-form").hidden = true;
  document.getElementById("signin-form").hidden = true;
  document.getElementById("password-form").hidden = false;
  document.getElementById("new-password").focus();
  say("");
}

document.getElementById("corner-login").addEventListener("click", () => {
  if (document.getElementById("signin-form").hidden) showSignIn();
  else showSignUp();
});

document.getElementById("toggle-password").addEventListener("click", () => {
  const input = document.getElementById("new-password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  document.getElementById("toggle-password").textContent = show ? "Hide" : "Show";
});

document.querySelectorAll("[data-lang]").forEach((button) => {
  button.addEventListener("click", () => {
    const lang = button.dataset.lang;
    document.documentElement.lang = lang === "hi" ? "hi" : "en";
    document.querySelectorAll("[data-lang]").forEach((item) => {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
    document.querySelectorAll("[data-en]").forEach((node) => {
      node.textContent = lang === "hi" ? node.dataset.hi : node.dataset.en;
    });
    try {
      const saved = JSON.parse(localStorage.getItem("exb_brand_portal_final") || "{}");
      saved.lang = lang;
      localStorage.setItem("exb_brand_portal_final", JSON.stringify(saved));
    } catch (error) {}
  });
});

document.getElementById("signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim().toLowerCase();
  const phone = document.getElementById("signup-phone").value.replace(/\D/g, "");
  const city = document.getElementById("signup-city").value.trim();
  const brand = document.getElementById("signup-brand").value.trim();
  if (!name) return say("Enter your name.");
  if (!emailOk(email)) return say("Enter your email. It is required for login.");
  if (!phoneOk(phone)) return say("Enter a 10-digit mobile number.");
  const button = event.submitter;
  button.disabled = true;
  const loginId = loginIdForEmail(email);
  try {
    await signup(email, temporaryPassword(), {
      full_name: name,
      phone,
      city,
      brand,
      login_id: loginId
    });
    try { await logout(); } catch (error) {}
    try {
      await requestPasswordRecovery(email);
    } catch (error) {}
    showSignIn();
    document.getElementById("signin-email").value = email;
    say("Check your email. Set your password from that link, then log in with this email.", true);
  } catch (error) {
    const message = error.message || "";
    if (/already|registered|exists/i.test(message)) {
      try {
        await requestPasswordRecovery(email);
        showSignIn();
        document.getElementById("signin-email").value = email;
        say("This email already has an account. We sent a link to set your password. Log in after you set it.", true);
        return;
      } catch (sendError) {
        say(sendError.message || "This email already has an account. Use Login.");
      }
    } else {
      say(message || "The account could not be created.");
    }
    button.disabled = false;
  }
});

document.getElementById("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("signin-email").value.trim().toLowerCase();
  const password = document.getElementById("signin-password").value;
  if (!emailOk(email) || !password) return say("Enter your email and the password you set from the email link.");
  const button = event.submitter;
  button.disabled = true;
  try {
    const user = await login(email, password);
    enterDashboard(user);
  } catch (error) {
    say(error.message || "Email or password is incorrect. Set your password from the email link first.");
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
    say("Check your email and set your password from that link. Then log in.", true);
  } catch (error) {
    say(error.message || "The password email could not be sent.");
  }
  button.disabled = false;
});

document.getElementById("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("new-password").value;
  const confirm = document.getElementById("confirm-password").value;
  if (password.length < 6) return say("Use at least 6 characters.");
  if (password !== confirm) return say("The two passwords do not match.");
  const params = hashParams();
  const button = event.submitter;
  button.disabled = true;
  try {
    let user;
    if (params.get("recovery_token")) user = await recoverPassword(params.get("recovery_token"), password);
    else if (params.get("invite_token")) user = await acceptInvite(params.get("invite_token"), password);
    else if (params.get("confirmation_token")) {
      await confirmEmail(params.get("confirmation_token"));
      user = await updateUser({ password });
    } else {
      say("This password link is missing or has already been used. Ask for a new link from Login.");
      button.disabled = false;
      return;
    }
    history.replaceState(null, "", location.pathname + location.search);
    enterDashboard(user);
  } catch (error) {
    say(error.message || "This link has expired. Ask for a new password email from Login.");
    button.disabled = false;
  }
});

async function boot() {
  const params = hashParams();
  if (params.get("recovery_token") || params.get("invite_token") || params.get("confirmation_token")) {
    showPasswordForm();
    return;
  }
  try {
    const existing = await getUser();
    if (existing) enterDashboard(existing);
  } catch (error) {}
}

boot();
