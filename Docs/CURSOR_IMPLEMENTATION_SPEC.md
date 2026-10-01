# Eximburg Private-Label Portal — Implementation Spec for Cursor

> **Read this whole file before writing code.**
> You are working inside an app that is **already built, deployed, and connected to Firebase**, with an analytics script and database already set up.
> Your job is to **integrate** the features described here into the existing app — **not** to start a new project, not to replace the existing stack, and not to remove anything that already works.

---

## 0. How to use this spec

### 0.1 Reference files (dropped into the repo by the owner)

| File | What it is | How to use it |
|---|---|---|
| `reference/index.html` | Working prototype of the **customer portal** (single file, demo mode uses localStorage) | Source of truth for **customer screens, copy (English + Hindi), calculations and flows**. Open it in a browser to click through. |
| `reference/admin.html` | Working prototype of the **team panel** (Admin / Accounts / Production) | Source of truth for **staff screens, tabs, KPIs, rules**. Demo logins: Admin `9000000001 / admin@123`, Accounts `9000000002 / accounts@123`, Production `9000000003 / production@123`. |
| `reference/config.js` | Default settings | Port into Firestore `settings/portal` (see §7.2). |
| `reference/supabase-setup.sql` | The server-side rules written for Supabase/Postgres | **Logic reference only.** Every function in it must be re-implemented as a **Firebase Cloud Function** (see §8). Do **not** add Supabase. |

The data layer inside both HTML files (search for `Eximburg portal data layer`) contains a complete **demo implementation** of every server action in JavaScript (`demoImpl`). It is the clearest executable description of the business rules — mirror its validations in Cloud Functions.

### 0.2 Mandatory first step: inventory, then gap list

Before changing anything, produce `docs/PORTAL_GAP_ANALYSIS.md` containing:

1. **Stack inventory:** framework, router, UI library, state management, i18n solution, Firebase SDK version (modular v9+ expected), Functions runtime/region, hosting, existing Firestore collections, existing Storage paths, existing security rules, existing auth providers, existing analytics (GA4 / Firebase Analytics / custom Firestore logging).
2. **Feature map:** for every feature in §5–§6 of this spec, mark `exists / partial / missing`, with file paths.
3. **Naming conflicts:** existing collections or fields that overlap with §7 (reuse and extend existing ones instead of creating duplicates; document the mapping).
4. **Migration risks:** anything that would break current users or deployed data.

Then implement in the phases of §13. **Ask the owner** before any destructive change (renaming collections, changing auth provider, deleting fields).

### 0.3 Non-negotiables (apply everywhere)

