/*
  Data layer for the team panel (team.html) and the customer dashboard (user.html).
  Exposes window.ExbDB with the same interface the pages were designed against.
    Reads   : live Firestore listeners kept in a small cache (each document is read once, then only changes).
    Writes  : always through our server (/api/call/<action>), which re-checks who is asking.
  Firestore rules decide what each role may read. This file only asks for what the role needs.

  The analytics tracker (window.exbTrack) is part of this same bundle on purpose. One bundle means one
  Firebase connection and one sign-in per page, instead of two copies fighting over the same login.
*/
import "./track.js";
import { collection, collectionGroup, doc, documentId, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db, ensureFirebaseSession, lastSessionError } from "./firebase-session.js";
import { prepFile } from "./portal-files.js";
import {
  MILESTONES, PROD_NEXT, STAGES, addMonth, dueAmount, dueMilestone, isActive, monthKeyIST, priceForPacks, stageIndex, toMillis
} from "../../shared/portal-rules.js";
import { mergeSettings } from "../../shared/portal-settings.js";
import {
  mapBooking, mapEvent, mapPayment, mapProdOrder, mapProfile, mapUpdate, plainify, prodShape, slotStatusFrom, uidByLoginId
} from "../../shared/portal-mappers.js";
import { createApiClient, createFileUploader, createSlipUploader, fileUrl, friendlyDataError } from "../../shared/portal-client.js";
import { createMineSource, createNewEventTracker, createOverlay } from "../../shared/portal-mine.js";
import { createStore } from "../../shared/portal-store.js";
import { checkDispatch, checkDocs } from "../../shared/portal-validate.js";

/*
  Free-plan guard: this many of the newest analytics events are loaded when the panel opens.
  After that only new events are sent. Raise it only if the free Firestore quota allows.
*/
const EVENTS_LIMIT = 1000;
const LIST_LIMIT = 2000;
const UPDATES_LIMIT = 4000;

const callApi = createApiClient((...args) => fetch(...args));
const uploadSlip = createSlipUploader((...args) => fetch(...args));
const uploadFile = createFileUploader((...args) => fetch(...args));

/* A slot-board event for the customer's own booking arrives a moment before the server's answer.
   Waiting this long lets the page recognise it as theirs, so they are not told "a brand booked..." about themselves. */
const OWN_EVENT_DELAY_MS = 2500;

function uuid() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
const VID = (() => {
  try {
    let v = localStorage.getItem("exb_vid");
    if (!v) { v = uuid(); localStorage.setItem("exb_vid", v); }
    return v;
  } catch (error) {
    return uuid();
  }
})();

const byNewest = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));

/* ---------- live sources ---------- */
function dataError(error) {
  const wrapped = new Error(friendlyDataError(error));
  wrapped.code = error && error.code;
  return wrapped;
}

function listenQuery(q, mapDoc) {
  return {
    start(onData, onError) {
      return onSnapshot(q, (snap) => onData(snap.docs.map(mapDoc)), (error) => onError(dataError(error)));
    }
  };
}

function listenDoc(ref, mapSnap) {
  return {
    start(onData, onError) {
      return onSnapshot(ref, (snap) => onData(mapSnap(snap)), (error) => onError(dataError(error)));
    }
  };
}

/* A customer's own orders: bookings + payments, and the updates of each order. Firestore rules only
   allow a customer to read documents whose user_id is theirs, and each query says so explicitly. */
function mineSource(uid) {
  const fail = (err) => (error) => err(dataError(error));
  return createMineSource({
    watchBookings: (on, err) => onSnapshot(
      query(collection(db, "bookings"), where("user_id", "==", uid), limit(100)),
      (snap) => on(snap.docs.map((d) => mapBooking(d.id, d.data()))), fail(err)
    ),
    watchPayments: (on, err) => onSnapshot(
      query(collection(db, "payments"), where("user_id", "==", uid), limit(300)),
      (snap) => on(snap.docs.map((d) => mapPayment(d.id, d.data()))), fail(err)
    ),
    watchUpdates: (bookingId, on, err) => onSnapshot(
      query(collection(db, "bookings", bookingId, "updates"), limit(200)),
      (snap) => on(snap.docs.map((d) => mapUpdate(bookingId, d.id, d.data()))), fail(err)
    )
  });
}

