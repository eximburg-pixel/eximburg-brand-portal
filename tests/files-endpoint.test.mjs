import test from "node:test";
import assert from "node:assert/strict";
import { MAX_FILES_PER_BOOKING, MAX_FILE_BYTES, canReadFile, handleFile, handleUpload, parseFilePath, sniffType } from "../netlify/lib/files-endpoint.js";
import { SAMPLE, fakeFiles, fakeFirestore } from "./helpers/fake-firestore.mjs";
import { SITE, netlifyUser, silent, verifyOrigin } from "./helpers/fakes.mjs";

const BOOKING = "bk00000000000000001";
const OTHER = "bk00000000000000002";

const ROLE_OF = { cust: ["user"], cust2: ["user"], admin: ["Admin"], acct: ["Account"], prod: ["Production"], nobody: [] };

function world({ user = "cust", seed } = {}) {
  const db = fakeFirestore(seed || {
    [`bookings/${BOOKING}`]: { user_id: "cust", stage: "awaiting_payment", dispatch: {} },
    [`bookings/${OTHER}`]: { user_id: "cust2", stage: "awaiting_payment", dispatch: {} }
  });
  const files = fakeFiles();
  let current = user ? netlifyUser(user, ROLE_OF[user] || ["user"]) : null;
  const deps = {
    verifyOrigin,
    getUser: async () => current,
    firebase: () => ({ db }),
    files, log: silent, now: () => 1700000000000, random: () => 0.5
  };
  return { db, files, deps, as: (u) => { current = u ? netlifyUser(u, ROLE_OF[u] || ["user"]) : null; } };
}

function uploadRequest(bytes, { type = "image/jpeg", booking = BOOKING, method = "POST", origin = SITE, length } = {}) {
  const headers = { "content-type": type };
  if (origin) headers.origin = origin;
  if (length !== undefined) headers["content-length"] = String(length);
  return new Request(`${SITE}/api/upload/slip?booking=${booking}`, { method, headers, body: method === "GET" ? undefined : bytes });
}
const fileRequest = (path) => new Request(`${SITE}/api/file?path=${encodeURIComponent(path)}`, { method: "GET" });
const body = async (res) => res.json();

/* ------------------------------------------------------ what a file really is */

test("files are recognised by their first bytes", () => {
  assert.equal(sniffType(SAMPLE.jpeg()), "image/jpeg");
  assert.equal(sniffType(SAMPLE.png()), "image/png");
  assert.equal(sniffType(SAMPLE.webp()), "image/webp");
  assert.equal(sniffType(SAMPLE.pdf()), "application/pdf");
  assert.equal(sniffType(SAMPLE.text()), null);
  assert.equal(sniffType(SAMPLE.html()), null);
  assert.equal(sniffType(new ArrayBuffer(0)), null);
  assert.equal(sniffType(Uint8Array.from([0xff, 0xd8]).buffer), null, "too short to be a real JPEG");
});

test("only the exact stored path shapes are understood", () => {
  assert.deepEqual(parseFilePath(`payment-slips/cust/${BOOKING}/1700-abc.jpg`), { kind: "slip", uid: "cust", bookingId: BOOKING });
  assert.deepEqual(parseFilePath(`dispatch-docs/${BOOKING}/qc-1.pdf`), { kind: "doc", bookingId: BOOKING });
  for (const bad of [null, undefined, "", 42, "x", "payment-slips/cust/short/a.jpg", `payment-slips/cust/${BOOKING}/../x.jpg`, `payment-slips/../${BOOKING}/a.jpg`,
    `payment-slips/cust/${BOOKING}/a/b.jpg`, `payment-slips/cust/${BOOKING}/a b.jpg`, `/payment-slips/cust/${BOOKING}/a.jpg`, `dispatch-docs/${BOOKING}/`, "other/x/y"]) {
    assert.equal(parseFilePath(bad), null, String(bad));
  }
});

/* ------------------------------------------------------------------ upload */