- **Production staff must never see money.** No ₹ amounts, percentages, UTR numbers, payment slips, prices, order values or leads — on any Production screen, for any login (including Admin viewing the Production board). Enforce with **data separation + security rules**, not just hidden UI (§7.6, §9).
- **No fake urgency.** Slot counts, "slot booked" pop-ups and timers must come from real data only. Never generate fake bookings or timer-based "slot filled" alerts. (India's CCPA *Guidelines for Prevention and Regulation of Dark Patterns, 2023* prohibit false urgency.)
- **All money and slot logic runs server-side** (Cloud Functions). The client never decides price, amount due, slot number or stage.
- **Bilingual:** every customer-facing string in English and Hindi, matching the reference copy. Staff panel is English only.
- **No health, safety or quit-smoking claims** anywhere. Customer portal is 18+ gated.
- **Company data stays internal:** customers only see the public-safe facts listed in §1.2.

---

## 1. Business context

### 1.1 What the product does
Eximburg International Pvt. Ltd. (Surat, Gujarat) manufactures herbal cigarettes. The portal lets a prospect **build their own private-label brand without a sales call**:
plan a batch → see profit → book a monthly production slot → pay in milestones by bank/UPI with slip upload → track production live → receive invoice, e-way bill, QC report and transport details.
The team panel runs the back office: lead tracking, live activity, payment verification, dispatch desk, production board and order timelines.

### 1.2 Public-safe facts (the only company facts customers may see)
Founded 2016 · 12,000 sq ft factory · 1,00,000 packs/month capacity · 20+ SKUs · FDCA Gujarat licence GA/1957 · named in Technavio US Herbal Cigarette report 2026–2030 · Royal Swag (own brand): ~10 years, 50,000–60,000 packs/month, sold in India, USA, Canada, UK, seen in Mirzapur and Bollywood films, ₹185 MRP for 10 sticks.
Do **not** show internal sales, targets, staff counts, rejection rates, or "250+ brands / 150+ SKUs" claims.

### 1.3 Flavours (fixed list)
| Key | EN | HI | Pack colour | Text colour |
|---|---|---|---|---|
| clove | Clove | क्लोव | `#4E2F1C` | `#FFFFFF` |
| regular | Regular | रेगुलर | `#1B1B1B` | `#FFFFFF` |
| mint | Mint | मिंट | `#5BB8DD` | `#0C2A36` |
| frutta | Frutta | फ्रूटा | `#E8741E` | `#FFFFFF` |
| pan | Pan | पान | `#2E7D32` | `#FFFFFF` |
| ginger | Ginger | जिंजर | `#D9B85C` | `#2A2008` |

---

## 2. Roles and permissions

| Capability | Customer | Accounts | Production | Admin |
|---|---|---|---|---|
| Own profile, plan, bookings, payments, documents | ✅ own only | — | — | — |
| See leads, profiles, activity events | — | ✅ | ❌ | ✅ |
| See bookings with money (order value, payments, slips, UTRs) | own only | ✅ | ❌ **never** | ✅ |
| Verify / reject payment slips | — | ✅ | — | ✅ |
| Set shipping charge, upload invoice + e-way bill | — | ✅ | — | ✅ |
| See production orders (money-free mirror) | — | ✅ | ✅ | ✅ |
| Move order to next production step | — | — | ✅ (one step forward only) | ✅ |
| Submit QC (report required) / mark dispatched | — | — | ✅ | ✅ |
| Override any stage | — | — | — | ✅ |
| Edit settings, assign roles | — | — | — | ✅ |
| Live activity tab | — | — | — | ✅ |

**Role storage:** Firebase Auth **custom claims** `{ role: "customer" | "accounts" | "production" | "admin" }`, mirrored in `profiles/{uid}.role` for display. Only the `setRole` callable (admin) changes claims. Clients must call `getIdToken(true)` after a role change.

**Bootstrap first admin:** add a one-off script `scripts/make-admin.ts` (Admin SDK) that sets the claim for a given phone/UID, or a Functions env var `ADMIN_UIDS` checked on profile creation. Document it in the README.

---

## 3. Pricing, plan and offer engine (exact rules)

Keep these as shared constants (one module used by client UI **and** Cloud Functions; functions are the authority).

```ts
export const PRICING = {
  lot: 1000,                 // packs are printed in lots of 1,000 per flavour
  minPacks: 7000,            // minimum order: 7,000 packs × ₹90 = ₹6,30,000
  maxPacks: 30000,
  maxFlavours: 6,
  approvalFeePerFlavour: 6000, // ₹, one time, per flavour
  tiers: [                   // price per pack by total packs
    { packs: 0,     price: 90 },  // 7,000–8,000
    { packs: 9000,  price: 87 },  // 9,000–11,000
    { packs: 12000, price: 85 },  // 12,000–13,000
    { packs: 14000, price: 83 },  // 14,000+
  ],
  budgetPresets: [630000, 800000, 1000000, 1200000],
};
export const priceForPacks = (p: number) =>
  p >= 14000 ? 83 : p >= 12000 ? 85 : p >= 9000 ? 87 : 90;
```

- **Batch** = sum of flavour packs; each flavour ≥ 1,000 and a multiple of 1,000; total ≥ 7,000 and multiple of 1,000; 1–6 flavours.
- **Budget → batch (smart match):** `round(budget / price)` to the nearest lot, never below `max(n × 1000, 7000)`. Example: ₹6,00,000 → 7,000 packs (min). Allocation spreads lots evenly; extra lots go to the **hero flavour** first.
- **Order value** = packs × price. **Approval fee** = flavours × ₹6,000.
- **Payment milestones** (server-computed):

| Key | Label EN | Label HI | Due at stage | Amount |
|---|---|---|---|---|
| `booking10` | 10% booking slot amount | 10% स्लॉट बुकिंग राशि | `awaiting_payment` | 10% × order value |
| `approval40` | 40% + approval fee | 40% + अप्रूवल फीस | `awaiting_40` | 40% × order value + approval fee |
| `delivery50` | 50% balance before dispatch | डिस्पैच से पहले 50% बैलेंस | `awaiting_50` | 50% × order value |
| `shipping` | Shipping charges | शिपिंग चार्ज | `awaiting_shipping` | `shipping_charge` set by Accounts |

All amounts are **before GST**; show the GST note from settings ("Accounts adds GST on your tax invoice"). Round to whole rupees.

- **Special offer** (from settings): if `offer.enabled` and order value ≥ `offer.threshold` (default ₹10,00,000) → "Free seller-account setup + 3 months management, worth ₹90,000". The UI shows the gap and a one-click upgrade to the smallest batch that qualifies (12,000 packs = ₹10.20 L at ₹85). The booking stores `offer: true` (decided server-side).
- **Profit plan** (customer UI only; illustrative): MRP default ₹199/pack, selling cost default 35%, reorders default 2 — see `summary()` in `reference/index.html` for exact formulas (break-even packs, ROI, FD comparison at 7%, three-outcome table). Keep wording "estimated".

---

## 4. Order lifecycle (state machine)

### 4.1 Stages

| # | Key | EN (customer/office) | HI | Production sees as | Waiting on |
|---|---|---|---|---|---|
| 0 | `awaiting_payment` | Pay 10% booking amount | 10% बुकिंग राशि जमा करें | *(not visible)* | Customer |
| 1 | `payment_review` | Payment under verification | पेमेंट वेरिफ़िकेशन में | *(not visible)* | Accounts |
| 2 | `confirmed` | Slot confirmed | स्लॉट कन्फ़र्म | New order: start label | Production |
| 3 | `label_design` | Label design | लेबल डिज़ाइन | Label design | Production |
| 4 | `awaiting_40` | Pay 40% (approval & packaging) | 40% जमा करें (अप्रूवल व पैकेजिंग) | On hold: waiting for clearance | Customer |
| 5 | `approval_packaging` | Govt approval + packaging | सरकारी अप्रूवल + पैकेजिंग | Govt approval + packaging | Production |
| 6 | `manufacturing` | Manufacturing | मैन्युफैक्चरिंग | Manufacturing | Production |
| 7 | `qc` | Quality check | क्वालिटी चेक | Quality check | Production |
| 8 | `awaiting_50` | Pay 50% before dispatch | डिस्पैच से पहले 50% जमा करें | On hold: waiting for dispatch clearance | Customer |
| 9 | `shipping_quote` | Shipping charge being calculated | शिपिंग चार्ज तय हो रहा है | On hold: waiting for dispatch clearance | Accounts |
| 10 | `awaiting_shipping` | Pay shipping charges | शिपिंग चार्ज जमा करें | On hold: waiting for dispatch clearance | Customer |
| 11 | `docs_pending` | Invoice & e-way bill being prepared | इनवॉइस और ई-वे बिल बन रहा है | On hold: invoice & e-way bill being prepared | Accounts |
| 12 | `ready_dispatch` | Ready for dispatch | डिस्पैच के लिए तैयार | Ready to dispatch | Production |
| 13 | `dispatched` | Dispatched | डिस्पैच हो गया | Dispatched | Production |
| 14 | `delivered` | Delivered | डिलीवर हो गया | Delivered | — |
| — | `cancelled` | Cancelled | रद्द | *(not visible)* | — |

A booking is **active** unless `stage == cancelled` or (`stage == awaiting_payment` and `hold_until < now`).

### 4.2 Transitions (who → what)

| From | To | Triggered by | Callable | Rule |
|---|---|---|---|---|
| — | `awaiting_payment` | Customer | `bookSlot` | Allocates slot, sets `hold_until = now + holdHours` |
| `awaiting_payment` / `awaiting_40` / `awaiting_50` / `awaiting_shipping` | `payment_review` | Customer | `submitPayment` | Slip + UTR required; milestone must match stage |
| `payment_review` | `confirmed` / `approval_packaging` / `shipping_quote` / `docs_pending` | Accounts | `reviewPayment(ok)` | Per milestone 10/40/50/shipping |
| `payment_review` | back to the due stage | Accounts | `reviewPayment(reject)` | Reason required (customer sees it); a rejected 10% gets a fresh hold |
| `confirmed` → `label_design` → `awaiting_40` | | Production | `setStage` | One step forward only |
| `approval_packaging` → `manufacturing` → `qc` | | Production | `setStage` | One step forward only |
| `qc` | `awaiting_50` | Production | `submitQC` | **QC report file required** |
| `shipping_quote` / `awaiting_shipping` | `awaiting_shipping` (charge > 0) or `docs_pending` (charge = 0) | Accounts | `setShipping` | Note shown to customer |
| `docs_pending` / `ready_dispatch` | `ready_dispatch` | Accounts | `setDispatchDocs` | Invoice no./date, 12-digit e-way bill no., dates, valid-till, both files required |
| `ready_dispatch` | `dispatched` | Production | `markDispatched` | Transporter, vehicle no., LR/docket no. required |
| `dispatched` | `delivered` | Production | `setStage` | — |
| any | any | Admin | `setStage` | Override; note required in UI |

**Production cannot skip payment steps.** `setStage` for role `production` only accepts the next step from this map:
`confirmed→label_design, label_design→awaiting_40, approval_packaging→manufacturing, manufacturing→qc, dispatched→delivered`.
(`qc→awaiting_50` only via `submitQC`; `ready_dispatch→dispatched` only via `markDispatched`.)

Every transition writes an **update** record `{stage, note, by_role, by_name, created_at}` (§7.5). Customers see all updates on their order; Production sees a filtered version (§7.6).

---

## 5. Customer portal (port from `reference/index.html`)

### 5.1 Navigation (15 steps, sidebar with progress)
1 Dashboard · 2 Herbal Cigarettes · 3 Market size · 4 Future scope · 5 Target customers · 6 About Eximburg · 7 **Brands we built** · 8 Why this business · 9 Brand launchpad · 10 Your profit plan · 11 Influencer sales plan · 12 Manufacturing process · 13 Business mindset · 14 Book your slot · 15 **My orders & status**

- Sticky **plan bar** (hidden on Book and My orders): brand, order ₹, ₹/pack, packs, slot amount, **offer-unlocked badge**, live "N slots left", Book button.
- Sidebar badge on *My orders* = number of payments due.
- Language toggle EN/हिंदी everywhere; persist preference.
- If the existing app already has some of these pages, **keep its layout system** and port content/logic only.

### 5.2 Account (sign-up / sign-in)
- Tabs: **Create account** / **Sign in**.
- Create: name, mobile (10-digit, starts 6–9), password (6+), city, email (optional, validate if present), brand name (optional, max 22), **18+ confirmation** checkbox.
- Sign in: mobile + password. "Forgot password" text points to WhatsApp/email.
- **Auth method:** check what the existing app uses first.
  - If it already uses **Firebase Phone Auth (OTP)** → keep it, add password-less flow consistently.
  - If not → use **Email/Password provider with a synthetic email**: `91{mobile}@phone.eximburg.in` (no emails are sent). Store the real email in the profile.
- On sign-up create `profiles/{uid}` with `role: "customer"` (rules forbid any other value from the client).
- After sign-in, if a payment is due → land on *My orders*.
- Log `signup` / `login` events (§10).

### 5.3 Brand launchpad, profit plan, influencer plan, mindset
Port exactly from the reference (3D CSS pack viewer, hero flavour picker, lot mover, smart budget match, price ladder, Gantt timeline, profit sliders, readiness quiz). Add the **offer banner** (§3) at the top of Dashboard, Launchpad and Profit plan; it updates live as the plan changes.

### 5.4 Brands we built (testimonials)
Cards from `settings.portal.testimonials` (brand, colour, label, since, sold in, result stat, quote, person — EN/HI fields). Royal Swag is the default card. Below: "What stands behind every pack" checklist (public-safe facts). **Client brands only with written owner consent** (show this hint in the admin editor).

### 5.5 Book your slot
- **Slot board:** `royalSwagReserved` dark cells (RS), then client slots 1..N: offline-booked (✓), online-booked (✓), **"You"** for the user's own active slot, open cells. Data from `slot_months/{YYYY-MM}` (§7.3) via `onSnapshot`.
- Real urgency only: "Only N client slots left for {month}", days left in month, price-lock countdown to `priceValidTill`, "cost of waiting a month" = first-batch profit.
- If the current month is full: note "Booking now reserves the first open slot in {next month}".
- Form: full name, mobile, brand, city, GSTIN (optional; validate `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`), preferred call time, confirmation checkbox (payment terms).
- Submit → `bookSlot` callable → show **Payment page**.
- "Request a 15-minute call" path stays (logs `call_request`).

### 5.6 Payment page (used for every milestone; also inline in My orders)
- Header: "Slot {n} of {N} is held for {brand}", production month, booking code, packs × price, order value.
- **Hold countdown** (`hold_until`, HH:MM:SS) for the 10% only: "after this, the slot goes back to the queue".
- Offer card if `offer == true`.
- **Step 1 — Pay:** milestone label, big amount + Copy; for 40% show "(includes ₹X approval fee)"; GST note; for shipping show the Accounts shipping note.
  - **Bank transfer** table (account name, bank, account no., IFSC, branch, type) — each with Copy.
  - **UPI**: QR generated client-side from `upi://pay?pa={upi.id}&pn={payee}&am={amount}.00&cu=INR&tn={bookingCode}` (any QR lib already in the app, else `qrcode`). If amount > ₹1,00,000 show "Most banks cap UPI at ₹1 lakh a day. Use bank transfer." and hide the "Open UPI app" button (mobile-only button otherwise).
  - "Write {bookingCode} in the payment remarks".
- **Step 2 — Upload slip:** amount paid (prefilled), payment date (≤ today), UTR/reference (≥ 6 chars), file (JPG/PNG/WEBP/PDF ≤ 5 MB; compress photos > 900 KB to max 1600 px JPEG q 0.82 before upload) → `submitPayment`.
- After submit: "Payment received. Accounts is verifying it" (usually within 4 working hours), Track button.
- Don't re-render the page while the user is typing in a payment form (live updates arrive via snapshots).

### 5.7 My orders
Per booking card:
- Brand, code, slot + month, packs + flavour split, order value, current stage pill (red = customer action, gold = waiting on us, green = in progress), offer line.
- **Tracker (10 steps):** Slot reserved → 10% verified → Label design → 40% verified → Manufacturing → Quality check → 50% verified → Shipping paid, invoice ready → Dispatched → Delivered. (Step *i* is done when current stage index > that step's anchor stage: anchors `awaiting_payment, confirmed, label_design, approval_packaging, manufacturing, qc, shipping_quote, ready_dispatch, dispatched, delivered`.)
- Hold expired → message + "Book again".
- Payment due → inline payment block (§5.6).
- **Documents:** QC report (date, Download), Tax invoice (no., date, Download), E-way bill (no., valid till, Download), Dispatched (date, transporter), Vehicle / LR no.
- Payments table: milestone, amount, UTR, submitted, status (Verified / Rejected + reason / Under verification).
- "Updates from our team" (newest first, with name and role).
- Live via `onSnapshot`; show a toast when stage changes ("Update on EXB-…: {stage}").

### 5.8 Live booking toasts (real data only)
Read `slot_events` (last 30 days, max 8). Show each real event once per session ("A brand from {city} booked slot {n} for {month}", time-ago), first after 15 s then every 50 s; new events in real time via snapshot. Skip the user's own booking. **Never generate synthetic events.**

---

## 6. Team panel (port from `reference/admin.html`)

Route suggestion: `/team` (or match the existing admin route). Not linked from customer pages; `noindex`.
Role → tabs:
- **Admin:** Overview, Live activity, Leads & activity, Slot bookings, Payments, Dispatch desk, Production board, Order timeline, Settings, Team
- **Accounts:** Overview, Payments, Dispatch desk, Slot bookings, Leads & activity
- **Production:** Production board, Order timeline

Landing tab: Admin → Overview; Accounts → Payments (or Dispatch desk if no slips waiting but desk work exists); Production → Production board.
Staff sign-up from the panel creates a normal profile with no access; Admin assigns role in **Team**. A signed-in user without a staff role sees "No staff access yet".
Sidebar badges: Payments = slips to verify; Dispatch desk = `shipping_quote` + `docs_pending`; Production = `confirmed` + `ready_dispatch`.

### 6.1 Overview (Admin, Accounts)
Range chips 7 / 30 / 90 days / All time.
KPIs: Visitors (unique `session_id` with `visit`), Sign-ups (customer profiles created; % of visitors), Slots booked (non-cancelled; order value), Slips to verify (count + ₹; red when > 0), Collected (verified payments by review date), In production (stage confirmed…before delivered; open pipeline ₹).
**Funnel:** Visitors → Created account → Planned a batch (`plan_change` or viewed launchpad) → Opened booking → Booked a slot → Uploaded slip → Payment verified, with % of previous step.
Sign-ups per day (14-day bar chart). Slot board for current + next month (RS dark, offline gold, held pink, paid/confirmed green, open). Latest activity (12) with "Open live activity".

### 6.2 Live activity (Admin)
- Live indicator + last update time; **online now** = distinct users/sessions with an event in the last 5 minutes (names clickable).
- Today: visitors, sign-ups, plans changed, slots booked, slips uploaded, team actions.
- Filters: All / Visitors / Sign-ups & logins / Browsing & plans / Bookings / Payments / Team.
- Stream (latest 150): customer events (§10) merged with staff updates ("Production team (production) moved EXB-… to Manufacturing — note"). Anonymous visitors labelled "Visitor #abcd" (last 4 of session id); if the session later signed in, show the name. New rows highlighted.
- Real-time via `onSnapshot` on `events` (ordered by `created_at desc`, limit 300) and on updates.

### 6.3 Leads & activity (Admin, Accounts)
Search (name, mobile, city, brand, email); filters All / Exploring / Booked / In production / Lapsed; CSV export (UTF-8 BOM).
Columns: name/brand, mobile, city, joined, last active, sections explored (n/15), last plan (packs, ₹), status.
**Lead status:** no active bookings → "Slot lapsed" (had bookings) / "Opened booking" / "Planning" / "Signed up"; else by max active stage → "Delivered" / "In production" (≥ confirmed) / "Slip uploaded" / "Booked, unpaid".
Lead drawer: WhatsApp (`https://wa.me/91{mobile}`), Call, Email; profile; bookings; full activity timeline.

### 6.4 Slot bookings (Admin, Accounts)
Filters: Active / Waiting 10% / Slip to verify / In production / Dispatched / Lapsed-cancelled / All; month select.
Booking drawer (finance view): customer, GSTIN, call time; batch, approval fee, flavours, offer; **payment schedule** with expected amounts and status (shipping row shown when relevant); payment slips; documents; "Open dispatch desk" shortcut; production timeline; history; Admin **Set stage (override)** with note.

### 6.5 Payments (Admin, Accounts)
Filters To verify / Verified / Rejected / All.
Card: brand + code, milestone, amount paid vs expected (**mismatch highlighted**), UTR, paid on, customer + WhatsApp, submitted time, slip preview (signed URL / image inline, PDF opens in new tab), note input, **Verify** (confirm dialog: "Confirm the UTR is in the bank statement") / **Reject** (reason required).

### 6.6 Dispatch desk (Admin, Accounts)
1. **Set shipping charge** (`shipping_quote`): amount ₹ + note (mode, transporter, ETA) → `setShipping`. 0 = pickup/free → straight to invoicing.
2. **Waiting for customer to pay shipping** (`awaiting_shipping`): amount, note, since.
3. **Create tax invoice & e-way bill** (`docs_pending`): shows order + approval + shipping = total before GST and GSTIN; fields invoice no., invoice date, e-way bill no. (12 digits, spaces allowed in input), e-way bill date, valid till (default tomorrow; must not be in the past), invoice file, e-way bill file → `setDispatchDocs` → Ready to dispatch.
4. **Cleared, waiting for Production** (`ready_dispatch`): document links.
Do not re-render while the user has typed into these forms.

### 6.7 Production board (Production, Admin) — **money-free for every login**
Reads only `production_orders` (§7.6).
KPIs: New orders to start, In progress, On hold, Behind plan (red), Dispatch due in 7 days, Dispatched this month.
Columns: New order: start label · Label design · Govt approval + packaging · Manufacturing · Quality check · Ready to dispatch · Dispatched · **On hold** (dashed; all hold stages; "Paused until Accounts clears the next step").
Card: brand, code, packs, flavours count, plan status chip, target dispatch; for ready_dispatch also invoice no. + e-way bill no. + expiry warning.
Action button labels (no payment wording):
`label_design` "Start label design" · `awaiting_40` "Label approved: send for clearance" · `manufacturing` "Packaging ready: start manufacturing" · `qc` "Manufacturing done: start QC" · `delivered` "Mark as delivered".
Each opens a confirm dialog with an optional customer note and a hint placeholder.
- **QC stage:** button "QC passed: upload report" → dialog with **required** QC report file (PDF/photo, ≤ 5 MB) + optional note → `submitQC`.
- **Ready to dispatch:** "Dispatch now" → dialog: transporter, vehicle no. (uppercase), LR/docket no. (all required), dispatch date (≤ today), note → `markDispatched`.
Order drawer: order details (brand, customer name, city, phone with Call/WhatsApp, packs + sticks, flavour split table with print lots), documents (QC report, invoice, e-way bill with expiry warning, dispatch details; "Print invoice and e-way bill and hand them to the transporter"), **timeline to dispatch** (§6.8), history (payment/finance updates removed; only Production/Admin notes shown).

### 6.8 Order timeline (Production, Admin)
Table sorted: behind-plan first, then by target dispatch. Columns: order, brand/city, packs, current step, step due, target dispatch (+ latest), status.
**Plan formula** (timeline settings, defaults `labelDays 15, packagingDays 10, approvalMin 60, approvalMax 90, packsPerDay 235, minMfgDays 20, qcDays 2, dispatchDays 5`):
```
start  = time of first update with stage "confirmed" (fallback updated_at)
h40    = days spent in awaiting_40 (until approval_packaging, or now if still there)
h50    = days from entering awaiting_50 until ready_dispatch (or now)   // covers all finance holds after QC
md     = max(minMfgDays, ceil(packs / packsPerDay))
label        : start            → start + labelDays
packaging    : lEnd + h40       → + packagingDays           (govt approval approvalMin–approvalMax runs alongside)
manufacturing: pEnd             → + md
qc           : mEnd             → + qcDays
dispatch     : max(qEnd, pStart + approvalMin) + h50 → + dispatchDays    = target dispatch
latest       : max(qEnd, pStart + approvalMax) + h50 + dispatchDays
```
Row done when stage index ≥ `awaiting_40` / `manufacturing` / `qc` / `awaiting_50` / `dispatched` respectively. Status: Done (n d early/late) · In progress · Ready to start · n d behind · On hold · Planned. **Customer payment waiting time is never counted against Production.**

### 6.9 Settings (Admin)
Production slots (slots/month, Royal Swag reserved, offline bookings for current and next month, hold hours, price-lock date) · Production timeline (8 numbers) · Contact (WhatsApp `91XXXXXXXXXX`, email) · Payment details (bank fields, UPI ID, payee, GST note EN/HI) · Special offer (enabled, threshold, worth, title/detail EN/HI) · Testimonials editor (add/remove, EN + HI fields) · Validation: RS < total, WhatsApp format, IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`.

### 6.10 Team (Admin)
Staff list with role select (`No staff access / Production / Accounts / Admin`); search any profile (3+ chars) to grant access → `setRole`. Admin cannot remove their own admin role.

---

## 7. Firestore data model

> If equivalent collections already exist, extend them and record the mapping in the gap analysis. Field names below are the contract the UI expects.

### 7.1 `profiles/{uid}`
```ts
{ name: string; phone: string /*10 digits*/; email?: string; city?: string; brand?: string;
  role: "customer" | "accounts" | "production" | "admin";   // mirror of custom claim
  created_at: Timestamp; last_active_at?: Timestamp }
```

### 7.2 `settings/portal` (public read, admin write)
```json
{
  "monthSlots": 15, "royalSwagReserved": 8, "offlineSlots": { "2026-10": 4 }, "holdHours": 48,
  "priceValidTill": "2026-10-31", "whatsapp": "", "email": "eximburg@gmail.com",
  "bank": { "accountName": "", "bankName": "", "accountNo": "", "ifsc": "", "branch": "", "accountType": "Current" },
  "upi":  { "id": "", "payee": "Eximburg International Pvt Ltd" },
  "gstNote_en": "Amounts shown are before GST. Accounts adds GST on your tax invoice.",
  "gstNote_hi": "दिखाई गई राशि GST से पहले की है। अकाउंट्स टीम टैक्स इनवॉइस पर GST जोड़ती है।",
  "timeline": { "labelDays": 15, "packagingDays": 10, "approvalMin": 60, "approvalMax": 90, "packsPerDay": 235, "minMfgDays": 20, "qcDays": 2, "dispatchDays": 5 },
  "offer": { "enabled": true, "threshold": 1000000, "worth": 90000, "months": 3,
    "title_en": "Free seller-account setup + 3 months management", "title_hi": "सेलर अकाउंट सेटअप + 3 महीने का मैनेजमेंट फ्री",
    "detail_en": "We open your online seller accounts and run them for your first 3 months.",
    "detail_hi": "हम आपके ऑनलाइन सेलर अकाउंट खोलते हैं और पहले 3 महीने उन्हें चलाते हैं।" },
  "testimonials": [ { "brand": "Royal Swag", "tag_en": "Our own brand", "tag_hi": "हमारा अपना ब्रांड", "color": "#1B1B1B",
    "place": "India, USA, Canada, UK", "since": "2016", "stat_en": "50,000–60,000 packs every month", "stat_hi": "हर महीने 50,000–60,000 पैक",
    "quote_en": "Built on the same line, the same recipes and the same influencer playbook your brand gets.",
    "quote_hi": "उसी लाइन, उन्हीं रेसिपी और उसी इन्फ्लुएंसर प्लेबुक पर बना जो आपके ब्रांड को मिलती है।", "person": "Eximburg team" } ]
}
```
Client merges saved settings over these defaults (one level deep for objects).

### 7.3 `slot_months/{YYYY-MM}` (public read, functions write)
```ts
{ month: "2026-10"; client_slots: number /* monthSlots − royalSwagReserved */; offline: number;
  taken: number[] /* active online slot numbers */; updated_at: Timestamp }
```
Month key is computed in **Asia/Kolkata** time. Recomputed by functions on every booking write and by the scheduled hold-expiry job (§8.3). Customer UI: `booked = offline + taken.filter(n > offline).length`, `left = client_slots − booked`.

### 7.4 `bookings/{bookingId}` (owner + office read; functions write)
```ts
{ code: "EXB-YYMMDD-XXXX"; user_id: string; name; phone; brand; city; gstin; call_time;
  slot_month: "YYYY-MM"; slot_no: number;
  packs: number; price: number; order_value: number; approval_fee: number;
  flavours: { name: string; packs: number }[]; offer: boolean;
  stage: StageKey; hold_until: Timestamp;
  shipping_charge: number /*default 0*/;
  dispatch: { shipping_note?; qc_path?; qc_at?; qc_note?; qc_by?;
              invoice_no?; invoice_date?; invoice_path?; eway_no?; eway_date?; eway_valid_till?; eway_path?;
              transporter?; vehicle_no?; lr_no?; dispatched_on? };
  created_at; updated_at }
```
Subcollection **`bookings/{id}/updates/{autoId}`**: `{ stage, note, by_role: "system"|"customer"|"accounts"|"production"|"admin", by_name, created_at }`.

### 7.5 `payments/{paymentId}` (owner + office read; functions write)
```ts
{ booking_id; user_id; milestone: "booking10"|"approval40"|"delivery50"|"shipping";
  amount: number; expected: number; utr: string /*uppercase, trimmed*/; paid_on: "YYYY-MM-DD";
  slip_path: string; status: "submitted"|"verified"|"rejected"; note: string;
  reviewed_by?: uid; reviewed_at?: Timestamp; created_at }
```
Also maintain `utr_index/{UTR}` (functions only) to block duplicate UTRs (non-rejected).

### 7.6 `production_orders/{bookingId}` — money-free mirror (production + office read; functions write)
Written by a trigger whenever a booking or its updates change, **only** when stage ∈ `confirmed … delivered` (incl. hold stages); deleted otherwise.
```ts
{ id; code; brand; name; city; phone; slot_month; slot_no; packs; flavours; stage; created_at; updated_at;
  dispatch: { qc_path?, qc_at?, qc_note?, qc_by?,                                   // always when present
              invoice_no?, invoice_date?, invoice_path?, eway_no?, eway_date?,     // only when stage ∈ ready_dispatch/dispatched/delivered
              eway_valid_till?, eway_path?, transporter?, vehicle_no?, lr_no?, dispatched_on? };
  updates: { stage, note /* "" unless by_role ∈ production|admin */, by_role, by_name, created_at }[]  // excluding awaiting_payment, payment_review, cancelled
}
```
**Never** copy `price, order_value, approval_fee, shipping_charge, offer, gstin, hold_until`, payment data or Accounts notes into this document. The Production UI (and Admin when on Production tabs) reads only this collection.

### 7.7 `events/{autoId}` (create: anyone, validated; read: office)
```ts
{ session_id: string /*random id persisted in localStorage*/; user_id: string|null; type: EventType; meta: map; created_at: serverTimestamp }
```
Configure a **TTL policy** on `created_at` (e.g. 180 days) to control cost.

### 7.8 `slot_events/{autoId}` (public read; functions write)
`{ slot_month, slot_no, city, created_at }` — no personal data. Powers live booking toasts.

### 7.9 Indexes
- `bookings`: `user_id ASC, created_at DESC`; `slot_month ASC, stage ASC`; `stage ASC, updated_at ASC`
- `payments`: `status ASC, created_at DESC`; `booking_id ASC, created_at ASC`
- `events`: `created_at DESC`; `user_id ASC, created_at DESC`
- `slot_events`: `created_at DESC`
Add them to `firestore.indexes.json`.

---

## 8. Cloud Functions (v2, region `asia-south1` unless the app already uses another)

All callables: verify `request.auth`, read role from `request.auth.token.role`, validate inputs, run in a **transaction**, write an update record, and return friendly error messages (`HttpsError` with the exact texts below — the UI shows them).

### 8.1 Callables

| Name | Who | Input | Logic (mirror `demoImpl` + SQL) |
|---|---|---|---|
| `bookSlot` | signed-in customer | `{name, phone, brand, city, gstin, call_time, packs, flavours[]}` | Validate batch (§3). Max 2 unpaid active holds per user ("You already have 2 unpaid slots on hold…"). In a transaction: lock `slot_months/{m}`, query active bookings of month `m`, take the lowest free slot in `offline+1 … client_slots`; if none, try next month (up to 12; else "All production slots for the next 12 months are full. Please contact us."). Server computes price, order value, approval fee, offer. Create booking (`awaiting_payment`, `hold_until`), update profile brand, write `slot_events`, update `slot_months`, write update "Slot {n} reserved for {m}. Pay the 10% booking amount within {h} hours to confirm." |
| `submitPayment` | booking owner | `{booking_id, milestone, amount, utr, paid_on, slip_path}` | Stage must have a due milestone and it must equal `milestone` ("This payment does not match the amount due."). UTR ≥ 6 chars; not in `utr_index` unless rejected ("This UTR has already been submitted."). `slip_path` must start with `payment-slips/{uid}/{booking_id}/`. If 10% hold expired: if slot taken by another active booking → cancel this booking and return `{ok:false, error:"Your hold expired and this slot was taken. Please book a new slot — your slip was not submitted."}`; else proceed. Compute `expected`. Create payment, set stage `payment_review`, update "Payment slip submitted (UTR …)." |
| `reviewPayment` | accounts, admin | `{payment_id, ok, note}` | Must be `submitted`. Reject requires note ("Write the reason for rejection — the customer will see it."). Map milestone → next stage (§4.2); on reject return to due stage (10% gets new hold). Update note "Payment of ₹X verified by Accounts." / "Payment slip rejected: {note}". |
| `setShipping` | accounts, admin | `{booking_id, amount, note}` | Stage `shipping_quote`/`awaiting_shipping`; amount ≥ 0; set `shipping_charge`, `dispatch.shipping_note`; stage `awaiting_shipping` (>0) or `docs_pending` (0). |
| `setDispatchDocs` | accounts, admin | `{booking_id, invoice_no, invoice_date, eway_no, eway_date, eway_valid_till, invoice_path, eway_path}` | Stage `docs_pending`/`ready_dispatch`; all required; e-way bill `^\d{12}$`; paths under `dispatch-docs/{booking_id}/`. Stage → `ready_dispatch`. Update "Invoice {no} and e-way bill {no} ready. Cleared for dispatch." |
| `submitQC` | production, admin | `{booking_id, qc_path, note}` | Stage must be `qc`; `qc_path` required under `dispatch-docs/{booking_id}/qc-*`. Set `dispatch.qc_*`, stage `awaiting_50`. Update "QC passed. Report attached. {note}". |
| `markDispatched` | production, admin | `{booking_id, transporter, vehicle_no, lr_no, dispatched_on, note}` | Stage `ready_dispatch`; three fields required ("Fill transporter, vehicle number and LR / docket number."). Uppercase vehicle no. Stage `dispatched`. Update "Dispatched by {t}, vehicle {v}, LR {lr}. {note}". |
| `setStage` | production (next step only), admin (any) | `{booking_id, stage, note}` | Production: only the map in §4.2; else "Your role cannot move this order to that stage." Admin: any valid stage. |
| `setRole` | admin | `{uid, role}` | Set custom claim + `profiles.role`. Cannot demote self. |
| `updateMyProfile` | signed-in | `{brand?, city?}` | Optional if rules allow direct self-update of these two fields. |

### 8.2 Triggers
- `onDocumentWritten("bookings/{id}")` and `onDocumentCreated("bookings/{id}/updates/{u}")` → **sync `production_orders/{id}`** (§7.6) and **recompute `slot_months`** for the booking's month.
- `onDocumentWritten("settings/portal")` → recompute `slot_months` for current and next month (slot counts or offline numbers may have changed).

### 8.3 Scheduled
- Every 10 minutes: recompute `slot_months` for current + next month (expired holds free up slots). Optionally write a `system` update on bookings whose hold just expired.

### 8.4 Shared helpers
`monthKeyIST(date)`, `addMonth(key)`, `isActive(booking, now)`, `dueMilestone(stage)`, `dueAmount(booking, milestone)`, `priceForPacks(p)`, `prodShape(booking, updates)`. Put them in `functions/src/portal/` with unit tests.

---

## 9. Security rules

### 9.1 Firestore (merge with existing rules — do not drop current ones)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function role() { return signedIn() && request.auth.token.role is string ? request.auth.token.role : 'customer'; }
    function isOffice() { return role() in ['admin', 'accounts']; }
    function isProdView() { return role() in ['admin', 'accounts', 'production']; }

    match /profiles/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || isOffice());
      allow create: if signedIn() && request.auth.uid == uid
        && request.resource.data.role == 'customer'
        && request.resource.data.keys().hasOnly(['name','phone','email','city','brand','role','created_at']);
      allow update: if signedIn() && request.auth.uid == uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['brand','city','email','last_active_at']);
    }
    match /settings/{doc}      { allow read: if true; allow write: if role() == 'admin'; }
    match /slot_months/{m}     { allow read: if true; allow write: if false; }
    match /slot_events/{id}    { allow read: if true; allow write: if false; }

    match /events/{id} {
      allow read: if isOffice();
      allow create: if request.resource.data.keys().hasOnly(['session_id','user_id','type','meta','created_at'])
        && request.resource.data.type is string && request.resource.data.type.size() <= 40
        && request.resource.data.session_id is string && request.resource.data.session_id.size() <= 64
        && request.resource.data.created_at == request.time
        && ( (!signedIn() && request.resource.data.user_id == null)
          || (signedIn() && request.resource.data.user_id == request.auth.uid) );
    }

    match /bookings/{id} {
      allow read: if signedIn() && (resource.data.user_id == request.auth.uid || isOffice());
      allow write: if false;
      match /updates/{u} {
        allow read: if signedIn() && (isOffice()
          || get(/databases/$(db)/documents/bookings/$(id)).data.user_id == request.auth.uid);
        allow write: if false;
      }
    }
    match /payments/{id} {
      allow read: if signedIn() && (resource.data.user_id == request.auth.uid || isOffice());
      allow write: if false;
    }
    match /production_orders/{id} { allow read: if isProdView(); allow write: if false; }
    match /utr_index/{u}          { allow read, write: if false; }
  }
}
```

### 9.2 Storage
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function role() { return request.auth != null && request.auth.token.role is string ? request.auth.token.role : 'customer'; }
    function okFile() { return request.resource.size < 5 * 1024 * 1024
      && request.resource.contentType.matches('image/(jpeg|png|webp)|application/pdf'); }

    match /payment-slips/{uid}/{bookingId}/{file} {
      allow create: if request.auth != null && request.auth.uid == uid && okFile();
      allow read:   if request.auth != null && (request.auth.uid == uid || role() in ['admin','accounts']);
    }
    match /dispatch-docs/{bookingId}/{file} {
      allow create: if okFile() && (role() in ['admin','accounts']
                     || (role() == 'production' && file.matches('qc-.*')));
      allow read:   if request.auth != null && (role() in ['admin','accounts','production']
                     || firestore.get(/databases/(default)/documents/bookings/$(bookingId)).data.user_id == request.auth.uid);
    }
  }
}
```
Payment slips are **not** readable by Production.

---

## 10. Activity tracking and analytics

The app already has an analytics script. **Keep it.** Add a single `track(type, meta)` helper that:
1. sends the event to the **existing analytics** (e.g. `logEvent(analytics, type, meta)` for GA4/Firebase Analytics — reuse the existing wrapper if there is one), and
2. writes a document to Firestore `events` (needed for the real-time admin views; analytics data is not queryable live).

Skip tracking when the signed-in user is staff. Keep a persistent `session_id` (localStorage `exb_vid`). Send `visit` once per browser session.

| type | When | meta |
|---|---|---|
| `visit` | first page load in a session | `{ref, lang, mobile}` |
| `signup` | account created | `{city, brand}` |
| `login` | sign-in | `{}` |
| `section_view` | navigating to a portal step | `{id}` (step ids: home, what, market, future, target, about, brands, benefits, launchpad, profit, influencer, process, mindset, book, orders) |
| `plan_change` | plan changed (debounce 4 s; only when packs or flavour count changes) | `{packs, order, flavours}` |
| `offer_upgrade` | "Switch to N packs" clicked | `{packs}` |
| `slot_booked` | bookSlot success | `{code, packs, order}` |
| `payment_submitted` | submitPayment success | `{milestone, amount}` |
| `call_request` | "Request a 15-minute call" | `{}` |

If the existing analytics already captures some of these under other names, map them in the gap analysis and keep **one** source of truth for each event.

---

## 11. UX and design rules
- Reuse the existing design system. If none fits, use the reference tokens: bg `#F4F3EE`, surface `#FFFFFF`, ink `#1F2A24`, muted `#5B675F`, line `#DAD9CF`, rose `#A8324F`, leaf `#3F6B35`, gold `#B87F0C`, sidebar `#1F2A24`; Poppins (headings) + Mukta (body, Devanagari support); full dark-mode token set in the reference CSS.
- Responsive down to 390 px; visible keyboard focus; `prefers-reduced-motion` respected; safe-area insets.
- Stage pills: red = customer must act, gold = waiting on Eximburg, green = in progress / done.
- Never re-render a screen while the user is typing in a form; apply pending live updates on blur.
- Errors explain what to fix (copy in §8.1). Empty states invite the next action.
- Currency: Indian grouping (`₹6,30,000`), lakhs as `₹6.3 L` / `₹6.3 लाख`.

