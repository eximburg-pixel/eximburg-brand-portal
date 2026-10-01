/*
  Files: payment slips, and dispatch documents (QC report, invoice, e-way bill).

    POST /api/upload/:kind?booking=<id>   stores one file (raw bytes, not base64) and returns its path
    GET  /api/file?path=<path>            returns a file, only to people allowed to see it

  Two rules this file never breaks:
    1. A file is only ever served after asking "who is this person, and may they see THIS file?"
       on that very request. There are no public links and no links that stay valid.
    2. What the browser says a file is does not matter. The first bytes of the file must really be a
       JPG, PNG, WEBP or PDF, and they must match the type that was declared.
*/
import { ApiError, errorResponse, jsonResponse } from "./http.js";
import { roleOf } from "../../js/src/session.js";
import { PROD_VISIBLE, dueMilestone, toSpecRole } from "../../shared/portal-rules.js";
import { cleanId } from "../../shared/portal-validate.js";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_BOOKING = 10;

const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const NAME = "[A-Za-z0-9._-]{1,80}";
const SLIP_PATH = new RegExp(`^payment-slips/([A-Za-z0-9_-]{1,128})/([A-Za-z0-9]{8,40})/(${NAME})$`);
const DOC_PATH = new RegExp(`^dispatch-docs/([A-Za-z0-9]{8,40})/(${NAME})$`);
const LATE_STAGES = ["ready_dispatch", "dispatched", "delivered"];