test("a customer uploads a payment slip; it is stored under their own name and order", async () => {
  const w = world();
  const res = await handleUpload(uploadRequest(SAMPLE.jpeg()), "slip", w.deps);
  assert.equal(res.status, 200);
  const { ok, path } = await body(res);
  assert.equal(ok, true);
  assert.match(path, new RegExp(`^payment-slips/cust/${BOOKING}/1700000000000-[a-z0-9]{6}\\.jpg$`));
  const stored = w.files.store.get(path);
  assert.equal(stored.bytes.byteLength, SAMPLE.jpeg().byteLength, "the raw bytes were stored");
  assert.equal(stored.meta.contentType, "image/jpeg");
});

test("PNG, WEBP and PDF are accepted too, with the right file ending", async () => {
  const w = world();
  for (const [type, make, ext] of [["image/png", SAMPLE.png, "png"], ["image/webp", SAMPLE.webp, "webp"], ["application/pdf", SAMPLE.pdf, "pdf"]]) {
    const res = await handleUpload(uploadRequest(make(), { type }), "slip", w.deps);
    assert.equal(res.status, 200, type);
    assert.ok((await body(res)).path.endsWith("." + ext));
  }
});

test("uploads are refused with a plain message when something is wrong", async () => {
  const cases = [
    ["wrong method", () => uploadRequest(undefined, { method: "GET" }), {}, 405],
    ["another website", () => uploadRequest(SAMPLE.jpeg(), { origin: "https://evil.example" }), {}, 403],
    ["no origin header", () => uploadRequest(SAMPLE.jpeg(), { origin: "" }), {}, 403],
    ["a type that is not allowed", () => uploadRequest(SAMPLE.text(), { type: "text/plain" }), {}, 415, "Use a JPG, PNG, WEBP photo or a PDF."],
    ["an SVG", () => uploadRequest(SAMPLE.text(), { type: "image/svg+xml" }), {}, 415],
    ["html pretending to be a photo", () => uploadRequest(SAMPLE.html(), { type: "image/jpeg" }), {}, 415, "That file is not a valid photo or PDF."],
    ["a PNG that says it is a PDF", () => uploadRequest(SAMPLE.png(), { type: "application/pdf" }), {}, 415, "That file is not a valid photo or PDF."],
    ["an empty file", () => uploadRequest(new ArrayBuffer(0)), {}, 400, "Attach your payment slip (photo or PDF)."],
    ["a file that announces it is huge", () => uploadRequest(SAMPLE.jpeg(), { length: MAX_FILE_BYTES + 1 }), {}, 413, "That file is larger than 5 MB."],
    ["someone else's order", () => uploadRequest(SAMPLE.jpeg(), { booking: OTHER }), {}, 404, "Booking not found."],
    ["an order that does not exist", () => uploadRequest(SAMPLE.jpeg(), { booking: "nothere000000000001" }), {}, 404, "Booking not found."],
    ["a made-up order id", () => uploadRequest(SAMPLE.jpeg(), { booking: "..%2F..%2Fx" }), {}, 404, "Booking not found."],
    ["staff uploading", () => uploadRequest(SAMPLE.jpeg()), { user: "acct" }, 403],
    ["signed out", () => uploadRequest(SAMPLE.jpeg()), { user: null }, 401]
  ];
  for (const [name, make, opts, status, message] of cases) {
    const w = world({ user: "user" in opts ? opts.user : "cust" });
    const res = await handleUpload(make(), "slip", w.deps);
    assert.equal(res.status, status, name);
    if (message) assert.equal((await body(res)).error.message ?? (await body(res)).message, message, name);
    assert.equal(w.files.store.size, 0, `${name}: nothing stored`);
  }
});

test("a file over 5 MB is refused even if the announced size was a lie", async () => {
  const w = world();
  const big = new Uint8Array(MAX_FILE_BYTES + 10);
  big.set(new Uint8Array(SAMPLE.jpeg()));
  const res = await handleUpload(uploadRequest(big.buffer, { length: 100 }), "slip", w.deps);
  assert.equal(res.status, 413);
  assert.equal(w.files.store.size, 0);
});

