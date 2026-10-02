import test from "node:test";
import assert from "node:assert/strict";
import { staffSignIn } from "../netlify/lib/staff-sign-in.js";
import { makeRequest, verifyOrigin } from "./helpers/fakes.mjs";

function identity(users) {
  return {
    async listUsers() {
      return users;
    }
  };
}

function grant(accepted) {
  const calls = [];
  return {
    calls,
    async passwordGrant(username, password) {
      calls.push(username);
      const row = accepted.find((item) => item.email === username && item.password === password);
      if (!row) {
        const error = new Error("No user found with that email, or password invalid.");
        error.status = 401;
        throw Object.assign(error, { code: "invalid_grant" });
      }
      return { access_token: "token-" + username, refresh_token: "refresh", expires_in: 3600 };
    }
  };
}

const admin = {
  id: "admin-1",
  email: "Admin@Eximburg.com",
  roles: ["Admin"],
  appMetadata: { provider: "email", roles: ["Admin"] },
  userMetadata: { full_name: "Hitesh" }
};

test("staff sign-in uses the email spelling stored in Identity", async () => {
  const passwords = grant([{ email: admin.email, password: "correct-password" }]);
  const result = await staffSignIn(
    makeRequest("/api/staff-sign-in", { body: { email: "admin@eximburg.com", password: "correct-password" } }),
    { verifyOrigin, identity: identity([admin]), passwordGrant: passwords.passwordGrant }
  );
  assert.deepEqual(passwords.calls, ["Admin@Eximburg.com"]);
  assert.equal(result.access_token, "token-Admin@Eximburg.com");
  assert.equal(result.user.email, "Admin@Eximburg.com");
  assert.deepEqual(result.user.roles, ["Admin"]);
  assert.equal(JSON.stringify(result).includes("correct-password"), false);
});

test("a customer password is not a staff login", async () => {
  const customer = {
    id: "cust-1",
    email: "asha@example.com",
    roles: ["user"],
    appMetadata: { roles: ["user"] },
    userMetadata: {}
  };
  const passwords = grant([{ email: customer.email, password: "customer-password" }]);
  await assert.rejects(
    staffSignIn(
      makeRequest("/api/staff-sign-in", { body: { email: "asha@example.com", password: "customer-password" } }),
      { verifyOrigin, identity: identity([customer]), passwordGrant: passwords.passwordGrant }
    ),
    (error) => error.status === 403 && /team/i.test(error.message)
  );
});

test("a wrong password stays the Identity not-found message", async () => {
  const passwords = grant([]);
  await assert.rejects(
    staffSignIn(
      makeRequest("/api/staff-sign-in", { body: { email: "admin@eximburg.com", password: "wrong-password" } }),
      { verifyOrigin, identity: identity([admin]), passwordGrant: passwords.passwordGrant }
    ),
    (error) => error.status === 401 && /No user found/.test(error.message)
  );
  assert.deepEqual(passwords.calls, ["Admin@Eximburg.com"]);
});
