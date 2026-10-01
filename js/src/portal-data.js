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
import { db, ensureFirebaseSession, lastSessionError } from "./firebase-session.js";
import { prepFile } from "./portal-files.js";
import {
  MILESTONES, PROD_NEXT, STAGES, addMonth, dueAmount, dueMilestone, isActive, monthKeyIST, priceForPacks, stageIndex, toMillis
} from "../../shared/portal-rules.js";
import { mergeSettings } from "../../shared/portal-settings.js";
import {
  mapBooking, mapEvent, mapPayment, mapProdOrder, mapProfile, mapUpdate, plainify, prodShape, slotStatusFrom, uidByLoginId
} from "../../shared/portal-mappers.js";
import { LATER_STEP_MESSAGE, createApiClient, friendlyDataError } from "../../shared/portal-client.js";
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

function sourcesFor(role) {
  const month = monthKeyIST(new Date());
  const sources = {
    settings: listenDoc(doc(db, "settings", "portal"), (snap) => mergeSettings(snap.exists() ? plainify(snap.data()) : {})),
    slot_months: listenQuery(
      query(collection(db, "slot_months"), where(documentId(), "in", [month, addMonth(month)])),
      (d) => ({ id: d.id, ...plainify(d.data()) })
    ),
    slot_events: listenQuery(
      query(collection(db, "slot_events"), orderBy("created_at", "desc"), limit(8)),
      (d) => plainify(d.data())
    )
  };
  // A customer only needs the public slot numbers here. Their own orders are added with the booking step.
  if (role === "user") return sources;
  if (role === "production") {
    sources.production_orders = listenQuery(query(collection(db, "production_orders"), limit(LIST_LIMIT)), (d) => mapProdOrder(d.id, d.data()));
    return sources;
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
    store = createStore(sourcesFor(me.role));
    await store.whenReady();
  }

  async function live() {
    if (!ready) throw new Error("The panel is not connected yet. Reload the page.");
    await ready; // throws the same friendly error the panel already knows about
    await store.whenReady();
    return store;
  }

  const later = async () => { throw new Error(LATER_STEP_MESSAGE); };

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

    // Orders arrive with the booking step. Until then an empty list is the truth: nothing can be booked yet.
    async myBookings() { return []; },

    async bookSlot() { await later(); },

    async submitPayment(x) {
      if (!x || !x.file) throw new Error("Attach your payment slip (photo or PDF).");
      await prepFile(x.file, "Attach your payment slip (photo or PDF).");
      await later();
    },

    async staffData() {
      const s = await live();
      if (role() === "production") {
        const rows = (s.get("production_orders") || []).slice().sort(byNewest("updated_at"));
        return prodShape(rows);
      }
      const profiles = (s.get("profiles") || []).map((p) => ({ ...p }));
      const uidMap = uidByLoginId(profiles);
      return {
        profiles,
        events: (s.get("events") || []).map((e) => mapEvent(e.id, e.data, uidMap)).sort(byNewest("created_at")),
        bookings: (s.get("bookings") || []).map((b) => ({ ...b })).sort(byNewest("created_at")),
        payments: (s.get("payments") || []).map((p) => ({ ...p })).sort(byNewest("created_at")),
        updates: (s.get("updates") || []).map((u) => ({ ...u })).sort(byNewest("created_at"))
      };
    },

    /* Called whenever any live data changes. Returns a function that stops listening. */
    subscribe(callback) {
      if (!store) return () => {};
      return store.subscribe((name) => callback(name, null));
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

    /* ----- connected in later phases: the checks below run now, the server action arrives later ----- */
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
      if (x.invoiceFile) await prepFile(x.invoiceFile, "Attach the tax invoice (PDF or photo).");
      if (x.ewayFile) await prepFile(x.ewayFile, "Attach the e-way bill (PDF or photo).");
      await later(); // file upload arrives with the order system
    },
    async submitQC(id, x) {
      if (!x || !x.file) throw new Error("Attach the QC report (PDF or photo).");
      await prepFile(x.file, "Attach the QC report (PDF or photo).");
      await later();
    },
    slipUrl: later,
    docUrl: later
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
