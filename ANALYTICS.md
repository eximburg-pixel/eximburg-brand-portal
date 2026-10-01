# User dashboard analytics

Project: `eximburg-brand-portal`  
Database: Cloud Firestore `(default)`, location `asia-south1`  
Script: `js/src/track.js` (bundled inside `js/dist/portal-data.js`, which `user.html` loads as a plain script, so the tracker and the live data share one Firebase connection)

The portal writes analytics only after a user is signed in. Each row carries that user's `loginId`. Client apps cannot read these collections. Open them in the Firebase console.

## What you asked to capture

From the product notes:

- User inputs on steps 8, 9, and 12.
- The calculated result of those inputs on steps 8, 9, 11, 12, and 13.
- Each calculation, not only the latest one, so later analytics can see what people tried.
- Clicks, selections, and other dashboard behaviour.
- The step on screen when the user logs out or leaves, so drop rate can be calculated by stage.

## Steps

The live numbering is **schema 2** (`stepSchema: 2` on every new row). Schema 1 was the old 13-step list (benefits was 7, launchpad 8, book 13). Rows are stored with the section **id**, so old rows stay correct; the schema field is how you tell the two numberings apart.

Your earlier notes that say “steps 8, 9 and 12” mean launchpad, profit and mindset. Those are now **9, 10 and 13**.

| Step | Id | Page | What is saved |
|---|---|---|---|
| 1 | `home` | Your dashboard | Quick plan, pack preview, journey clicks |
| 2 | `what` | Herbal Cigarettes | Hero flavour |
| 3 | `market` | Market size | Time on page |
| 4 | `future` | Future scope | Time on page |
| 5 | `target` | Target customers | Time on page |
| 6 | `about` | About Eximburg | Time on page |
| 7 | `brands` | Brands we built | Time on page |
| 8 | `benefits` | Why this business | Time on page |
| 9 | `launchpad` | Brand launchpad | Budget, batch, flavour count, flavour mix, and the calculated order |
| 10 | `profit` | Your profit plan | MRP, selling cost, reorders, and the profit result |
| 11 | `influencer` | Influencer sales plan | Time on page |
| 12 | `process` | Manufacturing process | Timeline numbers for the current plan |
| 13 | `mindset` | Business mindset | Five yes / not-yet answers, score, and the scenario numbers |
| 14 | `book` | Book your slot | Booking, call request, form errors, FAQ |
| 15 | `orders` | My orders & status | Time on page, payment slips submitted |

## Collections

Firestore creates each collection on the first write.

### `users/{loginId}`

One document per person. Overwritten as they move.

`loginId`, `email`, `name`, `phone`, `city`, `brand`, `role`, `lang`, `firstSeenAt`, `updatedAt`, `lastStep`, `lastStepNo`, `furthestStep`, `furthestStepNo`, `onScreen`, `lastExitStep`, `lastExitStepNo`, `lastExitType`, `lastLeftAt`, `booked`, `bookingId`, `bookedAt`, `callRequestedAt`, `callTime`, `latestStep`, `latestReason`, `latestInputs`, `latestOutputs`.

`onScreen: false` with `lastExitStep` is the latest place they left. After they come back, `onScreen` is true. Use `sessions` for drop rate, because this document only keeps the latest state.

### `plans/{loginId}`

The current plan. One document, replaced when a calculation settles (about 0.9 seconds after the last slider move).

`inputs` holds what they set. `outputs` holds what the portal calculated. `reason` is why it was saved: `session`, `view`, `input`, `quick_plan`, `mrp`, `selling_cost`, `reorders`, `hero`, `mind_answer`, `booking`, `call_request`.

Inputs:

- `budget`, `flavourCount`, `totalPacks`
- `flavours` (flavour id, English name, packs)
- `heroFlavour`
- `mrp`, `sellingCostPct`, `reorders`
- `mindAnswers` (five values: `1` yes, `0` not yet, `null` unanswered), `mindYes`, `mindAnswered`
- `lang`

Outputs from `summary()`:

- `pricePerPack`, `orderValue`, `approvalFee`, `investment`
- `token10`, `payment40`, `payment50`
- `retailValue`, `sticks`, `volumeSaving`, `netAfterCost`
- `profit`, `roiPct`, `reorderProfit`, `yearProfit`
- `breakEvenPacks`, `breakEvenPct`, `profitPacks`
- `mfgDays`, `daysMin`, `daysMax`, `reorderDays`
- `fdYearReturn`, `slowStartRecoveredPct`, `strongProfit`
- `slotsLeft`, `slotsBooked`

### `calculations`

One new document every time the settled plan changes. This is the history. Same `step`, `reason`, `inputs`, and `outputs` as the plan. Identical repeats are skipped.

### `sessions/{sessionId}`

One document per browser visit. A heartbeat every 60 seconds keeps `lastSeenAt` and the step on screen current, so a closed laptop still has a last step. Keepalive writes (tab hidden or closing) send the signed-in Firebase token; without it they do not write.

