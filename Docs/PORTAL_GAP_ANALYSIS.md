# Portal gap analysis (Phase 0)

Produced before any application code is changed. Covers spec section 0.2: stack inventory, feature map, naming conflicts, migration risks.
Read together with `Docs/INTEGRATION_PLAN.md`.

Method: the original customer dashboard (commit `84acbe9`, `index.html`) was compared with (A) the live `user.html` and (B) Claude's new `Docs/user.html`. A shows what was added for Netlify login and analytics. B shows what Claude changed. The team panel (`Docs/admin_production_account.html`) was read tab by tab.

## 1. Stack inventory

| Area | Live app today | Claude files |
|---|---|---|
| Hosting | Netlify, publish `.`, build `npm run build` (esbuild bundles `js/src/*.js` into `js/dist`) | Single static HTML files with inline scripts |
| Login | Netlify Identity via `@netlify/identity` (`home.js`, `guard.js`, `session.js`). Email + password set from an emailed link | Supabase Auth with phone+password. Demo mode with hard-coded staff passwords |
| Roles | `app_metadata.roles`: `user`, `admin`, `sales`, `production`. Default `user` set by `netlify/functions/identity.mts` | `customer`, `accounts`, `production`, `admin` in `profiles.role` |
| Database | Firestore `(default)`, `asia-south1`, project `eximburg-brand-portal`. Spark plan, billing off | Supabase Postgres + SQL functions (`supabase-setup.sql`) |
| Files | None | Supabase Storage (`payment-slips`, `dispatch-docs`) |
| Server logic | None | SQL functions (book_slot, submit_payment, review_payment, set_stage, ...) |
| Realtime | None | Supabase realtime channel plus 12 s polling |
| Analytics | `js/src/track.js`: Firestore `users`, `plans`, `calculations`, `sessions`, `events`, `bookings`. Keyed by `loginId` | Simple `events` insert (`DB.log`) |
| Firebase SDK | `firebase` ^12.19 modular, Firestore only | None |
| Existing Firestore collections | `bookings`, `calculations`, `events`, `sessions`, `users` (confirmed with the Firebase tool). `plans` is written by the script | n/a |
| Security rules | Anonymous create with the public web key if `loginId` and `ts` are present. No reads | Row-level security in SQL |

## 2. Customisations in the live `user.html` that must survive (A)

The new `Docs/user.html` has none of these. Each one is re-applied in Phase 4. "Docs line" is where the matching code sits in Claude's file today.

| # | Live customisation | Docs line | Notes |
|---|---|---|---|
| 1 | `<body data-portal="user">` and a "Opening your dashboard" placeholder in `#root` | 642 | Needed by `guard.js` |
| 2 | `render()` sends signed-out visitors to `home.html` instead of drawing a login | 1381 | Claude draws its own sign-in/sign-up card here; remove it |
| 3 | Login card, Netlify form, role dropdown, `ROLES`, `renderStaff()` removed | 1406 to 1460 | Claude's new auth card replaces the old one; both go |
| 4 | `planSnapshot(step, reason)` builds `inputs` and `outputs` for `exbTrack.calc` | after `save()` | All fields still exist in Claude's `summary()`, `slotInfo()`, `CONFIG`; verified |
| 5 | `trackMeta()` | after `render()` | Uses `S.visited`, `S.booking`, `S.lang`, `S.returning` |
| 6 | `go()` calls `exbTrack.page`, then `planSnapshot` on launchpad, profit, process, mindset, book | 1373 | Claude's `go()` already logs `section_view`; replace with the tracker call |
| 7 | Home budget chips: `quick_plan` event + snapshot | 1495, 1515 | |
| 8 | Launchpad `renderCalc()` ends with `planSnapshot("launchpad","input")` | 1765 | |
| 9 | Profit sliders (MRP, selling cost, reorders) snapshot on input | 1863 to 1865 | |
| 10 | Hero flavour pick snapshot | 1932 | |
| 11 | Mindset answers: `mind_answer` event + snapshot | 1988 | |
| 12 | Booking form errors: `booking_error` for name, phone, confirm | 2108 | |
| 13 | After booking: `exbTrack.booking(...)` and snapshot | 2115 | Must change: see section 6, risk R2 |
| 14 | Global click handler: `lang`, `nav`, `faq`, `select`, `action` events | 2385 to 2413 | |
| 15 | Logout: `exbTrack.leave("logout")` then `portalLogout()` | 2421 | Claude calls `DB.signOut()` here |
| 16 | `window.startPortal(profile)` hand-off, `exbTrack.start`, snapshot on session | end of file | Replaces Claude's `boot()` auth logic (2399) |
| 17 | `<script type="module" src="js/dist/track.js">` and `guard.js` at the end | end of file | |
| 18 | `exb_notice` banner read from `sessionStorage` | none | Dead code: nothing in the repo ever sets `exb_notice`. Drop it |