function sourcesFor(role, uid) {
  const month = monthKeyIST(new Date());
  const sources = {
    settings: listenDoc(doc(db, "settings", "portal"), (snap) => mergeSettings(snap.exists() ? plainify(snap.data()) : {})),
    slot_months: listenQuery(
      query(collection(db, "slot_months"), where(documentId(), "in", [month, addMonth(month)])),
      (d) => ({ id: d.id, ...plainify(d.data()) })
    ),
    slot_events: listenQuery(
      query(collection(db, "slot_events"), orderBy("created_at", "desc"), limit(8)),
      (d) => ({ id: d.id, ...plainify(d.data()) })
    )
  };
  // A customer sees the public slot numbers and their own orders, nothing else.
  if (role === "user") {
    sources.mine = mineSource(uid);
    return sources;
  }
  if (role === "production") {
    sources.production_orders = listenQuery(query(collection(db, "production_orders"), limit(LIST_LIMIT)), (d) => mapProdOrder(d.id, d.data()));
    return sources;
  }
  // Admin also listens to the factory copy, so the Production board never shows money even for an Admin login.
  if (role === "admin") {
    sources.production_orders = listenQuery(query(collection(db, "production_orders"), limit(LIST_LIMIT)), (d) => mapProdOrder(d.id, d.data()));
  }
  sources.profiles = listenQuery(query(collection(db, "profiles"), orderBy("created_at", "desc"), limit(LIST_LIMIT)), (d) => mapProfile(d.id, d.data()));
  sources.events = listenQuery(query(collection(db, "events"), orderBy("ts", "desc"), limit(EVENTS_LIMIT)), (d) => ({ id: d.id, data: d.data() }));
  sources.bookings = listenQuery(query(collection(db, "bookings"), orderBy("created_at", "desc"), limit(LIST_LIMIT)), (d) => mapBooking(d.id, d.data()));
  sources.payments = listenQuery(query(collection(db, "payments"), orderBy("created_at", "desc"), limit(LIST_LIMIT)), (d) => mapPayment(d.id, d.data()));
  sources.updates = listenQuery(query(collectionGroup(db, "updates"), limit(UPDATES_LIMIT)), (d) => mapUpdate(d.ref.parent.parent.id, d.id, d.data()));
  return sources;
}

