import { getUser, login, signup } from "@netlify/identity";
import { dashboardFor, loginIdForEmail, profileFrom } from "./session.js";

const ACCOUNTS = "exb_accounts";
const status = document.getElementById("form-status");

function say(message) {
  status.hidden = !message;
  status.textContent = message || "";
}

function accounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS) || "[]"); } catch (error) { return []; }
}

function saveAccounts(list) {
  localStorage.setItem(ACCOUNTS, JSON.stringify(list));
}

async function hashPassword(password) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function phoneOk(value) {
  return /^[6-9]\d{9}$/.test(value);
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function enterDashboard(profile) {
  localStorage.setItem("exb_session", JSON.stringify(profile));
  location.replace("user.html");
}

function showSignIn() {
  document.getElementById("signup-form").hidden = true;
  document.getElementById("signin-form").hidden = false;
  document.getElementById("tab-signup").setAttribute("aria-selected", "false");
  document.getElementById("tab-signin").setAttribute("aria-selected", "true");
  document.getElementById("signin-id").focus();
  say("");
}

function showSignUp() {
  document.getElementById("signin-form").hidden = true;
  document.getElementById("signup-form").hidden = false;
  document.getElementById("tab-signin").setAttribute("aria-selected", "false");
  document.getElementById("tab-signup").setAttribute("aria-selected", "true");
  say("");
}

document.getElementById("corner-login").addEventListener("click", showSignIn);
document.getElementById("tab-signin").addEventListener("click", showSignIn);
document.getElementById("tab-signup").addEventListener("click", showSignUp);

document.getElementById("toggle-password").addEventListener("click", () => {
  const input = document.getElementById("signup-password");
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
  const phone = document.getElementById("signup-phone").value.replace(/\D/g, "");
  const password = document.getElementById("signup-password").value;
  const city = document.getElementById("signup-city").value.trim();
  const email = document.getElementById("signup-email").value.trim().toLowerCase();
  const brand = document.getElementById("signup-brand").value.trim();
  if (!name) return say("Enter your name.");
  if (!phoneOk(phone)) return say("Enter a 10-digit mobile number.");
  if (password.length < 6) return say("Use at least 6 characters for the password.");
  if (email && !emailOk(email)) return say("Enter a valid email, or leave it blank.");
  const button = event.submitter;
  button.disabled = true;
  try {
    const passwordHash = await hashPassword(password);
    const loginId = loginIdForEmail(email || phone);
    const profile = { name, email, phone, city, brand, role: "user", loginId };
    const list = accounts().filter((item) => item.phone !== phone && item.email !== email);
    list.push({ ...profile, passwordHash });
    saveAccounts(list);
    if (email) {
      try {
        const user = await signup(email, password, {
          full_name: name,
          phone,
          city,
          brand,
          login_id: loginId
        });
        if (user?.email) profile.email = user.email;
      } catch (error) {
        if (/already|registered|exists/i.test(error.message || "")) {
          say("An account with this email already exists. Use Login to sign in.");
          button.disabled = false;
          return;
        }
      }
    }
    enterDashboard(profile);
  } catch (error) {
    say(error.message || "The account could not be created.");
    button.disabled = false;
  }
});

document.getElementById("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("signin-id").value.trim();
  const password = document.getElementById("signin-password").value;
  if (!id || !password) return say("Enter your mobile number or email, and your password.");
  const button = event.submitter;
  button.disabled = true;
  try {
    if (id.includes("@")) {
      const user = await login(id.toLowerCase(), password);
      const profile = profileFrom(user);
      localStorage.setItem("exb_session", JSON.stringify(profile));
      location.replace(profile.role === "user" ? "user.html" : dashboardFor(user));
      return;
    }
    const phone = id.replace(/\D/g, "");
    const passwordHash = await hashPassword(password);
    const account = accounts().find((item) => item.phone === phone && item.passwordHash === passwordHash);
    if (!account) {
      say("That mobile number and password do not match.");
      button.disabled = false;
      return;
    }
    enterDashboard({
      name: account.name,
      email: account.email || "",
      phone: account.phone,
      city: account.city || "",
      brand: account.brand || "",
      role: "user",
      loginId: account.loginId
    });
  } catch (error) {
    say(error.message || "Email or password is incorrect.");
    button.disabled = false;
  }
});

async function resumeSession() {
  try {
    const existing = await getUser();
    if (!existing) return;
    const profile = profileFrom(existing);
    localStorage.setItem("exb_session", JSON.stringify(profile));
    location.replace(profile.role === "user" ? "user.html" : dashboardFor(existing));
  } catch (error) {}
}

resumeSession();
