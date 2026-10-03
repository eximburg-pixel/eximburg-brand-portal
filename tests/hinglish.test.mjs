import test from "node:test";
import assert from "node:assert/strict";
import { toHinglish } from "../shared/hinglish.js";
import { READINESS_COMMIT, READINESS_QUESTIONS } from "../shared/portal-readiness.js";

test("Hinglish is the Hindi sentence in Roman letters, with English words spelled normally", () => {
  assert.equal(toHinglish("आपका डैशबोर्ड"), "Aapka dashboard");
  assert.equal(toHinglish("मेनू खोलें"), "Menu kholen");
  assert.equal(toHinglish("हर्बल सिगरेट"), "Herbal cigarette");
  assert.equal(toHinglish("मार्केट साइज़"), "Market size");
  assert.equal(toHinglish("भविष्य की संभावनाएं"), "Bhavishya ki sambhavnayen");
  assert.equal(toHinglish("टारगेट ग्राहक"), "Target grahak");
  assert.equal(toHinglish("Eximburg के बारे में"), "Eximburg ke baare mein");
  assert.equal(toHinglish("यह बिज़नेस क्यों"), "Yeh business kyon");
  assert.equal(toHinglish("अपना स्लॉट बुक करें"), "Apna slot book karen");
  assert.equal(toHinglish("मेरे ऑर्डर और स्टेटस"), "Mere order aur status");
  assert.equal(toHinglish("लाख"), "Lakh");
  assert.equal(toHinglish("करोड़"), "Crore");
  assert.equal(
    toHinglish("मैं सिर्फ वयस्कों (18+) को बेचूंगा/बेचूंगी, कोई स्वास्थ्य दावा नहीं करूंगा/करूंगी।"),
    "Main sirf vayaskon (18+) ko bechunga/bechungi, koi swasthya daawa nahi karunga/karungi."
  );
  assert.equal(toHinglish("अभी कुछ तय नहीं"), "Abhi kuch tay nahi");
  assert.equal(toHinglish("पहले 3 महीनों में"), "Pehle 3 mahinon mein");
  assert.equal(toHinglish("नई शुरुआत"), "Nayi shuruaat");
});

test("English and punctuation that are already Roman are left as they are", () => {
  assert.equal(toHinglish("Book my slot"), "Book my slot");
  assert.equal(toHinglish("₹6.30 lakh"), "₹6.30 lakh");
  assert.equal(toHinglish("#ad"), "#ad");
});

test("the readiness questions all transliterate, and the commitment stays one sentence", () => {
  for (const q of READINESS_QUESTIONS) {
    const line = toHinglish(q.hi);
    assert.equal(line.length > 0, true);
    assert.equal(/[\u0900-\u097F]/.test(line), false, q.hi);
    for (const o of q.options) assert.equal(/[\u0900-\u097F]/.test(toHinglish(o.hi)), false, o.hi);
  }
  const commit = toHinglish(READINESS_COMMIT.hi);
  assert.match(commit, /^Main sirf vayaskon/);
  assert.equal(/[\u0900-\u097F]/.test(commit), false);
});
