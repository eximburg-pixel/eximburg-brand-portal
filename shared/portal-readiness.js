/*
  Step 12 readiness check. Six scored answers, one required commitment, and a
  Hot / Warm / Cold result. Pure data: the customer page and the team panel
  both read this, so the score cannot drift between the two screens.
*/

export const READINESS_QUESTIONS = [
  {
    id: "budget",
    short: "First batch",
    en: "How much can you put into your first batch, including approval fees?",
    hi: "पहले बैच में आप कितना निवेश कर सकते हैं (अप्रूवल फीस सहित)?",
    options: [
      { id: "under", en: "Below ₹6.3 lakh", hi: "₹6.3 लाख से कम", score: 0, staff: "Below ₹6.3 lakh" },
      { id: "band", en: "₹6.3 – 8 lakh", hi: "₹6.3 – 8 लाख", score: 2, staff: "₹6.3 – 8 lakh" },
      { id: "mid", en: "₹8 – 10 lakh", hi: "₹8 – 10 लाख", score: 3, staff: "₹8 – 10 lakh" },
      { id: "high", en: "₹10 lakh or more", hi: "₹10 लाख या ज़्यादा", score: 3, offer: true, staff: "₹10 lakh or more" }
    ]
  },
  {
    id: "marketing",
    short: "Marketing",
    en: "Apart from the batch, how much can you spend on marketing in the first 3 months?",
    hi: "बैच के अलावा, पहले 3 महीनों में मार्केटिंग पर कितना खर्च कर सकते हैं?",
    options: [
      { id: "none", en: "Nothing planned yet", hi: "अभी कुछ तय नहीं", score: 0, staff: "No marketing planned" },
      { id: "low", en: "Under ₹50,000", hi: "₹50,000 से कम", score: 1, staff: "Marketing under ₹50,000" },
      { id: "mid", en: "₹50,000 – 1.5 lakh", hi: "₹50,000 – 1.5 लाख", score: 2, staff: "Marketing ₹50,000 – 1.5 lakh" },
      { id: "high", en: "More than ₹1.5 lakh", hi: "₹1.5 लाख से ज़्यादा", score: 3, staff: "Marketing over ₹1.5 lakh" }
    ]
  },
  {
    id: "channel",
    short: "First sales",
    en: "Where will your first 1,000 packs sell?",
    hi: "आपके पहले 1,000 पैक कहां बिकेंगे?",
    options: [
      { id: "shops", en: "I already supply shops, paan outlets or distributors", hi: "मैं पहले से दुकानों, पान आउटलेट या डिस्ट्रीब्यूटर को सप्लाई करता/करती हूं", score: 3, staff: "Already supplies shops" },
      { id: "audience", en: "I have an online audience or a social media following", hi: "मेरी ऑनलाइन ऑडियंस या सोशल मीडिया फॉलोइंग है", score: 3, staff: "Has an online audience" },
      { id: "fresh", en: "I'll start fresh on a website or marketplace", hi: "वेबसाइट या मार्केटप्लेस पर नई शुरुआत करूंगा/करूंगी", score: 2, staff: "Starting fresh online" },
      { id: "unsure", en: "Not sure yet", hi: "अभी तय नहीं", score: 0, staff: "Channel not chosen" }
    ]
  },
  {
    id: "experience",
    short: "Experience",
    en: "Have you run a consumer product business before?",
    hi: "क्या आपने पहले कोई कंज़्यूमर प्रोडक्ट बिज़नेस चलाया है?",
    options: [
      { id: "fmcg", en: "Yes, in FMCG, tobacco, paan or retail", hi: "हां, FMCG, तंबाकू, पान या रिटेल में", score: 3, staff: "FMCG, tobacco, paan or retail" },
      { id: "other", en: "Yes, a different kind of business", hi: "हां, किसी दूसरे बिज़नेस में", score: 2, staff: "Ran a different business" },
      { id: "team", en: "First business, with a partner or team", hi: "पहला बिज़नेस, पार्टनर या टीम के साथ", score: 1, staff: "First business, with a team" },
      { id: "solo", en: "First business, on my own", hi: "पहला बिज़नेस, अकेले", score: 1, staff: "First business, on their own" }
    ]
  },
  {
    id: "horizon",
    short: "Time given",
    en: "First delivery takes 80–110 days, and profit builds over reorders. How long will you back the brand before judging it?",
    hi: "पहली डिलीवरी में 80–110 दिन लगते हैं और मुनाफ़ा रीऑर्डर से बढ़ता है। ब्रांड को परखने से पहले कितना समय देंगे?",
    options: [
      { id: "m3", en: "About 3 months", hi: "लगभग 3 महीने", score: 0, staff: "About 3 months" },
      { id: "m6", en: "About 6 months", hi: "लगभग 6 महीने", score: 1, staff: "About 6 months" },
      { id: "m12", en: "12 months", hi: "12 महीने", score: 3, staff: "12 months" },
      { id: "m24", en: "2 years or more", hi: "2 साल या ज़्यादा", score: 3, staff: "2 years or more" }
    ]
  },
  {
    id: "timing",
    short: "Start",
    en: "When do you want your first batch in production?",
    hi: "पहला बैच प्रोडक्शन में कब चाहिए?",
    options: [
      { id: "month", en: "This month", hi: "इसी महीने", score: 3, staff: "This month" },
      { id: "quarter", en: "Within 3 months", hi: "3 महीने के अंदर", score: 2, staff: "Within 3 months" },
      { id: "year", en: "Later this year", hi: "इस साल बाद में", score: 1, staff: "Later this year" },
      { id: "exploring", en: "Just exploring", hi: "अभी सिर्फ जानकारी ले रहा/रही हूं", score: 0, staff: "Just exploring" }
    ]
  }
];