test("a file exactly 5 MB is accepted", async () => {
  const w = world();
  const edge = new Uint8Array(MAX_FILE_BYTES);
  edge.set(new Uint8Array(SAMPLE.jpeg()));
  assert.equal((await handleUpload(uploadRequest(edge.buffer), "slip", w.deps)).status, 200);
});

test("no upload while nothing is due; a made-up kind does not exist", async () => {
  const w = world({ seed: { [`bookings/${BOOKING}`]: { user_id: "cust", stage: "payment_review", dispatch: {} } } });
  const res = await handleUpload(uploadRequest(SAMPLE.jpeg()), "slip", w.deps);
  assert.equal(res.status, 409);
  const w2 = world();
  assert.equal((await handleUpload(uploadRequest(SAMPLE.jpeg()), "../x", w2.deps)).status, 404);
  w2.as("prod");
  assert.equal((await handleUpload(uploadRequest(SAMPLE.jpeg()), "qc", w2.deps)).status, 409, "QC upload exists but this order is not at QC");
});

test("there is a limit on how many files one order can collect", async () => {
  const w = world();
  for (let i = 0; i < MAX_FILES_PER_BOOKING; i++) w.files.store.set(`payment-slips/cust/${BOOKING}/old${i}.jpg`, { bytes: new ArrayBuffer(1), meta: {} });
  const res = await handleUpload(uploadRequest(SAMPLE.jpeg()), "slip", w.deps);
  assert.equal(res.status, 429);
});

/* ---------------------------------------------------------------- download */

const SLIP = `payment-slips/cust/${BOOKING}/1-a.jpg`;
const QC = `dispatch-docs/${BOOKING}/qc.pdf`;
const INV = `dispatch-docs/${BOOKING}/invoice.pdf`;
const EWAY = `dispatch-docs/${BOOKING}/eway.pdf`;
const STRAY = `dispatch-docs/${BOOKING}/stray.pdf`;

function download(stage, as, path) {
  const w = world({
    user: as,
    seed: { [`bookings/${BOOKING}`]: { user_id: "cust", stage, dispatch: { qc_path: QC, invoice_path: INV, eway_path: EWAY } } }
  });
  for (const p of [SLIP, QC, INV, EWAY, STRAY]) w.files.store.set(p, { bytes: SAMPLE.pdf(), meta: { contentType: "application/pdf" } });
  return handleFile(fileRequest(path), w.deps);
}

test("payment slips: the customer who paid and Accounts/Admin may open them; Production and other customers may not", async () => {
  const expected = { cust: 200, acct: 200, admin: 200, prod: 404, cust2: 404, nobody: 404 };
  for (const [who, status] of Object.entries(expected)) {
    assert.equal((await download("payment_review", who, SLIP)).status, status, who);
  }
  assert.equal((await download("payment_review", null, SLIP)).status, 401, "signed out");
});

test("dispatch documents: office and the owner always; Production only what the order lists and only when due", async () => {
  const want = (stage, as, path) => download(stage, as, path).then((r) => r.status);
  assert.equal(await want("qc", "cust", QC), 200);
  assert.equal(await want("qc", "cust2", QC), 404, "another customer");
  assert.equal(await want("qc", "acct", INV), 200);
  assert.equal(await want("qc", "admin", EWAY), 200);
  assert.equal(await want("qc", "prod", QC), 200, "production sees the QC report");
  assert.equal(await want("qc", "prod", INV), 404, "not the invoice yet");
  assert.equal(await want("qc", "prod", EWAY), 404, "not the e-way bill yet");
  assert.equal(await want("ready_dispatch", "prod", INV), 200, "invoice once ready to dispatch");
  assert.equal(await want("dispatched", "prod", EWAY), 200);
  assert.equal(await want("awaiting_payment", "prod", QC), 404, "an order production cannot see yet");
  assert.equal(await want("ready_dispatch", "cust", STRAY), 404, "a file the order does not list is never served to a customer");
  assert.equal(await want("ready_dispatch", "prod", STRAY), 404);
  assert.equal(await want("ready_dispatch", "acct", STRAY), 200, "office may open any file of the order");
});