## 3. What Claude changed in the customer page (B)

New or changed sections: Dashboard offer banner, Brands we built (`brands`), Book your slot with live slot board and payment page, My orders and status (`orders`) with tracker, payments table, documents and updates, live booking toasts (`startFeed`), bilingual copy for all of it, QR code for UPI (qrcodejs from a CDN), photo compression for slips.

Views present: home, what, market, future, target, about, brands, benefits, launchpad, profit, influencer, process, mindset, book, orders. That is 15 steps.

## 4. Feature map (spec sections 5 and 6)

"UI" = present in a Claude file. "Backend" = exists in the live Firebase/Netlify app today.

### Customer portal

| Feature | UI | Backend | Status after integration needs |
|---|---|---|---|
| 5.1 15-step navigation, plan bar, language toggle | yes | n/a | Port; step ids and `STEP_NO` updated |
| 5.2 Sign-up / sign-in | yes (phone+password) | Netlify email+password exists | **Replace Claude's with the existing Netlify login.** Phone becomes a profile field |
| 5.3 Launchpad, profit, influencer, mindset | yes | analytics only | Port; analytics hooks re-attached |
| 5.4 Brands we built | yes | missing | Needs `settings/portal.testimonials` |
| 5.5 Book your slot, slot board | yes | missing | Needs `bookSlot`, `slot_months` |
| 5.6 Payment page, UPI QR, slip upload | yes | missing | Needs `submitPayment`, file storage, bank/UPI settings |
| 5.7 My orders | yes | missing | Needs bookings, payments, updates, documents |
| 5.8 Live booking toasts | yes | missing | Needs `slot_events` (real data only) |

### Team panel

| Tab | Roles | UI | Backend |
|---|---|---|---|
| Overview | Admin, Account | yes | missing (needs events, profiles, bookings, payments) |
| Live activity | Admin | yes | partial: events exist but with a different shape (section 6) |
| Leads & activity | Admin, Account | yes | partial: `users` exist per `loginId`, profiles missing |
| Slot bookings | Admin, Account | yes | missing |
| Payments | Admin, Account | yes | missing |
| Dispatch desk | Admin, Account | yes | missing |
| Production board | Production, Admin | yes | missing |
| Order timeline | Production, Admin | yes | missing |
| Settings | Admin | yes | missing (`settings/portal`) |
| Team | Admin | yes | missing (`setRole` through Netlify) |

## 5. Data-layer call map

Every call the pages make, and how it is served after integration. "Read" means Firestore directly under security rules. "Function" means a Netlify Function using the Firebase Admin SDK.

| Call | Used by | Served by |
|---|---|---|
| `init`, `me` | both | Netlify session + `firebase-token` function, then `profiles/{uid}` read |
| `signIn`, `signUp`, `signOut` | both (Claude auth) | Removed. Netlify `home.html` / `portalLogout()` |
| `getSettings` | both | Read `settings/portal`, merge defaults |
| `saveSettings` | team | Function (Admin only) |
| `slotStatus` | both | Read `slot_months/{month}` |
| `bookSlot` | customer | Function (transaction) |
| `myBookings` | customer | Read own `bookings`, `payments`, `bookings/{id}/updates` |
| `submitPayment` | customer | Function + file upload |
| `docUrl`, `slipUrl` | both | Function that checks role or ownership, then returns the file |
| `staffData` | team | Admin/Account: read `profiles`, `events`, `bookings`, `payments`, updates. Production: read `production_orders` only |
| `reviewPayment` | team | Function |
| `setShipping`, `setDispatchDocs` | team | Function (+ file upload) |
| `submitQC`, `markDispatched`, `setStage` | team | Function (+ file upload for QC) |
| `setRole` | team | Function: updates the Netlify role, mirrors to `profiles`, revokes tokens |
| `updateProfile` | customer | Not used by the pages; skip |
| `log` | customer | Replaced by `exbTrack` (one source of truth per event) |
| `subscribe` | both | Firestore `onSnapshot` listeners |
| `resetDemo` | team | Removed with demo mode |
| Shared helpers (`STAGES`, `MILESTONES`, `PROD_NEXT`, `stageIndex`, `dueMilestone`, `dueAmount`, `isActive`, `monthKey`, `addMonth`, `mergeSettings`, `priceFor`) | both | One shared module used by the browser bundle and the functions |

## 6. Naming conflicts and event mapping

### Collections

