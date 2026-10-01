# Integration plan: Claude dashboards into the live Netlify + Firebase app

Status: PLAN ONLY. No application code has been changed yet.
Source of truth for business rules: `Docs/CURSOR_IMPLEMENTATION_SPEC.md` (sections 3, 4, 6, 7, 14).
This plan overrides the spec only where the spec cannot run on this project (see "Decisions").

## 1. What exists today (inventory)

| Area | Today | Notes |
|---|---|---|
| Login | Netlify Identity (`js/src/home.js`, `session.js`, `guard.js`) | Email + password set from emailed link. Roles in `app_metadata.roles`. |
| Roles | `user`, `admin`, `sales`, `production` (lowercase) | New roles are `user`, `Admin`, `Production`, `Account`. `sales` goes away. |
| Pages | `home.html` (login), `user.html`, and stubs `admin.html`, `sales.html`, `production.html` | Stubs only say "dashboard will be added later". |
| Routing | `netlify.toml` role redirects + `dashboardFor()` in `session.js` | Case-sensitive roles. |
| Database | Firestore `(default)`, `asia-south1`. Collections: `users`, `plans`, `calculations`, `sessions`, `events`, `bookings` | Rules allow anonymous create using the public web key. Nothing readable by clients. |
| Analytics | `js/src/track.js` (REST + SDK), documented in `ANALYTICS.md` | 13 step ids. Hooks (`window.exbTrack.*`) live inside root `user.html`. |
| Firebase plan | Spark (billing not enabled), Auth not in use, no Storage, no Functions | Checked with the Firebase tools. |
| New files from Claude | `Docs/user.html`, `Docs/admin_production_account.html`, `Docs/config.js`, `Docs/supabase-setup.sql` | Both HTML files use Supabase or a localStorage demo, and have their own phone+password login. |

## 2. Decisions (confirmed or derived)

| # | Decision | Why |
|---|---|---|
| D1 | Keep Netlify Identity as the only login. Remove the phone+password screens and Supabase from both new dashboards. | You asked for routing by Netlify role. Avoids two accounts per person. |
| D2 | No billing change. Server logic runs in Netlify Functions with `firebase-admin`. Files (slips, invoice, e-way bill, QC) go to Netlify Blobs. | Confirmed by you. Firebase Cloud Functions and Storage need Blaze. |
| D3 | Netlify Function `firebase-token` turns a verified Netlify login into a Firebase custom token with the `role` claim. The browser then reads Firestore live under real security rules. | Lets the spec's rules (`request.auth.token.role`) work unchanged and keeps Production away from money by rules, not by hiding UI. |
| D4 | Roles map at one place (`js/src/session.js`). Exact Netlify names: `user`, `Admin`, `Production`, `Account`. Inside the app: `user`, `admin`, `production`, `accounts`. Matching ignores capital letters. Any other name (including the old `sales`) is treated as a plain user, which is the safest result. | Spec and Claude panel use `accounts`. Your Netlify role is `Account`. Giving the old `sales` role payment rights silently would be a privilege change. |
| D5 | One staff file `team.html` (renamed from `admin_production_account.html`). No staff home or login screen. It opens straight on the tab for the role. `admin.html`, `sales.html`, `production.html` are deleted. | As requested: keep the three together. |
| D6 | All writes to orders, payments, stages and slots go through Netlify Functions in Firestore transactions. The `production_orders` money-free mirror is written in the same transaction (no triggers needed). Hold expiry is a Netlify scheduled function. | Spark has no triggers. Same guarantees as spec section 8. |
| D7 | Old test data in `bookings` is deleted. `events`, `sessions`, `calculations`, `users`, `plans` keep their names and are extended. | You approved deleting. Reusing the analytics shape avoids a second event system. |
| D8 | Demo mode (localStorage, hard-coded staff passwords) is not shipped. Testing uses the Firebase emulator. | Demo passwords in a public file are a security hole. |

## 3. Things I found that you should know

1. **Step numbers change.** The new dashboard has 15 steps (`brands` is new at 7, `orders` is new at 15). Launchpad moves 8 -> 9, Profit 9 -> 10, Mindset 12 -> 13, Book 13 -> 14. Your PRD talks about steps 8, 9, 12. I will track by step id, bump `STEP_NO`, and add a `stepSchema` field so old and new rows can be told apart.
2. **Analytics hooks are missing from the new `user.html`.** It has its own `logEv` and none of the `window.exbTrack.*` calls (start, page, calc, event, booking, leave). They must be re-attached, otherwise the analytics you built stops.
3. **Name clash.** Old analytics `bookings`/`events` vs the new order system. Handled by D7.
4. **Netlify role names are case-sensitive in `netlify.toml`.** Redirect rules must list both `Admin` and `admin`, etc.
5. **Spark quotas.** Firestore free tier is about 20,000 writes/day. The tracker heartbeat (every 20 s) plus events can eat that with a few dozen active users. Plan: heartbeat to 60 s, monitor in Phase 8.
6. **Netlify request limit is about 6 MB.** Files are sent as raw binary (no base64), photos are compressed first. If a 5 MB PDF fails in testing, the PDF cap drops to about 4.5 MB.
7. **Firebase Authentication must be switched on once** in the console (Get started) for custom-token sign-in. No sign-in providers are needed.
8. **A role change needs a fresh sign-in token.** `setRole` also revokes the user's refresh tokens so the change applies within minutes.

