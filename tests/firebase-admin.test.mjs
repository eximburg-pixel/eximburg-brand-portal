import test from "node:test";
import assert from "node:assert/strict";
import { FIREBASE_PROJECT_ID, parseServiceAccount } from "../netlify/lib/firebase-admin.js";
import { ApiError } from "../netlify/lib/http.js";

const FAKE_KEY = "-----BEGIN PRIVATE KEY-----\nTESTONLYNOTREAL\n-----END PRIVATE KEY-----\n";
const good = () => ({ type: "service_account", project_id: FIREBASE_PROJECT_ID, client_email: "x@y.iam.gserviceaccount.com", private_key: FAKE_KEY });

const detail = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ApiError); assert.equal(e.status, 503); assert.equal(e.code, "server_config"); return e.detail; } throw new Error("did not throw"); };

test("accepts the key as JSON", () => {
  const a = parseServiceAccount(JSON.stringify(good()));
  assert.equal(a.projectId, FIREBASE_PROJECT_ID);
  assert.equal(a.clientEmail, "x@y.iam.gserviceaccount.com");
  assert.ok(a.privateKey.includes("BEGIN PRIVATE KEY"));
});

test("accepts the key as an already-parsed object", () => {
  const a = parseServiceAccount(good());
  assert.equal(a.projectId, FIREBASE_PROJECT_ID);
  assert.equal(a.clientEmail, "x@y.iam.gserviceaccount.com");
});

test("accepts double-encoded JSON (a JSON string stored inside JSON)", () => {
  const a = parseServiceAccount(JSON.stringify(JSON.stringify(good())));
  assert.equal(a.projectId, FIREBASE_PROJECT_ID);
});

test("accepts the key as base64 JSON", () => {
  const a = parseServiceAccount(Buffer.from(JSON.stringify(good())).toString("base64"));
  assert.equal(a.projectId, FIREBASE_PROJECT_ID);
});

test("repairs keys whose line breaks were stored as the two characters \\n", () => {
  const g = good();
  g.private_key = "-----BEGIN PRIVATE KEY-----\\nTESTONLYNOTREAL\\n-----END PRIVATE KEY-----\\n";
  const a = parseServiceAccount(JSON.stringify(g));
  assert.ok(a.privateKey.includes("\n"));
  assert.ok(!a.privateKey.includes("\\n"));
});

test("repairs JSON that has real line breaks inside private_key (Netlify env paste)", () => {
  const broken = [
    "{",
    '  "type": "service_account",',
    `  "project_id": "${FIREBASE_PROJECT_ID}",`,
    '  "client_email": "x@y.iam.gserviceaccount.com",',
    '  "private_key": "-----BEGIN PRIVATE KEY-----',
    "TESTONLYNOTREAL",
    '-----END PRIVATE KEY-----\\n"',
    "}"
  ].join("\n");
  const a = parseServiceAccount(broken);
  assert.equal(a.projectId, FIREBASE_PROJECT_ID);
  assert.ok(a.privateKey.includes("BEGIN PRIVATE KEY"));
  assert.ok(a.privateKey.includes("\n"));
});

test("accepts JSON with a BOM and extra spaces", () => {
  const a = parseServiceAccount("\uFEFF  " + JSON.stringify(good()) + "  ");
  assert.equal(a.projectId, FIREBASE_PROJECT_ID);
});

test("a PEM-only paste is refused with a specific reason", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nTESTONLYNOTREAL\n-----END PRIVATE KEY-----\n";
  assert.match(detail(() => parseServiceAccount(pem)), /PEM private key/);
});

test("says what is wrong for each kind of mistake", () => {
  assert.match(detail(() => parseServiceAccount(undefined)), /not set/);
  assert.match(detail(() => parseServiceAccount("   ")), /not set/);
  assert.match(detail(() => parseServiceAccount("{not json")), /not valid JSON/);
  assert.match(detail(() => parseServiceAccount(JSON.stringify({ ...good(), type: "authorized_user" }))), /service-account key/);
  assert.match(detail(() => parseServiceAccount(JSON.stringify({ ...good(), client_email: "" }))), /client_email/);
  assert.match(detail(() => parseServiceAccount(JSON.stringify({ ...good(), private_key: "nope" }))), /does not look like a key/);
  assert.match(detail(() => parseServiceAccount(JSON.stringify({ ...good(), project_id: "other-project" }))), /other-project/);
});

test("the customer-facing message never carries technical detail or the key", () => {
  try { parseServiceAccount(JSON.stringify({ ...good(), project_id: "other-project" })); } catch (e) {
    assert.equal(e.message, "The portal is still being set up. Please try again later.");
    assert.ok(!e.message.includes("TESTONLYNOTREAL"));
    assert.ok(!(e.detail || "").includes("TESTONLYNOTREAL"));
  }
});