| Collection | Old analytics meaning | New meaning | Decision |
|---|---|---|---|
| `bookings` | One telemetry copy of the booking form | Real orders, written only by functions | Old docs deleted (approved). `exbTrack.booking()` stops writing here |
| `events` | `{loginId, sessionId, ts (number), type, ...fields at top level}` | Spec: `{session_id, user_id, created_at, meta}` | Keep the existing shape; the panel reads through a mapping layer (`ts` to time, `loginId` to user, `sessionId` to session, extra fields to `meta`) |
| `users/{loginId}` | Per-person analytics rollup | Spec uses `profiles/{uid}` | Keep both. `profiles` holds identity and role; `users` stays the analytics rollup. Both carry `loginId` |
| `sessions`, `calculations`, `plans` | Analytics | Not in spec | Keep unchanged |

### Event names (spec section 10 versus the tracker)

| Spec type | What the tracker writes today | Action |
|---|---|---|
| `visit` | `session_start` | Map in the reader |
| `signup` | nothing (happens on `home.html`) | New: record on first dashboard open after sign-up, or from the token function on first profile creation |
| `login` | nothing | New: written by the token function or at `session_start` with `returning` |
| `section_view` | `page_view` | Map in the reader |
| `plan_change` | `calculations` documents | Map in the reader (reads `calculations`) |
| `offer_upgrade` | `action` with `act:"offerup"` | Map in the reader, or add an explicit event |
| `slot_booked` | `booking_submit` | Map; also written by the server |
| `payment_submitted` | nothing | New: server writes it |
| `call_request` | `call_request` | Same |

### Step numbers

| Id | Old no. | New no. |
|---|---|---|
| home, what, market, future, target, about | 1 to 6 | 1 to 6 |
| brands | none | 7 |
| benefits | 7 | 8 |
| launchpad | 8 | 9 |
| profit | 9 | 10 |
| influencer | 10 | 11 |
| process | 11 | 12 |
| mindset | 12 | 13 |
| book | 13 | 14 |
| orders | none | 15 |

Your PRD's "step 8, 9, 12" are launchpad, profit and mindset. They are 9, 10 and 13 in the new numbering. Rows are stored with the id, so old rows stay correct; new rows get `stepSchema: 2`.

## 7. Migration risks and findings

| ID | Risk or finding | Impact | Handling |
|---|---|---|---|
| R1 | Analytics rules let anyone write with just the public key and a `loginId`. | Fake analytics, abuse, quota burn | Phase 2: require a signed-in Firebase user and `loginId == token.loginId`. Keepalive writes send the ID token |
| R2 | `exbTrack.booking()` writes into `bookings`. | Collides with real orders; blocked by new rules | Phase 2/4: write only the `booking_submit` event |
| R3 | The tracker's `loginId` comes from an email hash; Firebase identity will be the Netlify user id. | Two ids per person | Token carries both. `profiles/{uid}` stores `loginId`. Rules compare the claim |
| R4 | Existing sign-ups have no `profiles` document until they log in again. | Sign-up KPI and leads list would be low | Phase 2: backfill from the Netlify user list (if the admin API allows) |
| R5 | Netlify role strings are case-sensitive in `netlify.toml`. The Netlify tools available here cannot list Identity users, so the exact spelling you used (for example `Account` versus `account`) is unverified. | Wrong redirect, locked-out staff | Code matches case-insensitively. `netlify.toml` lists both spellings. **Please confirm the exact four role strings** |
| R6 | Claude's profit table shows "40%" as 40% of order value without the approval fee; the payment page and server charge 40% + approval fee. | Analytics `payment40` differs from the amount actually due | Keep the profit table as a plan; `calculations` also stores `approvalFee`. Add the fee row or a note in the table in Phase 4 so customers are not surprised |
| R7 | Pages are large single files (288 KB, 133 KB). | Easy to break by blind edits | Section-by-section changes, one commit per phase, preview deploy before merge |
| R8 | qrcodejs and Supabase load from CDNs. | Supply-chain risk; Supabase is removed anyway | Self-host or pin with an integrity hash |
| R9 | Tracker heartbeat every 20 s writes to Firestore. | Spark limit of about 20,000 writes per day | Move to 60 s in Phase 7 and watch usage |
| R10 | Files must pass through Netlify Functions (about 6 MB request limit). | A 5 MB PDF might fail | Send raw binary, compress photos, lower PDF cap if tests fail |
| R11 | Firebase Authentication is not yet enabled for the project. | Custom-token sign-in fails | You enable it in the console before Phase 2 |
| R12 | `PRD.md` was deleted from your working folder after the last commit. | None for the app | Left alone; not part of any commit. Tell me if you want it restored |

## 8. Open items for you

1. Confirm the exact four role strings in Netlify (spelling and capital letters).
2. Enable Firebase Authentication and create the service account key before Phase 2.
3. Later (go-live): bank, UPI, WhatsApp, GST wording, offer wording, testimonial consent.