## 4. Things only you can do (needed before the phase shown)

| Needed | Phase | How |
|---|---|---|
| Create at least one Netlify Identity user with role `Admin`, and test users with `Production`, `Account`, `user` | 1 | Netlify -> Identity -> user -> Edit -> Roles |
| Enable Firebase Authentication | 2 | Firebase console -> Authentication -> Get started |
| Create a service account key and add it as Netlify env var `FIREBASE_SERVICE_ACCOUNT` (secret) | 2 | Firebase console -> Project settings -> Service accounts |
| Real bank, UPI, WhatsApp, GST wording, offer wording, testimonial consent | 8 (go-live) | Team panel -> Settings |

## 5. Phases and tasks

Rule for every phase: finish the "Done when" check before starting the next one. Commit at the end of each phase so any phase can be rolled back.

### Phase 0. Safety and gap analysis (no behaviour change)
- 0.1 Commit the current uncommitted analytics work (`track.js`, rules, indexes, `user.html`, `ANALYTICS.md`) on its own commit, and create a working branch.
- 0.2 Diff root `user.html` against `Docs/user.html`; list every customisation in the live file that must survive (auth hand-off, notice banner, tracker hooks, logout).
- 0.3 Write `Docs/PORTAL_GAP_ANALYSIS.md`: stack inventory, feature map (exists/partial/missing for spec sections 5 and 6), naming map (old analytics event types -> spec section 10 types), migration risks.
- 0.4 Walk through `Docs/admin_production_account.html` tab by tab and list every call to the data layer, so Phase 3 covers all of them.
- Done when: gap analysis reviewed by you; no runtime file changed.

### Phase 1. Role routing and staff shell
- 1.1 `js/src/session.js`: new `roleOf` (case-insensitive, `Account` -> `accounts`, legacy `sales` -> `accounts`), `dashboardFor` (`user.html` or `team.html`), keep `profileFrom`.
- 1.2 `js/src/home.js`: after login, send each role to the right page; staff never see `user.html`, customers never see `team.html`.
- 1.3 `js/src/guard.js`: page guard for `user` and `team`; unknown role -> sign out with a message; recovery/invite links still forward to `home.html`.
- 1.4 `netlify/functions/identity.mts`: keep default role `user` on signup; confirm the exact role strings your Netlify site uses.
- 1.5 `netlify.toml`: DONE differently from first planned. There is no server-side role redirect for `/team.html`. If Netlify's redirect did not read the role as expected, every staff login would bounce between `home.html` and `team.html` forever, and it cannot be tested before deploy. The page holds no data, so the role check is done by `guard.js`, and real protection comes from Firestore rules and server checks (Phases 2 to 6). The three old stub rules became plain redirects to `/team.html`; `/team.html` gets `noindex` and `no-cache` headers; `/index.html` -> `user.html` stays.
- 1.6 Create `team.html` from `Docs/admin_production_account.html`; remove its sign-in, sign-up and "no access" screens; add the shared `guard.js`; remove Supabase and `config.js` script tags (data layer comes in Phase 3, so tabs show a loading state for now).
- 1.7 Delete `admin.html`, `sales.html`, `production.html`.
- Done when: each of the four test logins lands on the correct page, wrong-role URL typing bounces back, logout works from both pages.

### Phase 2. Firebase bridge and server foundation
**Status: BUILT and unit tested (87 tests). NOT deployed. Rules must go live only together with the new `track.js` (see "Deploy order" below).**

