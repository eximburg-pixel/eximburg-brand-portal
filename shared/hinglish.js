/*
  Hindi in Roman letters for the customer dashboard.
  English words that were only written in Devanagari stay in their normal spelling.
  Everything else follows the way those Hindi words are read: schwa drops where Hindi drops it.
*/

const CONS = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
  "ष": "sh", "स": "s", "ह": "h"
};
const NUKTA = { "क": "q", "ख": "kh", "ग": "gh", "ज": "z", "ड": "d", "ढ": "dh", "फ": "f", "य": "y" };
const MATRA = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e"
};
const VOWEL = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o"
};
const LABIAL = new Set(["प", "फ", "ब", "भ", "म"]);
const DIGITS = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

/* English words the Hindi copy spells in Devanagari, plus a few readings the letter rules miss. */
const SPELL = {
  "अकाउंट": "account", "अकाउंट्स": "accounts", "अटैच": "attach", "अनलॉक": "unlock",
  "अपडेट": "update", "अपलोड": "upload", "अप्रूव": "approve", "अप्रूवल": "approval",
  "आउट": "out", "आउटलेट": "outlet", "आइस्ड": "iced", "आर्टवर्क": "artwork",
  "इंडस्ट्री": "industry", "इनवॉइस": "invoice", "इनोवेशन": "innovation",
  "इन्फ्लुएंसर": "influencer", "ईमेल": "email", "ईवन": "even",
  "एंगेजमेंट": "engagement", "एंड": "and", "एक्ट": "act", "एक्सटेंशन": "extension",
  "एक्सट्रैक्ट": "extract", "एक्सपोर्ट": "export", "एडजस्ट": "adjust", "एरर": "error",
  "एसेट": "asset", "ऐप": "app", "ऑडियंस": "audience", "ऑनलाइन": "online",
  "ऑफर": "offer", "ऑफलाइन": "offline", "ऑफ़र": "offer", "ऑफिस": "office", "ऑर्डर": "order",
  "ओरिजिन": "origin", "कंज़्यूमर": "consumer", "कंज़्यूमेबल": "consumable", "कंटेंट": "content",
  "कंपनी": "company", "कंपनियां": "companies", "कन्फर्मेशन": "confirmation",
  "कन्फ़र्म": "confirm", "कन्फ़र्मेशन": "confirmation", "कमीशन": "commission",
  "कमेंट": "comment", "कम्प्लायंस": "compliance", "काउंटर": "counter", "किट": "kit",
  "कैटेगरी": "category", "कैफ़े": "cafe", "कॉपी": "copy", "कॉम्बो": "combo", "कॉल": "call",
  "कोऑर्डिनेटर": "coordinator", "कोड": "code", "क्रिएटर": "creator", "क्रिएटर्स": "creators",
  "क्लाइंट": "client", "क्लासिक": "classic", "क्लोव": "clove", "क्वालिटी": "quality",
  "गाइड": "guide", "गाइडेंस": "guidance", "गारंटी": "guarantee", "गारंटीड": "guaranteed",
  "गैजेट": "gadget", "ग्रुप": "group", "ग्रोथ": "growth", "ग्लोबल": "global",
  "चार्ज": "charge", "चार्ट": "chart", "चेक": "check", "चेकलिस्ट": "checklist", "चैनल": "channel",
  "जिंजर": "ginger", "टाइमलाइन": "timeline", "टारगेट": "target", "टिक": "tick", "टियर": "tier",
  "टीम": "team", "टेक्स्ट": "text", "टेस्ट": "test", "टेस्टेड": "tested", "टैक्स": "tax",
  "टैप": "tap", "टॉप": "top", "ट्यूब": "tube", "ट्रांसफर": "transfer", "ट्रायल": "trial",
  "ट्रेडमार्क": "trademark", "ट्रैक": "track", "डाउनलोड": "download", "डिज़ाइन": "design",
  "डिटेल": "detail", "डिपॉज़िट": "deposit", "डिमांड": "demand", "डिलीवर": "deliver",
  "डिलीवरी": "delivery", "डिस्काउंट": "discount", "डिस्क्लोज़र": "disclosure",
  "डिस्ट्रीब्यूटर": "distributor", "डिस्पैच": "dispatch", "डेडिकेटेड": "dedicated",
  "डैशबोर्ड": "dashboard", "डॉलर": "dollar", "ड्रग्स": "drugs", "ड्रैग": "drag",
  "नंबर": "number", "निकोटीन": "nicotine", "नेचुरल": "natural", "नेटवर्क": "network",
  "नैनो": "nano", "नोट": "note", "नोट्स": "notes", "पर्सनल": "personal",
  "पार्टनर": "partner", "पार्टी": "party", "पेज": "page", "पेड": "paid", "पेपर": "paper",
  "पेमेंट": "payment", "पैक": "pack", "पैकेजिंग": "packaging", "पोज़िशनिंग": "positioning",
  "पोर्टल": "portal", "पोस्ट": "post", "प्राइवेट": "private", "प्राइस": "price",
  "प्रिंट": "print", "प्रिंटिंग": "printing", "प्रिंटेड": "printed", "प्रीव्यू": "preview",
  "प्रॉफिट": "profit", "प्रोडक्ट": "product", "प्रोडक्ट्स": "products", "प्रोडक्शन": "production",
  "प्रोफेशनल": "professional", "प्रोसेस": "process", "प्लान": "plan", "प्लानिंग": "planning",
  "प्लेटफॉर्म": "platform", "प्लेबुक": "playbook", "फ़ाइल": "file", "फाइल": "file",
  "फाइनल": "final", "फाइलिंग": "filing", "फाउंडर्स": "founders", "फिक्स्ड": "fixed",
  "फिगर": "figure", "फिलिंग": "filling", "फिल्टर": "filter", "फीड": "feed", "फीस": "fees",
  "फुलफिलमेंट": "fulfilment", "फेज़": "phase", "फैक्ट्री": "factory", "फॉर्मूला": "formula",
  "फॉर्मूलेशन": "formulation", "फॉर्मेट": "format", "फॉलोअर्स": "followers",
  "फॉलोइंग": "following", "फोकस": "focus", "फोटो": "photo", "फ्री": "free",
  "फ्रूट": "fruit", "फ्रूटा": "frutta", "फ्रूटी": "fruity", "फ्लेवर": "flavour",
  "फ्लेवर्स": "flavours", "बजट": "budget", "बंडल": "bundle", "बेंचमार्क": "benchmark",
  "बेस": "base", "बेस्ट": "best", "बैंक": "bank", "बैच": "batch", "बॉक्स": "box",
  "बॉलीवुड": "Bollywood", "बोल्ड": "bold", "ब्रांच": "branch", "ब्रांड": "brand",
  "ब्रांड्स": "brands", "ब्रीफ": "brief", "ब्रेक": "break", "ब्लू": "blue", "ब्लेंड": "blend",
  "ब्लेंडिंग": "blending", "मल्टी": "multi", "माइंडसेट": "mindset", "माइक्रो": "micro",
  "मार्केट": "market", "मार्केटप्लेस": "marketplace", "मार्केटिंग": "marketing",
  "मार्जिन": "margin", "मेट्रिक": "metric", "मेनस्ट्रीम": "mainstream", "मेनू": "menu",
  "मैनेजमेंट": "management", "मैन्युफैक्चरिंग": "manufacturing", "मॉडल": "model",
  "मोबाइल": "mobile", "यूज़र": "user", "यूनिट": "unit", "रन": "run", "राउंड": "round",
  "रिज़र्व": "reserve", "रिजेक्ट": "reject", "रिटर्न": "return", "रिटेल": "retail",
  "रिटेलर": "retailer", "रिपीट": "repeat", "रिपोर्ट": "report", "रिव्यू": "review",
  "रिसर्च": "research", "रीऑर्डर": "reorder", "रील": "reel", "रीलोड": "reload",
  "रील्स": "reels", "रेंज": "range", "रेगुलर": "regular", "रेट": "rate", "रेटिंग": "rating",
  "रेफ़रेंस": "reference", "रेमेडीज़": "remedies", "रेसिपी": "recipe", "लाइन": "line",
  "लाइव": "live", "लाइसेंस": "licence", "लाउंज": "lounge", "लिमिट": "limit", "लिस्ट": "list",
  "लिस्टिंग": "listing", "लुक": "look", "लैडर": "ladder", "लॉक": "lock", "लॉग": "log",
  "लॉगिन": "login", "लॉट": "lot", "लॉन्च": "launch", "लॉन्चपैड": "launchpad",
  "लॉयल्टी": "loyalty", "लोड": "load", "विंडो": "window", "वीडियो": "video",
  "वेंडर्स": "vendors", "वेबसाइट": "website", "वेयरहाउस": "warehouse", "वेरिफ़ाई": "verify",
  "वेरिफ़िकेशन": "verification", "वेलनेस": "wellness", "वैरायटी": "variety", "वैल्यू": "value",
  "वॉल्यूम": "volume", "साइकल": "cycle", "साइज़": "size", "साइट": "site", "सेंटर": "centre",
  "सेकंड": "second", "सेगमेंट": "segment", "सेट": "set", "सेटअप": "setup", "सेटिंग": "setting",
  "सेलर": "seller", "सेलिंग": "selling", "सेल्स": "sales", "सेव": "save", "सोशल": "social",
  "स्केलेबल": "scalable", "स्कैन": "scan", "स्क्रीन": "screen", "स्क्रीनशॉट": "screenshot",
  "स्टाफ": "staff", "स्टिक": "stick", "स्टेज": "stage", "स्टेटमेंट": "statement",
  "स्टेटस": "status", "स्टेप": "step", "स्टॉक": "stock", "स्मार्ट": "smart",
  "स्मोकर": "smoker", "स्मोकर्स": "smokers", "स्मोकिंग": "smoking", "स्लिप": "slip",
  "स्लैब": "slab", "स्लॉट": "slot", "हर्बल": "herbal", "हर्ब्स": "herbs", "हाई": "high",
  "हीरो": "hero", "हेल्थ": "health", "हेल्दी": "healthy", "होल्ड": "hold",
  "बिल": "bill", "बिलियन": "billion", "मिलियन": "million", "मिंट": "mint", "पान": "paan",
  "महीना": "mahina", "महीने": "mahine", "महीनों": "mahinon", "मीडिया": "media",
  "चाहिए": "chahiye", "शुरू": "shuru", "हां": "haan", "तंबाकू": "tambaku",
  "मिनट": "minute", "राशि": "rashi", "न्यूनतम": "nyuntam",
  "सिगरेट": "cigarette", "बिज़नेस": "business", "बुक": "book", "बुकिंग": "booking",
  "लाख": "lakh", "लाखों": "lakhon", "करोड़": "crore",
  "पहले": "pehle", "पहला": "pehla", "पहली": "pehli",
  "ग्राहक": "grahak", "ग्राहकों": "grahakon",
  "स्वास्थ्य": "swasthya", "दावा": "daawa", "दावे": "daawe", "दावों": "daawon",
  "लिए": "liye", "नतीजा": "natija", "नतीजे": "natije", "ऊपर": "upar",
  "सिर्फ": "sirf",
  "इंतज़ार": "intezaar", "इस्तेमाल": "istemaal", "क्राउड": "crowd",
  "नारंगी": "narangi", "पूछताछ": "poochhtachh", "फायदा": "fayda",
  "फूलों": "phoolon", "सुप्रभात": "suprabhaat", "सप्लाई": "supply",
  "सफलतापूर्वक": "safaltapoorvak", "व्यू": "view", "लूज़": "lose",
  "चाहूंगा": "chahunga", "चाहूंगी": "chahungi", "निर्माता": "nirmata",
  "भारतीय": "bharatiya", "अंतरराष्ट्रीय": "antarrashtriya",
  "में": "mein", "कुछ": "kuch",
  "गुजरात": "Gujarat", "आयुर्वेद": "Ayurveda", "आयुर्वेदिक": "Ayurvedic",
  "सीरीज़": "series", "फिल्मों": "films", "गल्फ": "Gulf",
  "यह": "yeh", "ये": "ye", "यहां": "yahan", "यही": "yahi", "यहीं": "yahin",
  "वह": "woh", "वही": "wahi", "वहीं": "wahin", "वे": "ve",
  "वाला": "wala", "वाले": "wale", "वालों": "walon", "वाली": "wali",
  "वापस": "wapas", "नहीं": "nahi", "हूं": "hoon", "हूँ": "hoon",
  "ईमानदार": "imaandar", "संभावनाएं": "sambhavnayen", "संभावना": "sambhavna",
  "कृपया": "kripya", "क्या": "kya", "क्यों": "kyon", "क्योंकि": "kyonki"
};