---

## 12. Compliance checklist
- 18+ confirmation at sign-up; no content aimed at minors.
- No health, safety, de-addiction or "quit smoking" claims; herbal cigarettes are not presented as safe.
- Influencer content must carry `#ad` disclosure (ASCI) — keep the reference checklist.
- Real slot data only; no fabricated bookings, counters or testimonials; testimonials need written consent.
- Payment slips and documents are private; signed URLs expire in 15 minutes.
- Phone numbers and GSTINs are personal/business data: never exposed to other customers or to public collections.

---

## 13. Implementation phases (each phase = PR + checklist)

1. **Gap analysis** (§0.2). No code changes.
2. **Foundations:** shared constants (§3, §4), settings doc + admin Settings screen, custom-claims roles + `setRole` + Team tab, Firestore/Storage rules, indexes.
3. **Customer accounts and booking:** sign-up/sign-in, `bookSlot`, `slot_months`, slot board, live booking toasts, offer banner, Brands page.
4. **Payments:** payment page, slip upload, `submitPayment`, Payments tab, `reviewPayment`, My orders (tracker, payments, updates, due badge).
5. **Production:** `production_orders` mirror trigger, Production board, `setStage`, `submitQC`, Order timeline.
6. **Dispatch:** Dispatch desk, `setShipping`, `setDispatchDocs`, `markDispatched`, documents in My orders and Production.
7. **Insights:** `track()` + events, Overview (KPIs, funnel, sign-ups chart, slot board), Leads + CSV, Live activity.
8. **Hardening:** scheduled hold expiry, unit tests for helpers, emulator tests for rules, E2E run of §14.