test("a served file is sent safely and can not be kept or re-used by a browser or a proxy", async () => {
  const res = await download("payment_review", "cust", SLIP);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("content-disposition"), "inline");
  assert.equal((await res.arrayBuffer()).byteLength, SAMPLE.pdf().byteLength);
});

test("stored metadata can never make the server send HTML", async () => {
  const w = world();
  w.files.store.set(SLIP, { bytes: SAMPLE.html(), meta: { contentType: "text/html" } });
  const res = await handleFile(fileRequest(SLIP), w.deps);
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
});

test("a missing file, a nonsense path and a wrong method are all plain refusals", async () => {
  const w = world();
  assert.equal((await handleFile(fileRequest(SLIP), w.deps)).status, 404, "allowed but not stored");
  assert.equal((await handleFile(fileRequest("../../etc/passwd"), w.deps)).status, 404);
  assert.equal((await handleFile(new Request(`${SITE}/api/file`), w.deps)).status, 404, "no path at all");
  assert.equal((await handleFile(new Request(`${SITE}/api/file?path=${SLIP}`, { method: "POST" }), w.deps)).status, 405);
  // "not allowed" and "not stored" look exactly alike
  const missing = await body(await handleFile(fileRequest(SLIP), w.deps));
  w.as("prod");
  const notAllowed = await body(await handleFile(fileRequest(SLIP), w.deps));
  assert.deepEqual(missing, { ok: false, error: { code: "not_found", message: "File not found." } });
  assert.deepEqual(notAllowed, missing);
});

test("Production uploads a QC report only while the order is at QC, stored under dispatch-docs", async () => {
  const w = world({
    user: "prod",
    seed: { [`bookings/${BOOKING}`]: { user_id: "cust", stage: "qc", dispatch: {} } }
  });
  const req = new Request(`${SITE}/api/upload/qc?booking=${BOOKING}`, { method: "POST", headers: { origin: SITE, "content-type": "application/pdf" }, body: SAMPLE.pdf() });
  const res = await handleUpload(req, "qc", w.deps);
  assert.equal(res.status, 200);
  const { path } = await body(res);
  assert.match(path, new RegExp(`^dispatch-docs/${BOOKING}/qc-1700000000000-[a-z0-9]{6}\\.pdf$`));
  w.as("cust");
  const asCustomer = new Request(`${SITE}/api/upload/qc?booking=${BOOKING}`, { method: "POST", headers: { origin: SITE, "content-type": "application/pdf" }, body: SAMPLE.pdf() });
  assert.equal((await handleUpload(asCustomer, "qc", w.deps)).status, 403, "customers cannot upload QC reports");
});

test("Accounts uploads invoice and e-way bill files while documents are being prepared", async () => {
  const w = world({
    user: "acct",
    seed: { [`bookings/${BOOKING}`]: { user_id: "cust", stage: "docs_pending", dispatch: {} } }
  });
  const up = (kind) => new Request(`${SITE}/api/upload/${kind}?booking=${BOOKING}`, { method: "POST", headers: { origin: SITE, "content-type": "application/pdf" }, body: SAMPLE.pdf() });
  const inv = await handleUpload(up("invoice"), "invoice", w.deps);
  const way = await handleUpload(up("eway"), "eway", w.deps);
  assert.equal(inv.status, 200);
  assert.equal(way.status, 200);
  assert.match((await body(inv)).path, /\/invoice-/);
  assert.match((await body(way)).path, /\/eway-/);
  w.as("prod");
  assert.equal((await handleUpload(up("invoice"), "invoice", w.deps)).status, 403, "Production does not upload invoices");
});

test("canReadFile gives the same answer for not-allowed and missing, so nobody can probe", () => {
  const parsed = parseFilePath(QC);
  assert.equal(canReadFile({ parsed, path: QC, uid: "cust", role: "customer", booking: null }), false);
  assert.equal(canReadFile({ parsed, path: QC, uid: "x", role: "customer", booking: { user_id: "cust", dispatch: { qc_path: QC } } }), false);
  assert.equal(canReadFile({ parsed, path: QC, uid: "cust", role: "customer", booking: { user_id: "cust", dispatch: { qc_path: QC } } }), true);
});
