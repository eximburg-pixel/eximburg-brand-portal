/*
  Creates a confirmed customer account and returns nothing secret.

  Netlify's public sign-up sends a confirmation email, and the password page on that
  link fails while the email is still unconfirmed. Admin createUser confirms the
  person immediately, so the browser can log them in and open the dashboard.
  The browser then sends the password-reset email itself.
*/
import { ApiError } from "./http.js";
import { loginIdForEmail } from "../../js/src/session.js";

function clip(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function checkOpenAccount(body) {
  const x = body || {};
  const name = clip(x.name, 80);
  const email = clip(x.email, 160).toLowerCase();
  const phone = String(x.phone == null ? "" : x.phone).replace(/\D/g, "").slice(-10);
  const password = typeof x.password === "string" ? x.password : "";
  if (!name) throw new ApiError(400, "invalid", "Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "invalid", "Enter your email. It is required for login.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, "invalid", "Enter a 10-digit mobile number.");
  if (password.length < 8 || password.length > 72) throw new ApiError(400, "invalid", "The account could not be created.");
  return {
    name,
    company: clip(x.company, 120),
    email,
    phone,
    city: clip(x.city, 60),
    brand: clip(x.brand, 40),
    password
  };
}

function alreadyRegistered(error) {
  const message = String(error && error.message || "");
  return /already|registered|exists|duplicate/i.test(message);
}

export async function openAccount(request, deps) {
  if (request.method !== "POST") throw new ApiError(405, "method", "Use POST.");
  try {
    deps.verifyOrigin(request);
  } catch {
    throw new ApiError(403, "origin", "This request was blocked. Reload the page and try again.");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "invalid", "The account could not be created.");
  }
  const clean = checkOpenAccount(body);
  try {
    await deps.identity.createUser({
      email: clean.email,
      password: clean.password,
      data: {
        app_metadata: { provider: "email", roles: ["user"] },
        user_metadata: {
          full_name: clean.name,
          company: clean.company,
          phone: clean.phone,
          city: clean.city,
          brand: clean.brand,
          login_id: loginIdForEmail(clean.email)
        }
      }
    });
  } catch (error) {
    if (alreadyRegistered(error)) throw new ApiError(409, "exists", "This email already has an account.");
    throw new ApiError(400, "invalid", "The account could not be created.");
  }
  return { ok: true };
}