function nasalOf(mark, next) {
  if (mark === "ं" && next && LABIAL.has(next)) return "m";
  return "n";
}

function parseWord(word) {
  const chars = [...word];
  const syl = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (VOWEL[ch]) {
      const item = { c: "", v: VOWEL[ch], nasal: "" };
      i++;
      if (chars[i] === "ं" || chars[i] === "ँ") { item.nasal = nasalOf(chars[i], chars[i + 1]); i++; }
      if (chars[i] === "ः") { item.v += "h"; i++; }
      syl.push(item);
      continue;
    }
    if (!CONS[ch]) { i++; continue; }
    let c = CONS[ch];
    const base = ch;
    i++;
    if (chars[i] === "़") { c = NUKTA[base] || c; i++; }
    while (chars[i] === "्" && CONS[chars[i + 1]]) {
      i++;
      const n = chars[i];
      let piece = CONS[n];
      i++;
      if (chars[i] === "़") { piece = NUKTA[n] || piece; i++; }
      if (n === "ञ" && c.endsWith("j")) { c = c.slice(0, -1) + "gy"; piece = ""; }
      if (piece === "v" && (c.endsWith("s") || c === "s")) piece = "w";
      c += piece;
    }
    let v = "a";
    if (chars[i] === "्") { v = ""; i++; }
    else if (MATRA[chars[i]]) { v = MATRA[chars[i]]; i++; }
    let nasal = "";
    if (chars[i] === "ं" || chars[i] === "ँ") { nasal = nasalOf(chars[i], chars[i + 1]); i++; }
    if (chars[i] === "ः") { v += "h"; i++; }
    syl.push({ c, v, nasal });
  }
  return syl;
}

