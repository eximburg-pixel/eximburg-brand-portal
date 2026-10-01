import test from "node:test";
import assert from "node:assert/strict";
import { getUserFromRequest, jwtFromRequest, userFromGoTrue } from "../netlify/lib/identity-request.js";

const SITE = "https://eximburg-brand-portal.netlify.app";

function req(headers) {
  return new Request(SITE + "/api/session", { method: "POST", headers });
}

test("the JWT is taken from Authorization first, then the nf_jwt cookie", () => {
  assert.equal(jwtFromRequest(req({ authorization: "Bearer tok-a" })), "tok-a");
  assert.equal(jwtFromRequest(req({ cookie: "nf_jwt=tok-b; other=1" })), "tok-b");
  assert.equal(jwtFromRequest(req({ authorization: "Bearer tok-a", cookie: "nf_jwt=tok-b" })), "tok-a");
  assert.equal(jwtFromRequest(req({ cookie: "nf_jwt=" + encodeURIComponent("tok with space") })), "tok with space");
  assert.equal(jwtFromRequest(req({})), "");
});

test("GoTrue /user JSON becomes the same user shape the rest of the server already uses", () => {
  const user = userFromGoTrue({
    id: "u1",
    email: "eximburg@gmail.com",
    created_at: "2026-01-01T00:00:00Z",
    role: "",
    user_metadata: { full_name: "Hitesh", phone: "9978239977" },
    app_metadata: { provider: "email", roles: ["Admin"] }
  });
  assert.equal(user.id, "u1");
  assert.equal(user.email, "eximburg@gmail.com");
  assert.deepEqual(user.roles, ["Admin"]);
  assert.equal(user.userMetadata.phone, "9978239977");
  assert.equal(userFromGoTrue({}), null);
});

test("getUserFromRequest asks Identity /user with that JWT and returns null when Identity refuses it", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (opts.headers.Authorization === "Bearer good") {
      return new Response(JSON.stringify({ id: "u1", email: "a@b.c", app_metadata: { roles: ["Admin"] }, user_metadata: {} }), { status: 200 });
    }
    return new Response("{}", { status: 401 });
  };
  const ok = await getUserFromRequest(req({ authorization: "Bearer good" }), { fetchImpl });
  assert.equal(ok.id, "u1");
  assert.deepEqual(ok.roles, ["Admin"]);
  assert.equal(calls[0].url, SITE + "/.netlify/identity/user");
  const bad = await getUserFromRequest(req({ authorization: "Bearer stale" }), { fetchImpl });
  assert.equal(bad, null);
  const none = await getUserFromRequest(req({}), { fetchImpl });
  assert.equal(none, null);
  assert.equal(calls.length, 2);
});
