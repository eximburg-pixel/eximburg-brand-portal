import { initializeApp } from "firebase/app";
import { addDoc, collection, doc, getFirestore, setDoc } from "firebase/firestore";
import { STEP_NO, firebaseConfig } from "./firebase-config.js";

const SID_KEY = "exb_sid";
const STEPS_KEY = "exb_steps";
const db = getFirestore(initializeApp(firebaseConfig));
const REST = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

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

function fsValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fsValue) } };
  const fields = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) fields[key] = fsValue(item);
  }
  return { mapValue: { fields } };
}

function restPatch(path, data) {
  const fields = {};
  const cleaned = clean(data);
  for (const [key, item] of Object.entries(cleaned)) fields[key] = fsValue(item);
  const mask = Object.keys(fields).map((key) => "updateMask.fieldPaths=" + encodeURIComponent(key)).join("&");
  fetch(`${REST}/${path}?key=${firebaseConfig.apiKey}&${mask}`, {
    method: "PATCH",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  }).catch(() => {});
}

function restCreate(collectionName, data) {
  const fields = {};
  const cleaned = clean(data);
  for (const [key, item] of Object.entries(cleaned)) fields[key] = fsValue(item);
  fetch(`${REST}/${collectionName}?key=${firebaseConfig.apiKey}`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  }).catch(() => {});
}

const track = {
  loginId: "",
  user: null,
  step: "home",
  enteredAt: now(),
  startedAt: 0,
  calcTimer: 0,
  profileTimer: 0,
  heartTimer: 0,
  lastCalcKey: "",
  sessionSteps: [],
  furthestStep: "home",
  furthestNo: 1,
  lifetimeFurthest: "home",
  lifetimeFurthestNo: 1,
  booked: false,
  lang: "en",
  returning: false,
  exitReason: "",
  lastLeaveAt: 0
};

function loadSteps() {
  try { return JSON.parse(sessionStorage.getItem(STEPS_KEY)) || []; } catch (error) { return []; }
}

function saveSteps() {
  try { sessionStorage.setItem(STEPS_KEY, JSON.stringify(track.sessionSteps)); } catch (error) {}
}

function touchStep(id) {
  if (!id) return;
  if (!track.sessionSteps.includes(id)) track.sessionSteps.push(id);
  const stepNo = STEP_NO[id] || 0;
  if (stepNo >= track.furthestNo) {
    track.furthestNo = stepNo;
    track.furthestStep = id;
  }
  saveSteps();
}

function noteMeta(extra) {
  if (!extra) return;
  if (Array.isArray(extra.visited)) {
    let max = 0;
    let id = track.lifetimeFurthest;
    for (const step of extra.visited) {
      const stepNo = STEP_NO[step] || 0;
      if (stepNo >= max) { max = stepNo; id = step; }
    }
    track.lifetimeFurthest = id || "home";
    track.lifetimeFurthestNo = max || 1;
  }
  if (extra.booked != null) track.booked = !!extra.booked;
  if (extra.lang) track.lang = extra.lang;
  if (extra.returning != null) track.returning = !!extra.returning;
}