function keepsSchwa(syl) {
  return syl.c === "y" || syl.c.endsWith("y");
}

function dropSchwa(syl) {
  const vowel = syl.map((s) => s.v);
  const last = syl[syl.length - 1];
  if (syl.length > 1 && vowel[vowel.length - 1] === "a" && !keepsSchwa(last) && !last.tail && !last.nasal) vowel[vowel.length - 1] = "";
  for (let i = syl.length - 2; i >= 1; i--) {
    if (vowel[i] !== "a" || keepsSchwa(syl[i]) || syl[i].nasal || syl[i].tail) continue;
    if (!vowel[i - 1] || !vowel[i + 1]) continue;
    vowel[i] = "";
  }
  return vowel;
}

function speakSyllable(s, v, prev) {
  let vowel = v;
  if (!s.c && prev && (vowel === "e" || vowel === "ai")) vowel = "y" + vowel;
  else if (!s.c && (prev === "a" || prev === "aa") && (vowel === "i" || vowel === "ee")) vowel = "yi";
  if (s.nasal) {
    if (vowel === "e" && s.nasal === "n") vowel = s.c === "m" ? "ein" : "en";
    else if (vowel === "ai" && s.nasal === "n") vowel = "ain";
    else if (vowel === "oo" && s.nasal === "n") vowel = "oon";
    else if (vowel === "u" && s.nasal === "n") vowel = "un";
    else if (vowel === "o" && s.nasal === "n") vowel = "on";
    else vowel += s.nasal;
  }
  return s.c + vowel;
}

