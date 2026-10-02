import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, factorySettings, mergeSettings, publicTestimonials, validateSettings } from "../shared/portal-settings.js";
import { RuleError } from "../shared/portal-rules.js";

const good = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const msg = (fn) => { try { fn(); } catch (e) { return e instanceof RuleError ? e.message : "WRONG ERROR TYPE: " + e; } return "no error"; };

test("defaults are valid as they stand", () => {
  const out = validateSettings(good());
  assert.equal(out.monthSlots, 15);
  assert.equal(out.royalSwagReserved, 8);
  assert.equal(out.testimonials.length, 1);
});

test("mergeSettings fills gaps and merges nested objects field by field", () => {
  const m = mergeSettings({ bank: { ifsc: "HDFC0001234" }, holdHours: 24, whatsapp: null });
  assert.equal(m.bank.ifsc, "HDFC0001234");
  assert.equal(m.bank.accountType, "Current");
  assert.equal(m.holdHours, 24);
  assert.equal(m.whatsapp, "");
  assert.equal(mergeSettings(null).monthSlots, 15);
  assert.notEqual(mergeSettings({}), DEFAULT_SETTINGS);
});

test("mergeSettings never changes the shared defaults", () => {
  const m = mergeSettings({});
  m.bank.ifsc = "X";
  m.offlineSlots["2030-01"] = 9;
  assert.equal(DEFAULT_SETTINGS.bank.ifsc, "");
  assert.equal(DEFAULT_SETTINGS.offlineSlots["2030-01"], undefined);
});

test("unknown keys are dropped", () => {
  const s = good();
  s.isAdmin = true;
  s.updated_at = "x";
  s.bank.secret = "y";
  const out = validateSettings(s);
  assert.equal(out.isAdmin, undefined);
  assert.equal(out.updated_at, undefined);
  assert.equal(out.bank.secret, undefined);
});

test("Royal Swag slots must be fewer than the total", () => {
  const s = good(); s.royalSwagReserved = 15;
  assert.equal(msg(() => validateSettings(s)), "Royal Swag slots must be fewer than total slots.");
});

test("numbers are range checked", () => {
  for (const [key, value] of [["monthSlots", 0], ["monthSlots", 61], ["monthSlots", 1.5], ["holdHours", 0], ["holdHours", 241], ["monthSlots", "abc"]]) {
    const s = good(); s[key] = value;
    assert.notEqual(msg(() => validateSettings(s)), "no error", `${key}=${value}`);
  }
  const s = good(); s.timeline.packsPerDay = 0;
  assert.notEqual(msg(() => validateSettings(s)), "no error");
});

test("approval shortest cannot exceed longest", () => {
  const s = good(); s.timeline.approvalMin = 100;
  assert.match(msg(() => validateSettings(s)), /shortest/);
});

test("WhatsApp and IFSC follow the panel's rules", () => {
  let s = good(); s.whatsapp = "9876543210";
  assert.equal(msg(() => validateSettings(s)), "WhatsApp must be 91 followed by the 10-digit number.");
  s = good(); s.whatsapp = "+91 98765 43210";
  assert.equal(validateSettings(s).whatsapp, "919876543210");
  s = good(); s.bank.ifsc = "hdfc0001234";
  assert.equal(validateSettings(s).bank.ifsc, "HDFC0001234");
  s = good(); s.bank.ifsc = "BAD";
  assert.match(msg(() => validateSettings(s)), /IFSC/);
  s = good(); s.bank.accountNo = "1234 5678 90";
  assert.equal(validateSettings(s).bank.accountNo, "1234567890");
});

test("offline slots need a real month key and sensible counts", () => {
  let s = good(); s.offlineSlots = { "2026-13": 1 };
  assert.notEqual(msg(() => validateSettings(s)), "no error");
  s = good(); s.offlineSlots = { "2026-10": 61 };
  assert.notEqual(msg(() => validateSettings(s)), "no error");
  s = good(); s.offlineSlots = { "2026-11": 3, "2026-10": 4 };
  assert.deepEqual(validateSettings(s).offlineSlots, { "2026-11": 3, "2026-10": 4 });
});

test("price date must be a real date or empty", () => {
  let s = good(); s.priceValidTill = "31/10/2026";
  assert.notEqual(msg(() => validateSettings(s)), "no error");
  s = good(); s.priceValidTill = "";
  assert.equal(validateSettings(s).priceValidTill, "");
});

test("testimonial colour must be hex, blank brands are removed, empty colour gets the default", () => {
  let s = good(); s.testimonials = [{ brand: "A", color: "red;background:url(x)" }];
  assert.notEqual(msg(() => validateSettings(s)), "no error");
  s = good(); s.testimonials = [{ brand: "A", color: "" }, { brand: "  ", color: "#fff000" }];
  const out = validateSettings(s);
  assert.equal(out.testimonials.length, 1);
  assert.equal(out.testimonials[0].color, "#1B1B1B");
});

test("too many brands, too-long text, and non-object input are refused", () => {
  let s = good(); s.testimonials = Array.from({ length: 13 }, (_, i) => ({ brand: "B" + i }));
  assert.match(msg(() => validateSettings(s)), /12/);
  s = good(); s.gstNote_en = "x".repeat(501);
  assert.match(msg(() => validateSettings(s)), /too long/);
  assert.equal(msg(() => validateSettings(null)), "Settings are missing.");
  assert.equal(msg(() => validateSettings([])), "Settings are missing.");
});

test("a payment QR must be an image we stored, or empty", () => {
  const s = good();
  assert.equal(validateSettings(s).paymentQr, "");
  s.paymentQr = "payment-qr/qr-1700000000000-abc123.jpg";
  assert.equal(validateSettings(s).paymentQr, "payment-qr/qr-1700000000000-abc123.jpg");
  s.paymentQr = "payment-slips/u/booking/slip.jpg";
  assert.match(msg(() => validateSettings(s)), /QR/);
});

test("offer switch is a strict boolean", () => {
  const s = good(); s.offer.enabled = "yes";
  assert.equal(validateSettings(s).offer.enabled, false);
});

test("a testimonial is stored with consent, and only consented brands are public", () => {
  const s = good();
  s.testimonials = [
    { brand: "Royal Swag", consent: true, quote_en: "Ours" },
    { brand: "Client Co", consent: false, quote_en: "Wait" },
    { brand: "No box ticked", quote_en: "Hidden" }
  ];
  const out = validateSettings(s);
  assert.equal(out.testimonials[0].consent, true);
  assert.equal(out.testimonials[1].consent, false);
  assert.equal(out.testimonials[2].consent, false);
  assert.deepEqual(publicTestimonials(out).map((t) => t.brand), ["Royal Swag"]);
  assert.deepEqual(publicTestimonials({ testimonials: [{ brand: "X" }] }), []);
});

test("the factory copy keeps the timeline and drops bank, UPI and the payment QR", () => {
  const s = good();
  s.bank.accountNo = "123456789012";
  s.upi.id = "eximburg@okhdfcbank";
  s.paymentQr = "payment-qr/qr-1700000000000-abc123.jpg";
  s.monthSlots = 12;
  const factory = factorySettings(s);
  assert.equal(factory.monthSlots, 12);
  assert.equal(factory.timeline.labelDays, DEFAULT_SETTINGS.timeline.labelDays);
  assert.equal(factory.bank, undefined);
  assert.equal(factory.upi, undefined);
  assert.equal(factory.paymentQr, undefined);
  assert.equal(factory.offer, undefined);
});
