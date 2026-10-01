# Go-live checklist (Phase 8)

Nothing here has been deployed. Work stays on `integrate-team-dashboards` until you say to push.

This file is the runbook for 8.4–8.6. Automated checks for 8.1–8.3 live in `tests/` (rules matrix, spec §14 numbers, headers, secrets). Recorded results are in `Docs/PORTAL_GAP_ANALYSIS.md` section 9.

## 8.1 Rules in the Firestore emulator (needs Java)

This machine did not have Java when the rest of Phase 8 was built, so the role × collection table is proven in `tests/rules-matrix.test.mjs` (rules text + the same read checks the browser helper enforces). When Java is installed:

1. Install the Firebase CLI if needed: `npm i -D firebase-tools @firebase/rules-unit-testing`
2. Start the emulator: `npx firebase emulators:start --only firestore`
3. Re-run `npm test`. The matrix is the expected table; if you add emulator tests, they must match it.

`firebase.json` already names Firestore emulator port **8080**.

## 8.4 Spark quota (watch for a week after go-live)

Firebase Spark (free) is about **20,000 writes/day** and **50,000 reads/day** on Firestore.

| What | Writes | Reads |
|---|---|---|
| Customer heartbeat | 1 session update / 60 s / open tab | — |
| Section clicks, plans, booking events | a few per visit | — |
| Staff panel open | — | newest 1,000 events, 2,000 profiles/bookings/payments, 4,000 updates, then only changes |
| Slot sweep (every 10 min) | 0 unless a hold ran out | two months of bookings |

A handful of customers browsing will stay inside the free cap. A staff panel left open all day is cheap because of the live listeners. Do **not** drop the heartbeat below 60 s. If the Firebase console Usage tab shows writes climbing toward 15,000/day, turn billing on (Blaze) before it starts failing. Blaze still has a generous free allowance; you only pay for the extra.

## 8.5 Deploy order (do not skip)

Same order as Phase 2. Deploying rules first will break the **old** tracker on the live site.

1. Netlify env: `FIREBASE_SERVICE_ACCOUNT` set (Functions scope). Firebase console: Authentication → Get started (no extra providers).
2. Deploy the **site** (functions + new `track.js` inside `portal-data.js`) first.
3. Sign in as Admin → Settings → **Check connection**. Every line must be OK.
4. Run **Sync people** once.
5. Only then: `npx firebase deploy --only firestore:rules,firestore:indexes`
6. Smoke test the four roles on the live URL (see below).

## 8.6 You set these in Admin → Settings (saved to Firestore)

Nothing here is hardcoded in the customer page. Admin opens **Settings**, fills the cards, clicks **Save settings**. The document is `settings/portal`. Customers with the portal open see the new values within a few seconds (or on the next section they open).

| Item | Settings card | Where customers see it |
|---|---|---|
| WhatsApp (`91XXXXXXXXXX`) and email | Contact | Book your slot — call request and booking confirmation. Empty WhatsApp hides the button. |
| Bank name, account, IFSC, branch, UPI ID | Payment details | Payment step (NEFT + UPI QR). Empty bank/UPI is hidden, not invented. |
| GST note (EN + HI) | Payment details | Under the amount on every payment. |
| Offer title/detail, worth, threshold, on/off | Special offer | Dashboard, Launchpad, Profit plan banners. |
| Client brands and quotes | Brands we built | Brands we built (and the strip on booking). A row is shown only when **Written permission is on file** is ticked. |

Open items from the spec (GST treatment, offer scope, 9,000-pack ₹87 tier) stay yours. The 9,000-pack price is already ₹87 (₹7.83 L) in code.

## Smoke test (all four roles)

Use four test logins. Do not use real customer money.

**Customer (`user`)**
- Lands on `user.html`, never on `team.html`.
- Plan 7,000 packs: offer banner says the plan is ₹3,90,000 short and offers Switch to 12,000 packs.
- Book with 4 offline slots already taken → slot 5 of 7; 12,000 packs → pay ₹1,02,000; QR amount matches; over ₹1 L shows the bank-transfer note.
- Slip without file / short UTR / duplicate UTR shows the exact messages.
- Logout records the exit and returns to `home.html`.

**Accounts (`Account`)**
- Lands on `team.html` (Payments, Dispatch, Bookings, Leads, Overview).
- Mismatched amount is marked; reject without a reason is blocked.
- Verify 10% → customer sees Slot confirmed; order appears on Production board.
- 40% of 7,000 packs / 6 flavours = ₹2,88,000; 50% = ₹3,15,000.
- Shipping ₹12,500 vs ₹0; 12-digit e-way bill required.

**Production (`Production`)**
- Lands on Production board + Order timeline only.
- Zero orders before the 10% is verified.
- No ₹, %, UTR or slip on either tab.
- Cannot open a payment slip; cannot skip `label_design` → `approval_packaging`.
- QC needs a report file; dispatch needs transporter, vehicle, LR.
- 7,000 packs cleared 1 Oct → target 20 Dec, latest 19 Jan.

**Admin (`Admin`)**
- All tabs. Live activity shows a customer section click within a few seconds.
- Funnel counts match the test run. CSV opens in Excel with Hindi intact (BOM).
- Settings change (slots, bank, UPI, offer) appears on the customer page without a redeploy.
- Cannot remove own Admin role.

## Rollback

Each phase is its own commit on `integrate-team-dashboards`. To undo Phase 8 only: `git revert` that commit. To undo the whole integration: restore the branch from before Phase 1 (`019d207` is Phase 0). Never deploy rules without the matching site.