function romanize(word) {
  if (SPELL[word]) return SPELL[word];
  const syl = parseWord(word);
  if (!syl.length) return word;
  if (syl.length > 1 && syl[syl.length - 1].c === "y" && syl[syl.length - 1].v === "a" && !syl[syl.length - 1].nasal) {
    syl.pop();
    syl[syl.length - 1].tail = "y";
  }
  const vowels = dropSchwa(syl);
  let out = "";
  syl.forEach((s, i) => {
    let v = vowels[i];
    const last = i === syl.length - 1;
    if (last && v === "aa") v = "a";
    if (last && v === "ee") v = "i";
    out += speakSyllable(s, v, i > 0 ? vowels[i - 1] : "") + (s.tail || "");
  });
  return out.replace(/oongaa/g, "unga").replace(/oonga/g, "unga").replace(/oongi/g, "ungi");
}

function capSentences(text) {
  return text.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, lead, ch) => lead + ch.toUpperCase());
}

export function toHinglish(text) {
  const raw = String(text ?? "");
  if (!/[\u0900-\u097F]/.test(raw)) return raw;
  const converted = raw.replace(/[\u0900-\u097F]+/g, (token) => {
    let out = "";
    let buf = "";
    const flush = () => {
      if (!buf) return;
      out += romanize(buf);
      buf = "";
    };
    for (const ch of token) {
      if (ch === "।" || ch === "॥") { flush(); out += "."; }
      else if (DIGITS[ch]) { flush(); out += DIGITS[ch]; }
      else buf += ch;
    }
    flush();
    return out;
  });
  return capSentences(converted.replace(/[ ]{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1"));
}