/* ---------- the data layer ---------- */
function create() {
  let store = null;
  let ready = null;
  const profile = () => window.EXB_PROFILE || null;
  const role = () => (profile() || {}).role;

  async function connect() {
    const me = profile();
    if (!me || !me.role) throw new Error("Your account details are missing. Sign out and sign in again.");
    const session = await ensureFirebaseSession();
    if (!session) {
      const problem = lastSessionError();
      const text = problem ? (problem.detail ? `${problem.message} (${problem.detail})` : problem.message) : "Could not connect. Please reload the page.";
      throw new Error(text);
    }
    // The server decided this role from Netlify. If the page and the server disagree, do not guess.
    if (session.appRole !== me.role) throw new Error("Your access changed. Sign out and sign in again.");
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) throw new Error("Could not connect. Please reload the page.");
    store = createStore(sourcesFor(me.role, uid));
    // Every time the customer's orders change, let the "just did" overlay check itself. Otherwise a stale
    // overlay could hide a later change (for example a rejected slip) until something asked for the list.
    store.subscribe((name) => { if (name === "mine") overlay.apply(store.get("mine") || []); });
    await store.whenReady();
  }

  async function live() {
    if (!ready) throw new Error("The panel is not connected yet. Reload the page.");
    await ready; // throws the same friendly error the panel already knows about
    await store.whenReady();
    return store;
  }

  // What the customer just did, shown until the live listeners report it (see shared/portal-mine.js).
  const overlay = createOverlay();
  const mineNow = () => (store ? overlay.apply(store.get("mine") || []) : []);
  const ownsSlot = (row) => [...mineNow(), ...overlay.pendingBookings()].some((b) => b.slot_month === row.slot_month && b.slot_no === row.slot_no);

  return {
    mode: "live",

    async init() {
      ready = connect();
      ready.catch(() => {}); // reported through live()
      await ready;
    },

    async me() {
      const me = profile();
      return me ? { ...me } : null;
    },

    async signOut() {
      if (store) store.stop();
      if (window.portalLogout) await window.portalLogout();
      else location.replace("home.html");
    },

    async getSettings() {
      const s = await live();
      return mergeSettings(s.get("settings"));
    },

    async slotStatus() {
      const s = await live();
      const slotMonths = {};
      for (const m of s.get("slot_months") || []) slotMonths[m.id] = m;
      return slotStatusFrom({ settings: s.get("settings"), slotMonths, recent: s.get("slot_events") || [] });
    },

    /* ----- customer dashboard (user.html) ----- */
    // Analytics are sent by window.exbTrack. This stays so older code that calls it does nothing harmful.
    log() {},

    /* This customer's orders, newest first, each with its payments and updates (oldest first). */
    async myBookings() {
      await live();
      return mineNow().map((b) => ({ ...b }));
    },

    /* The server decides the slot, the price, the fees and the hold time. We send only what the customer typed. */
    async bookSlot(x) {
      const s = await live();
      const form = x || {};
      const result = await callApi("bookSlot", {
        name: form.name, phone: form.phone, brand: form.brand, city: form.city,
        gstin: form.gstin, call_time: form.call_time, packs: form.packs, flavours: form.flavours
      });
      const booking = { ...result.booking, payments: [], updates: [] };
      overlay.addBooking(booking);
      s.patch("mine", (list) => list || []); // wake the page now; the live listener fills in the rest
      return booking;
    },

    /* Uploads the slip first (raw bytes), then records the payment with the slip's stored path. */
    async submitPayment(x) {
      if (!x || !x.file) throw new Error("Attach your payment slip (photo or PDF).");
      const s = await live();
      const file = await prepFile(x.file, "Attach your payment slip (photo or PDF).");
      const path = await uploadSlip(x.booking_id, file, x.file);
      const result = await callApi("submitPayment", {
        booking_id: x.booking_id, milestone: x.milestone, amount: Number(x.amount),
        utr: String(x.utr || ""), paid_on: String(x.paid_on || ""), slip_path: path
      });
      uploadSlip.forget(x.booking_id);
      const order = mineNow().find((b) => b.id === x.booking_id);
      if (order && result.payment_id) {
        overlay.addPayment(order.id, {
          fromStage: order.stage,
          toStage: "payment_review",
          payment: {
            id: result.payment_id, booking_id: order.id, user_id: order.user_id, milestone: x.milestone, amount: Number(x.amount),
            utr: String(x.utr || "").trim(), paid_on: String(x.paid_on || ""), slip_path: path, status: "submitted", note: "", created_at: new Date().toISOString()
          }
        });
      }
      s.patch("mine", (list) => list || []);
      return { payment_id: result.payment_id };
    },

    async staffData() {
      const s = await live();
      if (role() === "production") {
        const rows = (s.get("production_orders") || []).slice().sort(byNewest("updated_at"));
        return prodShape(rows);
      }
      const profiles = (s.get("profiles") || []).map((p) => ({ ...p }));
      const uidMap = uidByLoginId(profiles);
      const factory = role() === "admin" ? prodShape((s.get("production_orders") || []).slice().sort(byNewest("updated_at"))) : null;
      return {
        profiles,
        events: (s.get("events") || []).map((e) => mapEvent(e.id, e.data, uidMap)).sort(byNewest("created_at")),
        bookings: (s.get("bookings") || []).map((b) => ({ ...b })).sort(byNewest("created_at")),
        payments: (s.get("payments") || []).map((p) => ({ ...p })).sort(byNewest("created_at")),
        updates: (s.get("updates") || []).map((u) => ({ ...u })).sort(byNewest("created_at")),
        factory: factory ? factory.bookings : [],
        factoryUpdates: factory ? factory.updates : []
      };
    },

    /* Called whenever any live data changes. Returns a function that stops listening. */
    subscribe(callback) {
      if (!store) return () => {};
      // Customers get a toast for each NEW booking on the slot board (never for old ones, never for their own).
      const fresh = role() === "user" ? createNewEventTracker() : null;
      if (fresh) fresh(store.get("slot_events"));
      const timers = new Set();
      const stop = store.subscribe((name) => {
        if (fresh && name === "slot_events") {
          for (const row of fresh(store.get("slot_events"))) {
            const timer = setTimeout(() => {
              timers.delete(timer);
              if (!ownsSlot(row)) callback("slot_events", row);
            }, OWN_EVENT_DELAY_MS);
            timers.add(timer);
          }
        }
        callback(name, null);
      });
      return () => {
        stop();
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      };
    },

    async saveSettings(next) {
      const s = await live();
      const result = await callApi("saveSettings", { settings: next });
      s.patch("settings", () => mergeSettings(result.settings));
    },

    async setRole(uid, newRole) {
      const s = await live();
      const result = await callApi("setRole", { userId: uid, role: newRole });
      s.patch("profiles", (list) => (list || []).map((p) => (p.id === uid ? { ...p, role: result.role } : p)));
    },

    /* Admin tools used by the Settings screen */
    async checkSetup() { return callApi("checkSetup", {}); },
    async syncProfiles() { return callApi("syncProfiles", {}); },

    /* ----- Production and dispatch (files go up first, then the server action) ----- */
    async reviewPayment(id, ok, note) {
      if (!ok && !String(note || "").trim()) throw new Error("Write the reason for rejection — the customer will see it.");
      await callApi("reviewPayment", { payment_id: id, ok: !!ok, note: String(note || "") });
    },
    async setShipping(id, amount, note) {
      const value = Math.round(Number(amount) || 0);
      if (value < 0) throw new Error("Shipping charge cannot be negative.");
      await callApi("setShipping", { booking_id: id, amount: value, note: String(note || "") });
    },
    async setStage(id, stage, note) {
      await callApi("setStage", { booking_id: id, stage, note: String(note || "") });
    },
    async markDispatched(id, x) {
      checkDispatch(x);
      await callApi("markDispatched", { booking_id: id, ...x });
    },
    async setDispatchDocs(id, x) {
      checkDocs(x);
      const invoiceFile = x.invoiceFile ? await prepFile(x.invoiceFile, "Attach the tax invoice (PDF or photo).") : null;
      const ewayFile = x.ewayFile ? await prepFile(x.ewayFile, "Attach the e-way bill (PDF or photo).") : null;
      const invoice_path = x.invoice_path || await uploadFile("invoice", id, invoiceFile, x.invoiceFile);
      const eway_path = x.eway_path || await uploadFile("eway", id, ewayFile, x.ewayFile);
      await callApi("setDispatchDocs", {
        booking_id: id,
        invoice_no: x.invoice_no, invoice_date: x.invoice_date,
        eway_no: x.eway_no, eway_date: x.eway_date, eway_valid_till: x.eway_valid_till,
        invoice_path, eway_path
      });
    },
    async submitQC(id, x) {
      if (!x || !x.file) throw new Error("Attach the QC report before sending for clearance.");
      const file = await prepFile(x.file, "Attach the QC report (PDF or photo).");
      const qc_path = await uploadFile("qc", id, file, x.file);
      await callApi("submitQC", { booking_id: id, qc_path, note: String(x.note || "") });
    },
    /* The server checks who is asking each time the link is opened, so a link is useless to anyone else. */
    slipUrl: async (path) => (path ? fileUrl(path) : ""),
    docUrl: async (path) => (path ? fileUrl(path) : "")
  };
}

window.ExbDB = {
  create,
  STAGES,
  MILESTONES,
  PROD_NEXT,
  stageIndex,
  dueMilestone,
  dueAmount,
  priceFor: priceForPacks,
  isActive: (booking, now = Date.now()) => isActive(booking, toMillis(now)),
  monthKey: (date = new Date()) => monthKeyIST(date),
  addMonth,
  mergeSettings,
  VID
};