export const READINESS_COMMIT = {
  en: "I will sell only to adults (18+), make no health claims, and mark paid influencer posts #ad.",
  hi: "मैं सिर्फ वयस्कों (18+) को बेचूंगा/बेचूंगी, कोई स्वास्थ्य दावा नहीं करूंगा/करूंगी, और पेड इन्फ्लुएंसर पोस्ट पर #ad लिखूंगा/लिखूंगी।"
};

/* Shown under a question when that answer scores 0 or 1. Advice, not a rejection. */
const TIPS = {
  "budget:under": {
    en: "The minimum batch is 7,000 packs (₹6.30 lakh). Plan the amount first, then book.",
    hi: "न्यूनतम बैच 7,000 पैक (₹6.30 लाख) है। पहले राशि प्लान करें, फिर बुक करें।"
  },
  "marketing:none": {
    en: "Brands that skip marketing usually stall. Plan at least ₹1 lakh. Influencer posts drive most first sales.",
    hi: "जो ब्रांड मार्केटिंग छोड़ देते हैं, वे रुक जाते हैं। कम से कम ₹1 लाख प्लान करें। पहली बिक्री ज़्यादातर इन्फ्लुएंसर पोस्ट से होती है।"
  },
  "marketing:low": {
    en: "Plan at least ₹1 lakh. Influencer posts drive most first sales.",
    hi: "कम से कम ₹1 लाख प्लान करें। पहली बिक्री ज़्यादातर इन्फ्लुएंसर पोस्ट से होती है।"
  },
  "channel:unsure": {
    en: "Pick one channel first. The Influencer sales plan step shows how to sell your first 1,000 packs.",
    hi: "पहले एक चैनल चुनें। इन्फ्लुएंसर सेल्स प्लान स्टेप दिखाता है कि पहले 1,000 पैक कैसे बेचें।"
  },
  "experience:team": {
    en: "No problem. We handle production, approval and packaging. You focus on selling.",
    hi: "कोई बात नहीं। प्रोडक्शन, अप्रूवल और पैकेजिंग हम संभालते हैं। आप बिक्री पर ध्यान दें।"
  },
  "experience:solo": {
    en: "No problem. We handle production, approval and packaging. You focus on selling.",
    hi: "कोई बात नहीं। प्रोडक्शन, अप्रूवल और पैकेजिंग हम संभालते हैं। आप बिक्री पर ध्यान दें।"
  },
  "horizon:m3": {
    en: "Your first stock arrives around month 3–4. Give it at least 12 months to judge fairly.",
    hi: "पहला स्टॉक लगभग 3–4 महीने में आता है। सही परख के लिए कम से कम 12 महीने दें।"
  },
  "horizon:m6": {
    en: "Your first stock arrives around month 3–4. Give it at least 12 months to judge fairly.",
    hi: "पहला स्टॉक लगभग 3–4 महीने में आता है। सही परख के लिए कम से कम 12 महीने दें।"
  },
  "timing:year": {
    en: "Slots fill monthly. Save your plan and we'll keep your price for this month.",
    hi: "स्लॉट हर महीने भरते हैं। प्लान सेव करें, इस महीने की कीमत बनी रहेगी।"
  },
  "timing:exploring": {
    en: "Slots fill monthly. Save your plan and we'll keep your price for this month.",
    hi: "स्लॉट हर महीने भरते हैं। प्लान सेव करें, इस महीने की कीमत बनी रहेगी।"
  }
};

export const READINESS_OFFER_NOTE = {
  en: "This budget unlocks the ₹90,000 offer.",
  hi: "यह बजट ₹90,000 का ऑफ़र खोलता है।"
};

