/*
  The 15 portal sections, in order, and the schema number written on every new analytics row.

  Schema 1 (no field, or stepSchema: 1): the old 13-step numbering (benefits was 7, launchpad 8, book 13).
  Schema 2: brands is 7, orders is 15. Launchpad, profit and mindset are 9, 10 and 13.
  Schema 3: "Brands we built" is no longer a customer step. Book is 13, orders is 14.
  Rows are stored with the section id, so old rows stay correct; the schema field is how you tell them apart.
*/
export const STEP_SCHEMA = 3;

export const STEP_IDS = [
  "home", "what", "market", "future", "target", "about",
  "benefits", "launchpad", "profit", "influencer", "process", "mindset", "book", "orders"
];

export const STEP_LABELS = {
  home: "Dashboard",
  what: "Herbal Cigarettes",
  market: "Market size",
  future: "Future scope",
  target: "Target customers",
  about: "About Eximburg",
  benefits: "Why this business",
  launchpad: "Brand launchpad",
  profit: "Profit plan",
  influencer: "Influencer plan",
  process: "Manufacturing process",
  mindset: "Business mindset",
  book: "Book your slot",
  orders: "My orders"
};

export const STEP_NO = Object.fromEntries(STEP_IDS.map((id, i) => [id, i + 1]));

export const HEARTBEAT_MS = 60 * 1000;

export const stepNoOf = (id) => STEP_NO[id] || 0;