/* The real type of a file from its first bytes, or null if it is not one we accept. */
export function sniffType(bytes) {
  const b = new Uint8Array(bytes.slice ? bytes.slice(0, 16) : bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

/* Understands a stored path. Anything that does not match exactly is not ours. */
export function parseFilePath(path) {
  if (typeof path !== "string" || path.length > 300 || path.includes("..")) return null;
  let m = SLIP_PATH.exec(path);
  if (m) return { kind: "slip", uid: m[1], bookingId: m[2] };
  m = DOC_PATH.exec(path);
  if (m) return { kind: "doc", bookingId: m[1] };
  return null;
}

/*
  May this person open this file?
    slip : the customer who paid, and Accounts/Admin. Never Production.
    doc  : Accounts/Admin always; the customer who owns the order; Production only for documents the
           order really lists, and the invoice and e-way bill only once the order is ready to dispatch.
  For a doc, the path must be one the order itself points to. A stray upload is never served to a customer.
*/
export function canReadFile({ parsed, path, uid, role, booking }) {
  const office = role === "admin" || role === "accounts";
  if (parsed.kind === "slip") return office || (role === "customer" && parsed.uid === uid);
  if (!booking) return false;
  if (office) return true;
  const dispatch = booking.dispatch || {};
  const listed = [dispatch.qc_path, dispatch.invoice_path, dispatch.eway_path].includes(path);
  if (!listed) return false;
  if (role === "customer") return booking.user_id === uid;
  if (role === "production") {
    if (!PROD_VISIBLE.includes(booking.stage)) return false;
    return path === dispatch.qc_path || LATE_STAGES.includes(booking.stage);
  }
  return false;
}

const notFound = () => new ApiError(404, "not_found", "File not found.");

const UPLOADS = {
  slip: {
    roles: ["customer"],
    empty: "Attach your payment slip (photo or PDF).",
    prefix: (uid, bookingId) => `payment-slips/${uid}/${bookingId}/`,
    filename: (stamp, rand, ext) => `${stamp}-${rand}.${ext}`,
    owner: true,
    stageOk: (b) => Boolean(dueMilestone(b.stage)),
    stageMsg: "No payment is due on this booking right now."
  },
  qc: {
    roles: ["production", "admin"],
    empty: "Attach the QC report (PDF or photo).",
    prefix: (_uid, bookingId) => `dispatch-docs/${bookingId}/`,
    filename: (stamp, rand, ext) => `qc-${stamp}-${rand}.${ext}`,
    owner: false,
    stageOk: (b) => b.stage === "qc",
    stageMsg: "This order is not waiting for a QC report. Reload the page."
  },
  invoice: {
    roles: ["accounts", "admin"],
    empty: "Attach the tax invoice (PDF or photo).",
    prefix: (_uid, bookingId) => `dispatch-docs/${bookingId}/`,
    filename: (stamp, rand, ext) => `invoice-${stamp}-${rand}.${ext}`,
    owner: false,
    stageOk: (b) => b.stage === "docs_pending" || b.stage === "ready_dispatch",
    stageMsg: "This order is not waiting for dispatch documents. Reload the page."
  },
  eway: {
    roles: ["accounts", "admin"],
    empty: "Attach the e-way bill (PDF or photo).",
    prefix: (_uid, bookingId) => `dispatch-docs/${bookingId}/`,
    filename: (stamp, rand, ext) => `eway-${stamp}-${rand}.${ext}`,
    owner: false,
    stageOk: (b) => b.stage === "docs_pending" || b.stage === "ready_dispatch",
    stageMsg: "This order is not waiting for dispatch documents. Reload the page."
  }
};

/* ---------- upload ---------- */
export async function handleUpload(request, kind, deps) {
  let user = null;
  try {
    if (request.method !== "POST") throw new ApiError(405, "method", "Use POST.");
    try {
      deps.verifyOrigin(request);
    } catch {
      throw new ApiError(403, "origin", "This request was blocked. Reload the page and try again.");
    }
    user = await deps.getUser();
    if (!user) throw new ApiError(401, "signed_out", "Please sign in again.");
    const spec = UPLOADS[kind];
    if (!spec) throw new ApiError(404, "unknown_kind", "That upload does not exist.");

    const role = toSpecRole(roleOf(user));
    if (!spec.roles.includes(role)) throw new ApiError(403, "forbidden", "You do not have access to do this.");

    const bookingId = cleanId(new URL(request.url).searchParams.get("booking"));
    if (!bookingId) throw new ApiError(404, "not_found", "Booking not found.");
    const { db } = deps.firebase();
    const snap = await db.doc(`bookings/${bookingId}`).get();
    if (!snap.exists) throw new ApiError(404, "not_found", "Booking not found.");
    const booking = snap.data();
    if (spec.owner && booking.user_id !== user.id) throw new ApiError(404, "not_found", "Booking not found.");
    if (!spec.stageOk(booking)) throw new ApiError(409, "wrong_stage", spec.stageMsg);

    const declared = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXTENSION[declared]) throw new ApiError(415, "bad_type", "Use a JPG, PNG, WEBP photo or a PDF.");
    const announced = Number(request.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > MAX_FILE_BYTES) throw new ApiError(413, "too_large", "That file is larger than 5 MB.");

    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0) throw new ApiError(400, "empty", spec.empty);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new ApiError(413, "too_large", "That file is larger than 5 MB.");
    if (sniffType(bytes) !== declared) throw new ApiError(415, "bad_content", "That file is not a valid photo or PDF.");

    const prefix = spec.prefix(user.id, bookingId);
    if ((await deps.files.count(prefix)) >= MAX_FILES_PER_BOOKING) {
      throw new ApiError(429, "too_many", "Too many files were uploaded for this order. Please contact Eximburg.");
    }
    const stamp = (deps.now || Date.now)();
    const random = Math.floor((deps.random || Math.random)() * 36 ** 6).toString(36).padStart(6, "0");
    const path = `${prefix}${spec.filename(stamp, random, EXTENSION[declared])}`;
    await deps.files.put(path, bytes, { contentType: declared, size: bytes.byteLength, uid: user.id, booking: bookingId, kind });
    return jsonResponse({ ok: true, path });
  } catch (error) {
    return errorResponse(error, { showDetail: Boolean(user) && roleOf(user) === "admin", log: deps.log });
  }
}

/* ---------- download ---------- */
export async function handleFile(request, deps) {
  let user = null;
  try {
    if (request.method !== "GET") throw new ApiError(405, "method", "Use GET.");
    user = await deps.getUser();
    if (!user) throw new ApiError(401, "signed_out", "Please sign in again.");

    const path = new URL(request.url).searchParams.get("path");
    const parsed = parseFilePath(path);
    if (!parsed) throw notFound();

    const role = toSpecRole(roleOf(user));
    let booking = null;
    if (parsed.kind === "doc") {
      const { db } = deps.firebase();
      const snap = await db.doc(`bookings/${parsed.bookingId}`).get();
      booking = snap.exists ? snap.data() : null;
    }
    // "Not allowed" and "does not exist" look the same, so nobody can probe for other people's files.
    if (!canReadFile({ parsed, path, uid: user.id, role, booking })) throw notFound();

    const file = await deps.files.get(path);
    if (!file) throw notFound();
    const type = EXTENSION[file.meta && file.meta.contentType] ? file.meta.contentType : "application/octet-stream";
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store"
      }
    });
  } catch (error) {
    return errorResponse(error, { showDetail: Boolean(user) && roleOf(user) === "admin", log: deps.log });
  }
}