How it was built, and where it differs from the first plan:
- Shared rules live in `shared/portal-rules.js` (pricing, stages, milestones, `dueAmount`, role names) and `shared/portal-settings.js` (defaults, merge, strict validation). Browser and server import the same files. `prodShape` is built in Phase 6 with the production mirror.
- Server code is plain `.js` under `netlify/lib/` (testable without Netlify). Two thin functions wrap it: `netlify/functions/firebase-token.mts` (`POST /api/session`) and `netlify/functions/api.mts` (`POST /api/call/<action>`).
- The Firebase token carries `role` and `login_id`. The **rules do not trust the `role` claim**: they read the role from `profiles/{uid}`, which only the server writes. So when an Admin changes a role, it applies at once instead of after the old token expires.
- Actions so far (all Admin only): `saveSettings`, `setRole`, `syncProfiles` (task 2.7b), `checkSetup` (self-check, extra). Each one checks the role from Netlify live on every call, and reads nothing about the role from the request.
- 2.6: `settings/portal` is **not seeded**. Pages merge the built-in defaults when it is missing, and the first Admin save creates it. `profiles/{uid}` is created at first sign-in (and for everyone else by `syncProfiles`).
- 2.7 done: the one old test document in `bookings` was deleted; `exbTrack.booking()` no longer writes to `bookings`.
- `track.js` now waits for Firebase sign-in before any write, and the "page is closing" writes carry the sign-in token. If sign-in fails, tracking is skipped silently.
- The build now minifies (`track.js` 1.1 MB -> 565 KB).
- Not possible here: running the rules in the Firestore emulator (needs Java). Until then `tests/rules-static.test.mjs` guards the dangerous mistakes. Emulator tests are in Phase 8.

Deploy order (important):
1. Netlify: `FIREBASE_SERVICE_ACCOUNT` set, scope includes Functions. Firebase console: Authentication switched on.
2. Deploy the site (functions + new `track.js`) first.
3. Sign in as Admin and run `checkSetup`; every line must be OK.
4. Run `syncProfiles` once.
5. Only then deploy the new `firestore.rules` and indexes. Deploying rules earlier makes the old tracker's anonymous writes fail.

Original task list (kept for reference):
- 2.1 Add `firebase-admin` and a `shared/portal-rules.js` module (pricing, stages, milestones, `dueAmount`, `prodShape`, month helpers) used by both browser bundle and functions; add unit tests.
- 2.2 Function `firebase-token`: verify Netlify login, return custom token with `role` and `loginId`; uid = Netlify user id.
- 2.3 Function `api`: request guard (verify login, read role from Netlify, never from the request body), error format with the exact messages from spec section 8.
- 2.4 Rewrite `firestore.rules`: spec section 9.1 collections plus the existing analytics collections, now requiring a signed-in Firebase user and `loginId == token.loginId`; Production can read only `production_orders`; events readable by Admin and Account only.
- 2.5 Update `firestore.indexes.json` with the spec section 7.9 indexes; add `storage`-free `firebase.json` entries; local emulator config.
- 2.6 Seed `settings/portal` from `Docs/config.js` defaults; create `profiles/{uid}` on first sign-in.
- 2.7 Delete the old test documents in `bookings`; leave the other analytics collections. In the same step, change `exbTrack.booking()` in `track.js` so it no longer writes to `bookings` (it keeps the `booking_submit` event only), otherwise the new rules will reject it.
- 2.7b Backfill `profiles` for people who signed up before this release (from the Netlify user list if its admin API allows), so the sign-up KPI and Leads tab are complete.
- 2.8 `setRole` (Admin only): updates the Netlify role, mirrors to `profiles`, revokes tokens; cannot demote self. Bootstrap path for the first Admin is a Netlify role set by you.
- Done when: emulator rules tests pass (customer sees own only; Production reads nothing but `production_orders`; client cannot write `role`). **Emulator part moved to Phase 8** (needs Java); unit and static tests pass now.

### Phase 3. Data layer adapter
- 3.1 New `js/src/portal-data.js` exposing the same `ExbDB` interface the Claude pages already call (`me`, `getSettings`, `slotStatus`, `bookSlot`, `myBookings`, `submitPayment`, `staffData`, `reviewPayment`, `setShipping`, `setDispatchDocs`, `submitQC`, `markDispatched`, `setStage`, `setRole`, `log`, `subscribe`, `slipUrl`, `docUrl`). Reads and live updates use Firestore directly; writes call `api`.
- 3.2 Add it to `scripts/build-auth.mjs`; update `SECRETS_SCAN_OMIT_PATHS` for the new bundle (it contains the public web key).
- 3.3 Keep the validation helpers (`checkDocs`, `checkDispatch`, photo compression) in the adapter.
- Done when: both pages load with the adapter and read settings and an empty slot board from Firestore.