---

## 14. Acceptance tests (must all pass; run with the Firebase Emulator Suite)

**Customer**
- [ ] Sign-up with mobile + password; profile created with role `customer`; client cannot write `role: "admin"`.
- [ ] Plan at ₹6.30 L shows offer gap ₹3,90,000 and "Switch to 12,000 packs"; clicking it unlocks the offer (₹10.20 L at ₹85).
- [ ] Booking with 4 offline slots → gets **slot 5 of 7**; 10% = **₹1,02,000** for 12,000 packs; hold countdown ~48:00:00.
- [ ] Two parallel `bookSlot` calls never receive the same slot number.
- [ ] Full month → booking lands in next month with the explanatory note.
- [ ] Submitting a slip without file / with short UTR / duplicate UTR is rejected with the exact messages.
- [ ] UPI QR encodes the exact amount and booking code; amount > ₹1 L shows the bank-transfer note.

**Accounts**
- [ ] Payment card shows mismatch when amount ≠ expected; reject without reason is blocked.
- [ ] Verify 10% → customer sees "Slot confirmed" live; order appears on Production board.
- [ ] 40% for a 7,000-pack, 6-flavour order = ₹2,52,000 + ₹36,000 = **₹2,88,000**; 50% = **₹3,15,000**.
- [ ] After 50%: Dispatch desk → shipping ₹12,500 → customer sees "Pay shipping charges ₹12,500" with the note; ₹0 skips to invoicing.
- [ ] Invoice + e-way bill: non-12-digit e-way bill or missing file is rejected; success → Ready to dispatch.