export const READINESS_RESULTS = {
  hot: {
    en: "You're ready to launch. Your plan fits how successful brands start.",
    hi: "आप लॉन्च के लिए तैयार हैं। आपका प्लान वैसा है जैसे सफल ब्रांड शुरू करते हैं।",
    button_en: "Book my slot",
    button_hi: "मेरा स्लॉट बुक करें",
    go: "book"
  },
  warm: {
    en: "You're close. Fix the points below and you're set.",
    hi: "आप करीब हैं। नीचे के बिंदु ठीक करें, फिर आप तैयार हैं।",
    button_en: "Plan it with our team (15-min call)",
    button_hi: "टीम के साथ प्लान करें (15 मिनट की कॉल)",
    go: "book"
  },
  cold: {
    en: "Build the base first. Here's what to sort out before you invest.",
    hi: "पहले आधार बनाएं। निवेश से पहले ये बातें तय करें।",
    button_en: "Save my plan",
    button_hi: "मेरा प्लान सेव करें",
    act: "saveplan"
  }
};

export const READINESS_RULES = {
  budget: {
    en: "The minimum batch is 7,000 packs (₹6.30 lakh). Plan the amount first, then book.",
    hi: "न्यूनतम बैच 7,000 पैक (₹6.30 लाख) है। पहले राशि प्लान करें, फिर बुक करें।"
  },
  horizon: {
    en: "Your first stock arrives around month 3–4. Give it at least 12 months to judge fairly.",
    hi: "पहला स्टॉक लगभग 3–4 महीने में आता है। सही परख के लिए कम से कम 12 महीने दें।"
  }
};

const QUESTION_COUNT = READINESS_QUESTIONS.length;

function optionIndex(value, count) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= count) return null;
  return n;
}

export function normalizeReadiness(saved) {
  const answers = Array.isArray(saved && saved.answers) ? saved.answers : [];
  return {
    answers: READINESS_QUESTIONS.map((q, i) => optionIndex(answers[i], q.options.length)),
    commit: !!(saved && (saved.commit === true || saved.commit === "true"))
  };
}

export function tipFor(questionIndex, optionIndexValue) {
  const question = READINESS_QUESTIONS[questionIndex];
  if (!question) return null;
  const pick = optionIndex(optionIndexValue, question.options.length);
  if (pick == null) return null;
  const option = question.options[pick];
  if (option.score > 1) return null;
  return TIPS[question.id + ":" + option.id] || null;
}

export function offerNote(questionIndex, optionIndexValue) {
  if (questionIndex !== 0) return null;
  const option = READINESS_QUESTIONS[0].options[optionIndex(optionIndexValue, READINESS_QUESTIONS[0].options.length)];
  return option && option.offer ? READINESS_OFFER_NOTE : null;
}

/* Score from the raw answers. The commitment must be ticked before a result is shown. */
export function scoreReadiness(answers, commit) {
  const state = normalizeReadiness({ answers, commit });
  const chosen = state.answers.map((pick, i) => (pick == null ? null : READINESS_QUESTIONS[i].options[pick]));
  const scores = chosen.map((option) => (option ? option.score : null));
  const answeredCount = scores.filter((score) => score != null).length;
  const total = scores.reduce((sum, score) => sum + (score || 0), 0);
  const allAnswered = answeredCount === QUESTION_COUNT;
  let band = "";
  if (allAnswered) band = total >= 14 ? "hot" : total >= 9 ? "warm" : "cold";
  const rules = [];
  if (scores[0] === 0) rules.push("budget");
  if (scores[4] === 0) rules.push("horizon");
  if (band === "hot" && rules.length) band = "warm";
  const channel = chosen[2];
  const timing = chosen[5];
  return {
    answers: state.answers,
    scores,
    total,
    answeredCount,
    allAnswered,
    complete: allAnswered && state.commit,
    band,
    rules,
    offer: !!(chosen[0] && chosen[0].offer),
    channel: channel ? channel.id : "",
    timing: timing ? timing.id : "",
    channelLabel: channel ? channel.staff : "",
    timingLabel: timing ? timing.staff : "",
    tips: state.answers.map((pick, i) => tipFor(i, pick))
  };
}

export function bandLabel(band) {
  if (band === "hot") return "Hot";
  if (band === "warm") return "Warm";
  if (band === "cold") return "Cold";
  return "";
}

/* Latest readiness_check event for one person. Incomplete checks stay visible as in progress. */
export function readinessFromEvents(events) {
  const rows = (events || []).filter((event) => event && event.type === "readiness_check");
  if (!rows.length) return null;
  const latest = rows.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))).at(-1);
  const meta = latest.meta || {};
  const scored = scoreReadiness(meta.answers, meta.commit);
  if (!scored.answeredCount) return null;
  return { ...scored, at: latest.created_at || "" };
}