### Phase 4. Customer dashboard swap-in
- 4.1 Replace root `user.html` with the new one: remove auth card, Supabase, demo pill; add `startPortal(profile)` hand-off, `portalLogout`, and the `exb_notice` banner from the live file.
- 4.2 Re-attach every `window.exbTrack.*` hook (start, page, calc, event, booking, leave) and keep the new `logEv` events by routing them through `exbTrack` so there is one source of truth per event (spec section 10). The exact list of 18 customisations and their anchor lines is in `Docs/PORTAL_GAP_ANALYSIS.md` section 2; `exb_notice` is dead code and is dropped.
- 4.3 Booking form uses the signed-in profile (name, mobile, city, brand, email) as defaults.
- 4.4 Load QR library locally (or pinned with integrity hash) instead of a bare CDN tag.
- 4.5 Check each of the 15 sections in EN and Hindi against the Docs version (copy, numbers, offer banner, profit maths).
- Done when: sections 1-13 behave as in `Docs/user.html`; plan changes still write to `plans` and `calculations`; logout still records the exit step.

### Phase 5. Booking, payments, files
- 5.1 `api.bookSlot`: batch validation, price, order value, approval fee, offer, slot allocation in a transaction (no duplicate slot numbers under parallel calls), max 2 unpaid holds, next-month fallback, `slot_events`, first update record.
- 5.2 `slot_months` recompute (on every booking write and on the 10-minute scheduled function) and live slot board, live booking toasts (real events only).
- 5.3 `api.submitPayment` and file upload to Netlify Blobs (raw binary, size and type checks, path under the user and booking), duplicate-UTR index, expired-hold rule.
- 5.4 `api.reviewPayment` (verify / reject with reason), stage mapping, fresh hold after rejected 10%.
- 5.5 File download through a function that checks ownership or role on every request (Production cannot open slips).
- 5.6 My orders: tracker, payments table, documents, updates, due badge, live updates.
- Done when: spec section 14 Customer and Accounts payment tests pass in the emulator (slot 5 of 7, 10% = Rs 1,02,000 for 12,000 packs, 40% example = Rs 2,88,000, duplicate/short UTR messages).

### Phase 6. Production and dispatch
- 6.1 `production_orders` mirror inside every booking transaction (money-free fields only; created at `confirmed`, removed otherwise).
- 6.2 `api.setStage` (Production one step forward; Admin override with note), `submitQC` (report file required), `markDispatched` (transporter, vehicle, LR required).
- 6.3 `api.setShipping`, `api.setDispatchDocs` (12-digit e-way bill, both files).
- 6.4 Production board and Order timeline read only `production_orders`; Admin on those tabs uses the same source.
- 6.5 Scan every Production screen for rupee signs, percentages, UTRs and slips (both Production and Admin logins).
- Done when: spec section 14 Production and Dispatch tests pass, including "Production cannot read bookings, payments, events, profiles".

### Phase 7. Analytics and insights
- 7.1 `STEP_NO` to 15 steps; add `brands` and `orders`; add `stepSchema`; update `ANALYTICS.md`, including the step table and the PRD numbering note.
- 7.2 Track new customer events: sign-up, login, offer upgrade, slot booked, payment submitted, orders-page views; skip tracking for staff.
- 7.3 Heartbeat to 60 s; use the signed-in token for the keepalive writes.
- 7.4 Overview (KPIs, funnel, sign-ups chart), Leads and CSV, Live activity read the extended `events`, `sessions`, `users` through an adapter that maps field names (`ts`, `loginId`, `sessionId`).
- 7.5 Add the drop-rate view (exit step vs visited step) to the Admin Overview so the analytics you designed is visible in the panel.
- Done when: a test customer's section clicks appear in Live activity within a few seconds and funnel counts match the test run.

### Phase 8. Hardening, acceptance, go-live
- 8.1 Emulator rules tests (all roles x all collections) and unit tests for pricing, stages, timeline.
- 8.2 Run the full spec section 14 checklist; record results in the gap analysis.
- 8.3 `noindex` on `team.html`, security headers in `netlify.toml`, confirm no service-account key or secrets in the repo or bundles.
- 8.4 Monitor Firestore usage for a week against Spark quotas; decide on Blaze only if needed.
- 8.5 Deploy rules and indexes with the Firebase CLI, deploy site, smoke test all four roles on production.
- 8.6 Go-live checklist with you: real bank/UPI/WhatsApp, GST wording, offer wording, testimonial consent.
- Done when: every acceptance test passes and you sign off.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Netlify role strings differ from what I assume | Confirm in task 1.4 by reading a real login before writing routing. |
| Netlify Identity admin API unavailable for `setRole` from a function | Verify in 2.8 first; fallback is Admin changes roles in the Netlify UI and the panel shows them read-only. |
| Live site breaks while swapping `user.html` | Work on a branch, Netlify deploy preview, swap only after Phase 3 passes. |
| Spark write quota | Item 5 in section 3, monitor in 8.4. |
| 288 KB single-file pages are hard to diff | Phase 0.2 and 4.1 use a section-by-section comparison, not a blind overwrite. |