**Production**
- [ ] Before the 10% is verified, Production sees **zero** orders.
- [ ] No "₹", no "%", no UTR, no slip on any Production screen — for the Production login **and** for Admin on Production tabs.
- [ ] Production cannot read `bookings`, `payments`, `events`, `profiles` (rules emulator test).
- [ ] Production cannot skip: `label_design → approval_packaging` is refused.
- [ ] QC without a report file is blocked ("Attach the QC report before sending for clearance."); with a file → On hold; report visible to Production, Accounts, Admin and the customer.
- [ ] Dispatch without transporter/vehicle/LR is blocked; success → customer sees transporter, vehicle, LR and downloads invoice, e-way bill and QC report.
- [ ] Timeline: 7,000-pack order cleared on 1 Oct → target dispatch **20 Dec**, latest **19 Jan**; hold days are excluded from "behind plan".

**Admin**
- [ ] Live activity shows a customer's section click within ~2 s, "online now" with name, and team actions with notes.
- [ ] Funnel counts match the test run; CSV export opens correctly in Excel (Hindi text intact).
- [ ] Settings changes (slots, offline count, bank, UPI, offer, testimonials, timeline) reflect in the customer portal without a redeploy.

---

## 15. Do not
- Do not introduce Supabase or any second backend.
- Do not trust any amount, price, slot number or stage sent by the client.
- Do not expose money fields through the Production mirror or Production UI.
- Do not create fake scarcity, fake bookings, auto-decrementing counters or invented testimonials.
- Do not break existing routes, auth sessions, analytics or deployed data; migrate additively.
- Do not hard-code bank/UPI/WhatsApp details — they come from `settings/portal`.

## 16. Open items for the owner (ask before go-live)
1. Real bank details, UPI ID and WhatsApp number (Admin → Settings).
2. GST treatment: are milestone amounts paid with GST added at payment time, or invoiced at the end? (Current copy: amounts before GST, GST on tax invoice.)
3. Exact scope wording of the ₹90,000 offer.
4. Client testimonials with written permission.
5. Confirm production capacity assumptions (235 packs/day, timeline defaults) and the 9,000-pack ₹87 tier edge (₹7.83 L).
6. Phase 2 options: WhatsApp/SMS notifications on stage changes (WhatsApp Business API or FCM), online payment gateway (Razorpay) replacing slip upload for the 10%.
