import test from "node:test";
import assert from "node:assert/strict";
import { openAccount } from "../netlify/lib/open-account.js";
import { makeRequest, verifyOrigin } from "./helpers/fakes.mjs";

function identity() {
  const created = [];
  return {
    created,
    async createUser(input) {
      if (created.some((u) => u.email === input.email)) {
        const error = new Error("A user with this email address has already been registered");
        error.status = 422;
        throw error;
      }
      created.push(input);
      return { id: "new-user", email: input.email };
    }
  };
}

const body = {
  name: "Asha Patel", company: "Acme Traders", email: "Asha@Example.com", phone: "9876543210",
  city: "Surat", brand: "Urban Leaf", password: "Aa1!correct-horse"
};

test("a new account is confirmed through the admin API and the password is not returned", async () => {
  const idn = identity();
  const res = await openAccount(makeRequest("/api/open-account", { body }), { verifyOrigin, identity: idn });
  assert.deepEqual(res, { ok: true });
  assert.equal(idn.created.length, 1);
  assert.equal(idn.created[0].email, "asha@example.com");
  assert.equal(idn.created[0].data.user_metadata.full_name, "Asha Patel");
  assert.equal(idn.created[0].data.user_metadata.company, "Acme Traders");
  assert.equal(idn.created[0].data.user_metadata.login_id.startsWith("EXB-"), true);
  assert.equal(JSON.stringify(res).includes(body.password), false);
});

test("an email that already has an account is refused without resetting it", async () => {
  const idn = identity();
  const deps = { verifyOrigin, identity: idn };
  await openAccount(makeRequest("/api/open-account", { body }), deps);
  await assert.rejects(
    openAccount(makeRequest("/api/open-account", { body: { ...body, password: "different-password-1" } }), deps),
    (error) => error.status === 409 && error.message === "This email already has an account."
  );
  assert.equal(idn.created.length, 1);
  assert.equal(idn.created[0].password, body.password);
});
