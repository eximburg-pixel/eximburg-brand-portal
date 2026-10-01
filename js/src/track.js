import { initializeApp } from "firebase/app";
import { addDoc, collection, doc, getFirestore, setDoc } from "firebase/firestore";
import { STEP_NO, firebaseConfig } from "./firebase-config.js";

const SID_KEY = "exb_sid";
const db = getFirestore(initializeApp(firebaseConfig));

function sid() {
  let id = sessionStorage.getItem(SID_KEY);
  if (!id) {
    id = "S" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem(SID_KEY, id);
  }
  return id;
}

function clean(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clean);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = clean(item);
  }
  return out;
}

function now() {
  return Date.now();
}

const track = {
  loginId: "",
  user: null,
  step: "home",
  enteredAt: now(),
  calcTimer: 0,
  profileTimer: 0,
  lastCalcKey: "",
  started: false
};

function base() {
  return {
    loginId: track.loginId,
    sessionId: sid(),
    ts: now(),
    step: track.step,
    stepNo: STEP_NO[track.step] || 0
  };
}

async function write(col, data) {
  if (!track.loginId) return;
  try {
    await addDoc(collection(db, col), clean({ ...base(), ...data }));
  } catch (error) {}
}

async function upsert(col, id, data) {
  if (!id) return;
  try {
    await setDoc(doc(db, col, id), clean(data), { merge: true });
  } catch (error) {}
}

function linger(leftStep) {
  const ms = Math.max(0, now() - track.enteredAt);
  if (!leftStep || ms < 400) return;
  write("events", { type: "linger", leftStep, leftStepNo: STEP_NO[leftStep] || 0, ms });
}

function profile(extra) {
  const user = track.user || {};
  upsert("users", track.loginId, {
    loginId: track.loginId,
    email: user.email || "",
    name: user.name || "",
    phone: user.phone || "",
    city: user.city || "",
    brand: user.brand || "",
    role: user.role || "user",
    updatedAt: now(),
    lastStep: track.step,
    lastStepNo: STEP_NO[track.step] || 0,
    sessionId: sid(),
    ...extra
  });
}

window.exbTrack = {
  start(profileData, step) {
    track.user = profileData || {};
    track.loginId = track.user.loginId || track.user.email || "";
    track.step = step || "home";
    track.enteredAt = now();
    if (!track.loginId) return;
    upsert("sessions", sid(), {
      loginId: track.loginId,
      sessionId: sid(),
      ts: now(),
      startedAt: now(),
      userAgent: navigator.userAgent,
      lang: document.documentElement.lang || "en",
      referrer: document.referrer || "",
      step: track.step
    });
    profile({ createdAt: now() });
    write("events", { type: "session_start" });
    track.started = true;
  },
  page(from, to) {
    linger(from);
    track.step = to;
    track.enteredAt = now();
    write("events", { type: "page_view", from, fromNo: STEP_NO[from] || 0, to, toNo: STEP_NO[to] || 0 });
    clearTimeout(track.profileTimer);
    track.profileTimer = setTimeout(() => profile(), 800);
  },
  event(type, extra) {
    write("events", { type, ...(extra || {}) });
  },
  calc(step, reason, inputs, outputs) {
    const key = JSON.stringify({ step, inputs, outputs });
    if (key === track.lastCalcKey) return;
    clearTimeout(track.calcTimer);
    track.calcTimer = setTimeout(() => {
      track.lastCalcKey = key;
      write("calculations", { type: "calculation", step, stepNo: STEP_NO[step] || 0, reason, inputs, outputs });
      profile({
        latestStep: step,
        latestReason: reason,
        latestInputs: inputs,
        latestOutputs: outputs
      });
    }, 900);
  },
  booking(record) {
    write("bookings", { type: "booking", bookingId: record.id, booking: record });
    write("events", { type: "booking_submit", bookingId: record.id });
    profile({ bookingId: record.id, bookedAt: now() });
  },
  flush() {
    linger(track.step);
    upsert("sessions", sid(), { loginId: track.loginId, sessionId: sid(), ts: now(), endedAt: now(), step: track.step });
  }
};

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.exbTrack.event("hidden");
    window.exbTrack.flush();
  } else {
    track.enteredAt = now();
    window.exbTrack.event("visible");
  }
});
window.addEventListener("pagehide", () => window.exbTrack.flush());
