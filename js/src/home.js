import { acceptInvite, confirmEmail, getUser, login, logout, recoverPassword, requestPasswordRecovery, updateUser } from "@netlify/identity";
import { persistIdentityCookie } from "../../shared/portal-identity-jwt.js";
import { dashboardFor, isStaff, profileFrom, roleOf, temporaryPassword } from "./session.js";

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

function holdButton(button, en, hi) {
  if (!button || button.getAttribute("aria-busy") === "true") return () => {};
  const previous = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = document.documentElement.lang === "hi" ? hi : en;
  return function release() {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = previous;
  };
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

function setAuthChrome(mode) {
  document.getElementById("corner-login").hidden = mode !== "signup";
  document.getElementById("form-back").hidden = mode !== "signin";
}

function showSignIn() {
  document.getElementById("password-form").hidden = true;
  document.getElementById("signup-form").hidden = true;
  document.getElementById("signin-form").hidden = false;
  setAuthChrome("signin");
  document.getElementById("signin-email").focus();
  say("");
}

function showSignUp() {
  document.getElementById("password-form").hidden = true;
  document.getElementById("signin-form").hidden = true;
  document.getElementById("signup-form").hidden = false;
  setAuthChrome("signup");
  say("");
}

function showPasswordForm() {
  document.getElementById("signup-form").hidden = true;
  document.getElementById("signin-form").hidden = true;
  document.getElementById("password-form").hidden = false;
  setAuthChrome("password");
  document.getElementById("new-password").focus();
  say("");
}

document.getElementById("corner-login").addEventListener("click", () => {
  showSignIn();
});

document.getElementById("form-back").addEventListener("click", () => {
  showSignUp();
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
  const company = document.getElementById("signup-company").value.trim();
  const email = document.getElementById("signup-email").value.trim().toLowerCase();
  const phone = document.getElementById("signup-phone").value.replace(/\D/g, "");
  const city = document.getElementById("signup-city").value.trim();
  const brand = document.getElementById("signup-brand").value.trim();
  const button = event.submitter;
  const release = holdButton(button, "Creating your account…", "खाता बन रहा है…");
  if (!name) { release(); return say("Enter your name."); }
  if (!emailOk(email)) { release(); return say("Enter your email. It is required for login."); }
  if (!phoneOk(phone)) { release(); return say("Enter a 10-digit mobile number."); }
  const password = temporaryPassword();
  try {
    const response = await fetch("/api/open-account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, company, email, phone, city, brand, password })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (body.error && body.error.message) || "The account could not be created.";
      if (response.status === 409) {
        try { await requestPasswordRecovery(email); } catch (error) {}
        showSignIn();
        document.getElementById("signin-email").value = email;
        say("This email already has an account. We sent a link to set your password. Log in after you set it.", true);
        return;
      }
      say(message);
      release();
      return;
    }
    const user = await login(email, password);
    try { await requestPasswordRecovery(email); } catch (error) {}
    enterDashboard(user);
  } catch (error) {
    say(error.message || "The account could not be created. Try again.");
    release();
  }
});

document.getElementById("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("signin-email").value.trim().toLowerCase();
  const password = document.getElementById("signin-password").value;
  const button = event.submitter;
  const release = holdButton(button, "Signing in…", "लॉग इन हो रहा है…");
  if (!emailOk(email) || !password) { release(); return say("Enter your email and the password you set from the email link."); }
  try {
    const user = await login(email, password);
    if (isStaff(roleOf(user))) {
      try { await logout(); } catch (error) {}
      say("This page is for customers. Team members sign in at staff.html.");
      release();
      return;
    }
    enterDashboard(user);
  } catch (error) {
    say(error.message || "Email or password is incorrect. Set your password from the email link first.");
    release();
  }
});

document.getElementById("forgot-password").addEventListener("click", async () => {
  const email = document.getElementById("signin-email").value.trim().toLowerCase();
  const button = document.getElementById("forgot-password");
  const release = holdButton(button, "Sending the link…", "लिंक भेजा जा रहा है…");
  if (!emailOk(email)) { release(); return say("Enter your email, then ask for the password link."); }
  try {
    await requestPasswordRecovery(email);
    say("Check your email and set your password from that link. Then log in.", true);
  } catch (error) {
    say(error.message || "The password email could not be sent.");
  }
  release();
});

document.getElementById("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("new-password").value;
  const confirm = document.getElementById("confirm-password").value;
  const button = event.submitter;
  const release = holdButton(button, "Saving password…", "पासवर्ड सेव हो रहा है…");
  if (password.length < 6) { release(); return say("Use at least 6 characters."); }
  if (password !== confirm) { release(); return say("The two passwords do not match."); }
  const params = hashParams();
  try {
    let user;
    if (params.get("recovery_token")) user = await recoverPassword(params.get("recovery_token"), password);
    else if (params.get("invite_token")) user = await acceptInvite(params.get("invite_token"), password);
    else if (params.get("confirmation_token")) {
      await confirmEmail(params.get("confirmation_token"));
      user = await updateUser({ password });
    } else {
      say("This password link is missing or has already been used. Ask for a new link from Login.");
      release();
      return;
    }
    history.replaceState(null, "", location.pathname + location.search);
    enterDashboard(user);
  } catch (error) {
    say(error.message || "This link has expired. Ask for a new password email from Login.");
    release();
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
