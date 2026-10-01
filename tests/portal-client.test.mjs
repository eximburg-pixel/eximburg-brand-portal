import test from "node:test";
import assert from "node:assert/strict";
import { ApiCallError, LATER_STEP_MESSAGE, OFFLINE_MESSAGE, createApiClient, createSlipUploader, fileUrl } from "../shared/portal-client.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeFile = (over = {}) => ({ name: "slip.jpg", size: 1234, lastModified: 111, type: "image/jpeg", ...over });

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail("expected a rejection");
}

/* ----------------------------------------------------------------- callApi */

test("callApi posts JSON to the action and returns the body", async () => {
  const calls = [];
  const callApi = createApiClient(async (url, init) => { calls.push([url, init]); return json(200, { ok: true, booking: { id: "x" } }); });
  const out = await callApi("book Slot", { a: 1 });
  assert.deepEqual(out, { ok: true, booking: { id: "x" } });
  assert.equal(calls[0][0], "/api/call/book%20Slot");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(calls[0][1].body, '{"a":1}');
});

test("callApi turns every kind of failure into a short sentence", async () => {
  const run = (response) => rejection(createApiClient(async () => response)("x", {}));
  let e = await run(json(409, { ok: false, error: { code: "duplicate_utr", message: "This UTR has already been submitted." } }));
  assert.ok(e instanceof ApiCallError);
  assert.deepEqual([e.message, e.status, e.code], ["This UTR has already been submitted.", 409, "duplicate_utr"]);
  e = await run(json(404, { ok: false, error: { code: "unknown_action", message: "x" } }));
  assert.equal(e.message, LATER_STEP_MESSAGE);
  e = await run(json(401, { ok: false, error: { code: "signed_out", message: "x" } }));
  assert.equal(e.message, "Your session ended. Sign in again.");
  e = await run(new Response("<html>bad gateway</html>", { status: 502 }));
  assert.equal(e.message, "Something went wrong. Please try again.");
  e = await run(json(400, { ok: false, error: { code: "invalid", message: "Check this.", detail: "field: x" } }));
  assert.equal(e.message, "Check this. (field: x)", "Admin technical detail is appended");
  e = await rejection(createApiClient(async () => { throw new TypeError("Failed to fetch"); })("x", {}));
  assert.deepEqual([e.message, e.code], [OFFLINE_MESSAGE, "offline"]);
});

/* ---------------------------------------------------------------- uploader */

test("a slip is sent as the raw file with its own type, to the right order", async () => {
  const calls = [];
  const upload = createSlipUploader(async (url, init) => { calls.push([url, init]); return json(200, { ok: true, path: "payment-slips/u/b1/1-a.jpg" }); });
  const file = fakeFile();
  const path = await upload("b1", file);
  assert.equal(path, "payment-slips/u/b1/1-a.jpg");
  const [url, init] = calls[0];
  assert.equal(url, "/api/upload/slip?booking=b1");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.headers["content-type"], "image/jpeg");
  assert.equal(init.body, file, "raw file, not a JSON/base64 copy");
});

test("the booking id is escaped in the address", async () => {
  let seen;
  const upload = createSlipUploader(async (url) => { seen = url; return json(200, { ok: true, path: "p" }); });
  await upload("a&b=c", fakeFile());
  assert.equal(seen, "/api/upload/slip?booking=a%26b%3Dc");
});

test("sending again the same file for the same order does not upload twice", async () => {
  let count = 0;
  const upload = createSlipUploader(async () => { count++; return json(200, { ok: true, path: "p" + count }); });
  const picked = fakeFile();
  const shrunk = fakeFile({ name: "slip.jpg", size: 99 });
  assert.equal(await upload("b1", shrunk, picked), "p1");
  assert.equal(await upload("b1", fakeFile({ size: 88 }), picked), "p1", "same picked file, even if the shrunk copy differs");
  assert.equal(count, 1);
  assert.equal(await upload("b2", shrunk, picked), "p2", "another order is a different upload");
  assert.equal(await upload("b1", shrunk, fakeFile({ name: "other.jpg" })), "p3", "another file is a different upload");
});

test("after a payment went through, the next payment uploads afresh", async () => {
  let count = 0;
  const upload = createSlipUploader(async () => { count++; return json(200, { ok: true, path: "p" + count }); });
  const file = fakeFile();
  await upload("b1", file);
  await upload("b2", file);
  upload.forget("b1");
  assert.equal(await upload("b1", file), "p3");
  assert.equal(await upload("b2", file), "p2", "other orders keep their remembered slip");
});

test("a failed upload is not remembered, and the reason is readable", async () => {
  let count = 0;
  const replies = [
    json(415, { ok: false, error: { code: "bad_content", message: "That file is not a valid photo or PDF." } }),
    json(200, { ok: true, path: "good" })
  ];
  const upload = createSlipUploader(async () => replies[count++]);
  const file = fakeFile();
  const e = await rejection(upload("b1", file));
  assert.equal(e.message, "That file is not a valid photo or PDF.");
  assert.equal(await upload("b1", file), "good");
});

test("upload problems: too big for the platform, offline, signed out, nothing returned", async () => {
  const run = (impl) => rejection(createSlipUploader(impl)("b1", fakeFile()));
  assert.equal((await run(async () => new Response("Request Entity Too Large", { status: 413 }))).message, "That file is larger than 5 MB.");
  assert.equal((await run(async () => { throw new TypeError("offline"); })).message, OFFLINE_MESSAGE);
  assert.equal((await run(async () => json(401, { ok: false, error: { code: "signed_out", message: "x" } }))).message, "Your session ended. Sign in again.");
  assert.equal((await run(async () => json(200, { ok: true }))).message, "The file could not be saved. Please try again.");
});

test("fileUrl escapes the path so it can only ever mean one file", () => {
  assert.equal(fileUrl("payment-slips/u/b1/a.jpg"), "/api/file?path=payment-slips%2Fu%2Fb1%2Fa.jpg");
  assert.equal(fileUrl("a&b=c"), "/api/file?path=a%26b%3Dc");
});
