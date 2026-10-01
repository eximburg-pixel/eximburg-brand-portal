/* =====================================================================
   EXIMBURG BRAND PORTAL — ONE FILE TO EDIT BEFORE GOING LIVE
   Used by index.html (customers) and admin.html (Admin / Accounts / Production)
   ===================================================================== */
window.EXB_CONFIG = {

  /* 1. LIVE DATABASE (Supabase, free tier is enough).
        Leave both blank = DEMO MODE: everything works, but data is saved only
        in this browser. Use demo mode for testing, never for real customers. */
  supabaseUrl: "",          // e.g. "https://abcdxyz.supabase.co"
  supabaseAnonKey: "",      // Supabase → Project Settings → API → "anon public" key

  /* Customers log in with mobile number + password. Internally the mobile
     becomes 91XXXXXXXXXX@<loginDomain>. No email or SMS is ever sent. */
  loginDomain: "phone.eximburg.in",

  company: "Eximburg International Pvt. Ltd.",

  /* 2. FIRST-RUN SETTINGS. After launch, change these from admin.html → Settings
        (no code edit needed). Values saved in Settings override these. */
  defaults: {
    monthSlots: 15,               // production slots per month
    royalSwagReserved: 8,         // kept for Royal Swag
    offlineSlots: { "2026-10": 4 },  // slots booked outside the portal, per month (YYYY-MM)
    holdHours: 48,                // a reserved slot is held this long for the 10% payment
    priceValidTill: "2026-10-31",
    whatsapp: "",                 // "919876543210" — country code + number, no +
    email: "eximburg@gmail.com",

    bank: { accountName: "", bankName: "", accountNo: "", ifsc: "", branch: "", accountType: "Current" },
    upi:  { id: "", payee: "Eximburg International Pvt Ltd" },   // QR is generated with the exact amount
    /* production timeline used to plan each order (days) */
    timeline: { labelDays: 15, packagingDays: 10, approvalMin: 60, approvalMax: 90, packsPerDay: 235, minMfgDays: 20, qcDays: 2, dispatchDays: 5 },
    gstNote_en: "Amounts shown are before GST. Accounts adds GST on your tax invoice.",
    gstNote_hi: "दिखाई गई राशि GST से पहले की है। अकाउंट्स टीम टैक्स इनवॉइस पर GST जोड़ती है।",

    offer: {
      enabled: true, threshold: 1000000, worth: 90000, months: 3,
      title_en: "Free seller-account setup + 3 months management",
      title_hi: "सेलर अकाउंट सेटअप + 3 महीने का मैनेजमेंट फ्री",
      detail_en: "We open your online seller accounts and run them for your first 3 months.",
      detail_hi: "हम आपके ऑनलाइन सेलर अकाउंट खोलते हैं और पहले 3 महीने उन्हें चलाते हैं।"
    },

    /* Brands shown on the "Brands we built" page. Add client brands only with
       the owner's written permission. Edit in admin.html → Settings. */
    testimonials: [
      { brand: "Royal Swag", tag_en: "Our own brand", tag_hi: "हमारा अपना ब्रांड", color: "#1B1B1B",
        place: "India, USA, Canada, UK", since: "2016", stat_en: "50,000–60,000 packs every month", stat_hi: "हर महीने 50,000–60,000 पैक",
        quote_en: "Built on the same line, the same recipes and the same influencer playbook your brand gets.",
        quote_hi: "उसी लाइन, उन्हीं रेसिपी और उसी इन्फ्लुएंसर प्लेबुक पर बना जो आपके ब्रांड को मिलती है।",
        person: "Eximburg team" }
    ]
  }
};