function base() {
  return {
    loginId: track.loginId,
    sessionId: sid(),
    ts: now(),
    step: track.step,
    stepNo: STEP_NO[track.step] || 0,
    exitStep: track.step,
    exitStepNo: STEP_NO[track.step] || 0,
    furthestStep: track.furthestStep,
    furthestStepNo: track.furthestNo
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

function sessionBody(status) {
  const at = now();
  return {
    loginId: track.loginId,
    sessionId: sid(),
    ts: at,
    startedAt: track.startedAt || at,
    lastSeenAt: at,
    leftAt: status === "open" ? 0 : at,
    returnedAt: status === "open" ? at : 0,
    status,
    exitType: status === "open" ? "" : (track.exitReason || "left_screen"),
    step: track.step,
    stepNo: STEP_NO[track.step] || 0,
    exitStep: track.step,
    exitStepNo: STEP_NO[track.step] || 0,
    furthestStep: track.furthestStep || track.step,
    furthestStepNo: track.furthestNo || STEP_NO[track.step] || 0,
    lifetimeFurthestStep: track.lifetimeFurthest,
    lifetimeFurthestNo: track.lifetimeFurthestNo,
    stepsVisited: track.sessionSteps.slice(),
    booked: track.booked,
    lang: track.lang || "en",
    returning: track.returning
  };
}

function linger(leftStep) {
  const ms = Math.max(0, now() - track.enteredAt);
  if (!leftStep || ms < 400) return;
  write("events", { type: "linger", leftStep, leftStepNo: STEP_NO[leftStep] || 0, ms });
}

function profile(extra) {
  const user = track.user || {};
  const seenKey = "exb_seen_" + track.loginId;
  const first = {};
  try {
    if (track.loginId && !localStorage.getItem(seenKey)) {
      localStorage.setItem(seenKey, "1");
      first.firstSeenAt = now();
    }
  } catch (error) {}
  upsert("users", track.loginId, {
    loginId: track.loginId,
    email: user.email || "",
    name: user.name || "",
    phone: user.phone || "",
    city: user.city || "",
    brand: user.brand || "",
    role: user.role || "user",
    lang: track.lang || "en",
    updatedAt: now(),
    lastStep: track.step,
    lastStepNo: STEP_NO[track.step] || 0,
    furthestStep: track.lifetimeFurthest,
    furthestStepNo: track.lifetimeFurthestNo,
    sessionId: sid(),
    booked: track.booked,
    ...first,
    ...extra
  });
}

function saveSession(status) {
  const body = sessionBody(status);
  upsert("sessions", sid(), body);
  if (status !== "open") restPatch("sessions/" + encodeURIComponent(sid()), body);
  return body;
}

function beat() {
  if (!track.loginId || document.hidden || track.exitReason === "logout") return;
  saveSession("open");
}

window.exbTrack = {
  start(profileData, step, extra) {
    track.user = profileData || {};
    track.loginId = track.user.loginId || track.user.email || "";
    track.step = step || "home";
    track.enteredAt = now();
    track.startedAt = now();
    track.exitReason = "";
    track.sessionSteps = loadSteps();
    noteMeta(extra);
    touchStep(track.step);
    if (!track.loginId) return;
    upsert("sessions", sid(), {
      ...sessionBody("open"),
      userAgent: navigator.userAgent,
      referrer: document.referrer || ""
    });
    profile();
    write("events", { type: "session_start", returning: track.returning });
    clearInterval(track.heartTimer);
    track.heartTimer = setInterval(beat, 20000);
  },
  page(from, to, extra) {
    noteMeta(extra);
    linger(from);
    track.step = to;
    track.enteredAt = now();
    touchStep(to);
    write("events", { type: "page_view", from, fromNo: STEP_NO[from] || 0, to, toNo: STEP_NO[to] || 0 });
    saveSession("open");
    clearTimeout(track.profileTimer);
    track.profileTimer = setTimeout(() => profile(), 800);
  },
  event(type, extra) {
    write("events", { type, ...(extra || {}) });
    if (type === "call_request") profile({ callRequestedAt: now(), callTime: (extra && extra.time) || "" });
  },
  calc(step, reason, inputs, outputs) {
    const key = JSON.stringify({ step, inputs, outputs });
    if (key === track.lastCalcKey) return;
    clearTimeout(track.calcTimer);
    track.calcTimer = setTimeout(() => {
      if (!track.loginId) return;
      track.lastCalcKey = key;
      write("calculations", { type: "calculation", step, stepNo: STEP_NO[step] || 0, reason, inputs, outputs });
      const user = track.user || {};
      upsert("plans", track.loginId, {
        loginId: track.loginId,
        updatedAt: now(),
        step,
        stepNo: STEP_NO[step] || 0,
        reason,
        inputs,
        outputs,
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        city: user.city || "",
        brand: user.brand || "",
        lang: track.lang || "en",
        booked: track.booked,
        furthestStep: track.lifetimeFurthest,
        furthestStepNo: track.lifetimeFurthestNo
      });
      profile({
        latestStep: step,
        latestReason: reason,
        latestInputs: inputs,
        latestOutputs: outputs
      });
    }, 900);
  },
  booking(record) {
    track.booked = true;
    write("bookings", { type: "booking", bookingId: record.id, booking: record });
    write("events", { type: "booking_submit", bookingId: record.id });
    profile({ bookingId: record.id, bookedAt: now(), booked: true });
    saveSession("open");
  },
  leave(reason, extra) {
    if (!track.loginId || track.exitReason === "logout") return;
    noteMeta(extra);
    const at = now();
    const exitType = reason === "logout" ? "logout" : "left_screen";
    const repeat = track.lastLeaveAt && at - track.lastLeaveAt < 800 && track.exitReason === exitType;
    track.exitReason = exitType;
    track.lastLeaveAt = at;
    const status = reason === "hidden" ? "hidden" : "closed";
    const body = saveSession(status);
    if (!repeat) {
      linger(track.step);
      const event = {
        ...base(),
        type: "session_exit",
        exitType,
        status,
        leftAt: at,
        booked: track.booked,
        stepsVisited: track.sessionSteps.slice()
      };
      if (reason === "pagehide" || reason === "logout") restCreate("events", event);
      else write("events", event);
    }
    profile({
      lastExitStep: track.step,
      lastExitStepNo: STEP_NO[track.step] || 0,
      lastExitType: exitType,
      lastLeftAt: at,
      onScreen: false,
      booked: track.booked
    });
    if (reason === "logout") {
      clearInterval(track.heartTimer);
      restPatch("sessions/" + encodeURIComponent(body.sessionId), body);
      try {
        sessionStorage.removeItem(SID_KEY);
        sessionStorage.removeItem(STEPS_KEY);
      } catch (error) {}
    }
  }
};

document.addEventListener("visibilitychange", () => {
  if (!window.exbTrack || !track.loginId) return;
  if (document.hidden) window.exbTrack.leave("hidden");
  else if (track.exitReason !== "logout") {
    track.exitReason = "";
    track.enteredAt = now();
    saveSession("open");
    profile({ onScreen: true, lastExitType: "" });
    window.exbTrack.event("visible");
  }
});

window.addEventListener("pagehide", () => {
  if (window.exbTrack) window.exbTrack.leave("pagehide");
});