| Field | Meaning |
|---|---|
| `status` | `open` while the tab is visible, `hidden` when they switch away, `closed` on logout or when the page closes |
| `exitStep`, `exitStepNo` | Section on screen at that moment |
| `exitType` | `logout` or `left_screen`. Empty while `status` is `open` |
| `leftAt` | Time they left. `0` while they are on screen |
| `returnedAt` | Time they came back. `0` after a leave, until they return |
| `furthestStep`, `furthestStepNo` | Furthest section opened in this visit |
| `lifetimeFurthestStep` | Furthest section this browser has ever opened |
| `stepsVisited` | Section ids opened in this visit, in order |
| `booked` | Whether this visit already submitted a booking |
| `startedAt`, `lastSeenAt`, `lang`, `returning` | Visit timing and language |

Logout is written before the portal clears the journey. Closing the tab or hiding it uses a keepalive write so the exit still lands if the page is going away. The next visit gets a new session id.

### `events`

One document per action.

| `type` | When |
|---|---|
| `session_start` | Dashboard opens (shown in the team panel as `visit`) |
| `login` | Signed-in customer opened the dashboard |
| `signup` | First time this `loginId` was seen, with `city` and `brand` |
| `session_exit` | Logout, tab hidden, or page closed. Includes `exitType`, `exitStep`, `furthestStep`, `status`, `booked`, `stepsVisited` |
| `visible` | They came back to the tab |
| `page_view` | Section change. `from`, `to`, and step numbers (shown in the panel as `section_view`) |
| `linger` | Time spent on the section they just left, in `ms` |
| `nav` | A button that jumps to a section, with `to` |
| `quick_plan` | A home-dashboard budget chip, with `budget` |
| `select` | Launchpad preset, batch step, price rung, flavour count, mix plus/minus, preview, or hero flavour |
| `action` | Menu, pack lid, copy, balance, sign-out, call, rebook |
| `offer_upgrade` | “Switch to N packs” on the offer banner, with `packs` |
| `plan_change` | Packs or flavour count changed. `packs`, `order`, `flavours` |
| `lang` | English or Hindi |
| `mind_answer` | Question index `q` and `answer` 1 or 0 |
| `faq` | A booking question was opened |
| `booking_error` | Booking form failed on `name`, `phone`, or `confirm` |
| `booking_submit` | Slot reserved (shown in the panel as `slot_booked`), with `code`, `packs`, `order` |
| `payment_submitted` | Payment slip sent, with `milestone` and `amount` |
| `call_request` | 15-minute call asked, with preferred `time` |

Slider drags are not stored tick by tick. The settled budget, MRP, cost, and reorder values are stored as a calculation. Dragging the 3D pack and the price-lock countdown are not stored.

### `bookings`

The order system owns this collection (server writes only). The tracker records a booking as the `booking_submit` event, not as a second document here.

## Drop rate

A session dropped at `exitStep` when all of these are true:

- `booked` is false
- `leftAt` is greater than `0`
- `leftAt` is greater than `returnedAt`
- `status` is `hidden` or `closed`

`exitType` says whether that leave was `logout` or `left_screen`.

Drop rate at a step = dropped sessions whose `exitStep` is that step, divided by sessions whose `stepsVisited` contains that step.

Example: 40 sessions opened Profit plan (`profit`). 16 of those left there and did not book or come back. Drop rate at Profit plan is 16 / 40 = 40%.

`furthestStep` is how far the visit got. `exitStep` is the section actually on screen when they left. Someone can reach Booking and then go back to Market size; the exit step is Market size, and the furthest step is Booking.

The Admin Overview tab “Where people leave” is this calculation, live, for the sessions the panel has loaded.

Staff logins (Admin, Accounts, Production) do not write analytics.

## Spark quota (Phase 8)

Heartbeat is **60 seconds**. Spark allows about 20,000 writes and 50,000 reads a day. After go-live, watch the Firebase console Usage tab for a week. A few dozen customer sessions plus one staff panel (live listeners, not re-reads) should stay inside the free cap. If writes climb toward 15,000/day, enable Blaze before writes start failing. Do not shorten the heartbeat. Details: `Docs/GO_LIVE.md`.

## What the script does

`user.html` calls `window.exbTrack`:

- `start` when the dashboard opens
- `page` on every section change, including the sections already visited
- `calc` for every settled plan, which writes `calculations` and updates `plans` and `users`
- `event` for clicks, language, mindset answers, FAQ, quick plans, and booking errors
- `booking` when the slot form succeeds
- `leave("logout")` before sign-out clears the page

The script itself listens for the tab going hidden and for the page closing.

Security rules allow signed-in portal writes that include a `loginId` and a timestamp. They do not allow the browser to read or delete analytics. Indexes for login, step, exit step, and session status are in `firestore.indexes.json`.
