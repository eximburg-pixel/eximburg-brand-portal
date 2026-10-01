/*
  Checks the forms before anything is sent, with the exact sentences people see.
  The server repeats the same checks (it never trusts the browser); these just give an instant answer.
*/
import { RuleError } from "./portal-rules.js";

const DOC_FIELDS_REQUIRED = ["invoice_no", "invoice_date", "eway_no", "eway_valid_till"];

export function checkDocs(x) {
  for (const key of DOC_FIELDS_REQUIRED) {
    if (!String((x && x[key]) || "").trim()) {
      throw new Error("Fill invoice number, invoice date, e-way bill number and e-way bill valid-till date.");
    }
  }
  if (!/^\d{12}$/.test(String(x.eway_no).replace(/\s/g, ""))) throw new Error("E-way bill number must be 12 digits.");
  if (!x.invoiceFile && !x.invoice_path) throw new Error("Attach the tax invoice (PDF or photo).");
  if (!x.ewayFile && !x.eway_path) throw new Error("Attach the e-way bill (PDF or photo).");
}

export function checkDispatch(x) {
  const has = (key) => String((x && x[key]) || "").trim();
  if (!has("transporter") || !has("vehicle_no") || !has("lr_no")) {
    throw new Error("Fill transporter, vehicle number and LR / docket number.");
  }
}

export const FILE_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/* Type and size checks that need no canvas. Returns true if a photo should be shrunk first. */
export function checkFile(file, missingMessage = "Attach the payment slip (photo or PDF).") {
  if (!file) throw new Error(missingMessage);
  if (!FILE_TYPES.test(file.type)) throw new Error("Use a JPG, PNG, WEBP photo or a PDF.");
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF must be under 5 MB.");
    return false;
  }
  return file.size >= 900 * 1024;
}

/* ---------- customer forms (used by the server; RuleError messages are shown to the customer) ---------- */

/* Trims, removes control characters, and refuses text that is too long. */
function field(value, label, max) {
  const s = value == null ? "" : String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) throw new RuleError(`${label} is too long (most ${max} characters).`);
  return s;
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;

/* The "Book your slot" form. Returns clean values. */
export function checkBookingForm(p) {
  const x = p || {};
  const name = field(x.name, "Name", 80);
  if (!name) throw new RuleError("Enter your full name.");
  const phone = String(x.phone == null ? "" : x.phone).replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new RuleError("Enter a valid 10-digit mobile number.");
  const gstin = field(x.gstin, "GSTIN", 15).toUpperCase();
  if (gstin && !GSTIN.test(gstin)) throw new RuleError("Check the GSTIN (15 characters), or leave it blank.");
  return {
    name,
    phone,
    brand: field(x.brand, "Brand name", 40),
    city: field(x.city, "City", 60),
    gstin,
    call_time: field(x.call_time, "Call time", 40)
  };
}

/* "Booking not found." style ids: letters and digits only, so they are safe in paths. */
export function cleanId(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9]{8,40}$/.test(s) ? s : "";
}

/*
  A UTR (bank transfer reference) is compared without dashes, spaces or case, so
  "ab-123456" and "AB123456" count as the same payment.
*/
export function normalizeUtr(value) {
  return String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* The payment-slip form (everything except the file). todayIso is today's date in India, YYYY-MM-DD. */
export function checkPaymentForm(x, todayIso) {
  const p = x || {};
  const utrKey = normalizeUtr(p.utr);
  if (utrKey.length < 6) throw new RuleError("Enter the UTR / transaction reference number.");
  if (utrKey.length > 35) throw new RuleError("The UTR looks too long. Check it and try again.");
  const amount = Math.round(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new RuleError("Enter the amount you paid.");
  const paidOn = typeof p.paid_on === "string" ? p.paid_on.trim() : "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && !Number.isNaN(Date.parse(paidOn + "T00:00:00Z"))
    && new Date(paidOn + "T00:00:00Z").toISOString().slice(0, 10) === paidOn;
  if (!valid) throw new RuleError("Enter the payment date.");
  if (paidOn > todayIso) throw new RuleError("Payment date cannot be in the future.");
  const oldest = new Date(Date.parse(todayIso + "T00:00:00Z") - 400 * 86400000).toISOString().slice(0, 10);
  if (paidOn < oldest) throw new RuleError("Check the payment date. It is too long ago.");
  return { utr: String(p.utr).toUpperCase().replace(/\s+/g, " ").trim().slice(0, 40), utrKey, amount, paid_on: paidOn };
}
