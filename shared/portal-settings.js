/*
  Portal settings: defaults, merge, and strict validation.
  Stored in Firestore at settings/portal. Only the server (Admin) can write it,
  and every save goes through validateSettings(), which keeps ONLY known fields.
  Pure code, no browser/Node/Firebase, so it can be unit tested.
*/
import { RuleError } from "./portal-rules.js";

export const DEFAULT_SETTINGS = {
  monthSlots: 15,
  royalSwagReserved: 8,
  offlineSlots: { "2026-10": 4 },
  holdHours: 48,
  priceValidTill: "2026-10-31",
  whatsapp: "",
  email: "eximburg@gmail.com",
  bank: { accountName: "", bankName: "", accountNo: "", ifsc: "", branch: "", accountType: "Current" },
  upi: { id: "", payee: "Eximburg International Pvt Ltd" },
  paymentQr: "",
  timeline: { labelDays: 15, packagingDays: 10, approvalMin: 60, approvalMax: 90, packsPerDay: 235, minMfgDays: 20, qcDays: 2, dispatchDays: 5 },
  gstNote_en: "The total order value includes 5% GST on the product order and 18% GST on the product approval fee. The 10%, 40% and 50% payments are shares of that total.",
  gstNote_hi: "कुल ऑर्डर वैल्यू में प्रोडक्ट ऑर्डर पर 5% GST और प्रोडक्ट अप्रूवल पर 18% GST शामिल है। 10%, 40% और 50% पेमेंट उसी कुल राशि के हिस्से हैं।",
  offer: {
    enabled: true, threshold: 1000000, worth: 90000, months: 3,
    title_en: "Free seller-account setup + 3 months management",
    title_hi: "सेलर अकाउंट सेटअप + 3 महीने का मैनेजमेंट फ्री",
    detail_en: "We open your online seller accounts and run them for your first 3 months.",
    detail_hi: "हम आपके ऑनलाइन सेलर अकाउंट खोलते हैं और पहले 3 महीने उन्हें चलाते हैं।"
  },
  testimonials: [
    {
      brand: "Royal Swag", tag_en: "Our own brand", tag_hi: "हमारा अपना ब्रांड", color: "#1B1B1B",
      place: "India, USA, Canada, UK", since: "2016",
      stat_en: "50,000–60,000 packs every month", stat_hi: "हर महीने 50,000–60,000 पैक",
      quote_en: "Built on the same line, the same recipes and the same influencer playbook your brand gets.",
      quote_hi: "उसी लाइन, उन्हीं रेसिपी और उसी इन्फ्लुएंसर प्लेबुक पर बना जो आपके ब्रांड को मिलती है।",
      person: "Eximburg team",
      consent: true
    }
  ]
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* Saved values win; anything missing falls back to the default. Nested objects merge field by field. */
export function mergeSettings(saved) {
  const merged = clone(DEFAULT_SETTINGS);
  const source = isPlainObject(saved) ? saved : {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (isPlainObject(value) && isPlainObject(merged[key])) merged[key] = Object.assign(merged[key], value);
    else if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged;
}

/* ---------- validation helpers (each throws a RuleError with a plain sentence) ---------- */
function text(value, label, max = 200) {
  const s = value == null ? "" : String(value).trim();
  if (s.length > max) throw new RuleError(`${label} is too long (most ${max} characters).`);
  return s;
}

function whole(value, label, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new RuleError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const WHATSAPP = /^91[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function validateSettings(input) {
  if (!isPlainObject(input)) throw new RuleError("Settings are missing.");
  const s = mergeSettings(input);
  const out = {};

  out.monthSlots = whole(s.monthSlots, "Slots per month", 1, 60);
  out.royalSwagReserved = whole(s.royalSwagReserved, "Royal Swag reserved slots", 0, 60);
  if (out.royalSwagReserved >= out.monthSlots) throw new RuleError("Royal Swag slots must be fewer than total slots.");
  out.holdHours = whole(s.holdHours, "Hold time (hours)", 1, 240);

  out.offlineSlots = {};
  if (!isPlainObject(s.offlineSlots)) throw new RuleError("Offline bookings are not valid.");
  for (const [month, count] of Object.entries(s.offlineSlots)) {
    if (!MONTH_KEY.test(month)) throw new RuleError("Offline bookings need a month like 2026-10.");
    out.offlineSlots[month] = whole(count, "Offline bookings", 0, 60);
  }

  const date = text(s.priceValidTill, "Price lock date", 10);
  if (date && (!DATE_ONLY.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z")))) throw new RuleError("Price lock date is not valid.");
  out.priceValidTill = date;

  const whatsapp = text(s.whatsapp, "WhatsApp number", 20).replace(/\D/g, "");
  if (whatsapp && !WHATSAPP.test(whatsapp)) throw new RuleError("WhatsApp must be 91 followed by the 10-digit number.");
  out.whatsapp = whatsapp;

  const email = text(s.email, "Email", 120);
  if (email && !EMAIL.test(email)) throw new RuleError("Check the email address.");
  out.email = email;

  const bank = isPlainObject(s.bank) ? s.bank : {};
  const ifsc = text(bank.ifsc, "IFSC", 11).toUpperCase();
  if (ifsc && !IFSC.test(ifsc)) throw new RuleError("Check the IFSC (11 characters, e.g. HDFC0001234).");
  out.bank = {
    accountName: text(bank.accountName, "Account name", 120),
    bankName: text(bank.bankName, "Bank", 120),
    accountNo: text(bank.accountNo, "Account number", 30).replace(/\s/g, ""),
    ifsc,
    branch: text(bank.branch, "Branch", 120),
    accountType: text(bank.accountType, "Account type", 40)
  };

  const upi = isPlainObject(s.upi) ? s.upi : {};
  out.upi = { id: text(upi.id, "UPI ID", 80), payee: text(upi.payee, "UPI payee name", 120) };

  const paymentQr = text(s.paymentQr, "Payment QR", 120);
  if (paymentQr && !/^payment-qr\/qr-\d+-[a-z0-9]{6}\.(jpg|png|webp)$/.test(paymentQr)) {
    throw new RuleError("The payment QR image is not valid. Upload it again.");
  }
  out.paymentQr = paymentQr;

  const timeline = isPlainObject(s.timeline) ? s.timeline : {};
  out.timeline = {};
  for (const key of Object.keys(DEFAULT_SETTINGS.timeline)) {
    const min = key === "packsPerDay" ? 1 : 0;
    const max = key === "packsPerDay" ? 100000 : 365;
    out.timeline[key] = whole(timeline[key], "Timeline value", min, max);
  }
  if (out.timeline.approvalMin > out.timeline.approvalMax) throw new RuleError("Govt approval shortest cannot be longer than the longest.");

  out.gstNote_en = text(s.gstNote_en, "GST note (English)", 500);
  out.gstNote_hi = text(s.gstNote_hi, "GST note (Hindi)", 500);

  const offer = isPlainObject(s.offer) ? s.offer : {};
  out.offer = {
    enabled: offer.enabled === true,
    threshold: whole(offer.threshold, "Offer minimum order value", 0, 100000000),
    worth: whole(offer.worth, "Offer worth", 0, 100000000),
    months: whole(offer.months, "Offer months", 0, 24),
    title_en: text(offer.title_en, "Offer title", 150),
    title_hi: text(offer.title_hi, "Offer title (Hindi)", 150),
    detail_en: text(offer.detail_en, "Offer detail", 300),
    detail_hi: text(offer.detail_hi, "Offer detail (Hindi)", 300)
  };

  if (!Array.isArray(s.testimonials)) throw new RuleError("Brands list is not valid.");
  if (s.testimonials.length > 12) throw new RuleError("Show at most 12 brands.");
  out.testimonials = s.testimonials
    .filter((t) => isPlainObject(t) && String(t.brand || "").trim())
    .map((t) => {
      const color = text(t.color, "Pack colour", 7) || "#1B1B1B";
      if (!HEX_COLOR.test(color)) throw new RuleError("Pack colour must look like #1B1B1B.");
      return {
        brand: text(t.brand, "Brand name", 80),
        color,
        tag_en: text(t.tag_en, "Label", 80),
        tag_hi: text(t.tag_hi, "Label (Hindi)", 80),
        since: text(t.since, "Since", 20),
        place: text(t.place, "Sold in", 120),
        stat_en: text(t.stat_en, "Result", 120),
        stat_hi: text(t.stat_hi, "Result (Hindi)", 120),
        person: text(t.person, "Name & role", 120),
        quote_en: text(t.quote_en, "Quote", 300),
        quote_hi: text(t.quote_hi, "Quote (Hindi)", 300),
        consent: t.consent === true
      };
    });

  return out;
}

/*
  What the factory team may read. Timeline and slot counts only.
  Bank, UPI, payment QR, GST notes and offer money stay on settings/portal.
*/
export function factorySettings(settings) {
  const s = mergeSettings(settings);
  return {
    monthSlots: s.monthSlots,
    royalSwagReserved: s.royalSwagReserved,
    offlineSlots: s.offlineSlots,
    holdHours: s.holdHours,
    priceValidTill: s.priceValidTill,
    timeline: s.timeline
  };
}

/* Brands the customer portal may show. Only rows Admin marked as having written permission. */
export function publicTestimonials(settings) {
  const list = settings && Array.isArray(settings.testimonials) ? settings.testimonials : [];
  return list.filter((t) => t && String(t.brand || "").trim() && t.consent === true);
}
