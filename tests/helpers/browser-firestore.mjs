/*
  Stands in for "firebase/firestore" INSIDE the browser bundle during tests.
  It reads from the same in-memory database the server code writes to, hands back Timestamp-like values
  (like the real library), and enforces what the Firestore rules allow a CUSTOMER to read, so a
  query the rules would refuse fails here too.

  The test supplies globalThis.__FAKE__ = { db, uid, listeners }.
  Live updates: nothing is pushed by itself. The test calls __FAKE__.flush() to say "the database changed".
*/
const W = () => globalThis.__FAKE__;

const isDate = (v) => Object.prototype.toString.call(v) === "[object Date]";
function stamp(v) {
  if (isDate(v)) { const ms = v.getTime(); return { toMillis: () => ms, toDate: () => new Date(ms) }; }
  if (Array.isArray(v)) return v.map(stamp);
  if (v && typeof v === "object") { const out = {}; for (const k of Object.keys(v)) out[k] = stamp(v[k]); return out; }
  return v;
}

export const collection = (_db, ...segments) => ({ kind: "collection", path: segments.join("/") });
export const collectionGroup = (_db, id) => ({ kind: "group", id });
export const doc = (_db, ...segments) => ({ kind: "doc", path: segments.join("/") });
export const documentId = () => ({ type: "id" });
export const where = (field, op, value) => ({ type: "where", field, op, value });
export const orderBy = (field, dir = "asc") => ({ type: "order", field, dir });
export const limit = (n) => ({ type: "limit", n });
export const query = (target, ...constraints) => ({ kind: "query", target, constraints });

function denied() {
  return Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
}

/* What the Firestore rules let a customer read. */
function checkRules(target, constraints) {
  const uid = W().uid;
  const ownsFilter = constraints.some((c) => c.type === "where" && c.field === "user_id" && c.op === "==" && c.value === uid);
  if (target.kind === "group") throw denied();
  if (target.kind === "doc") {
    if (target.path === "settings/portal") return;
    if (/^slot_months\/[^/]+$/.test(target.path)) return;
    throw denied();
  }
  const path = target.path;
  if (path === "slot_months" || path === "slot_events") return;
  if (path === "bookings" || path === "payments") { if (!ownsFilter) throw denied(); return; }
  const updates = /^bookings\/([^/]+)\/updates$/.exec(path);
  if (updates) {
    const booking = W().db.read(`bookings/${updates[1]}`);
    if (!booking || booking.user_id !== uid) throw denied();
    return;
  }
  throw denied();
}

const stamp2ms = (v) => (isDate(v) ? v.getTime() : Number(v) || 0);

function evaluate(t) {
  const target = t.kind === "query" ? t.target : t;
  const constraints = t.kind === "query" ? t.constraints : [];
  checkRules(target, constraints);
  W().queried.push(target.path || target.id);
  const db = W().db;
  if (target.kind === "doc") {
    const data = db.read(target.path);
    return { single: { exists: () => data !== undefined, data: () => stamp(data), id: target.path.split("/").pop() }, key: JSON.stringify(data === undefined ? null : data) };
  }
  let rows = db.list(target.path);
  for (const c of constraints) {
    if (c.type !== "where") continue;
    if (c.field && c.field.type === "id") rows = rows.filter((r) => (c.op === "in" ? c.value.includes(r.id) : r.id === c.value));
    else rows = rows.filter((r) => (c.op === "==" ? r[c.field] === c.value : false));
  }
  for (const c of constraints.filter((x) => x.type === "order")) {
    const sign = c.dir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => sign * (stamp2ms(a[c.field]) - stamp2ms(b[c.field])));
  }
  const cap = constraints.find((x) => x.type === "limit");
  if (cap) rows = rows.slice(0, cap.n);
  return {
    key: JSON.stringify(rows),
    snap: { docs: rows.map(({ id, ...data }) => ({ id, data: () => stamp(data) })) }
  };
}

export function onSnapshot(target, next, onError) {
  const listener = { target, next, onError, key: null, live: true };
  const check = () => {
    if (!listener.live) return;
    let result;
    try {
      result = evaluate(listener.target);
    } catch (error) {
      listener.live = false;
      W().listeners.delete(listener);
      if (onError) onError(error);
      return;
    }
    if (result.key === listener.key) return;
    listener.key = result.key;
    next(result.single || result.snap);
  };
  listener.check = check;
  W().listeners.add(listener);
  queueMicrotask(check);
  return () => { listener.live = false; W().listeners.delete(listener); };
}

/* "The database changed": every live listener re-reads and reports only if its result changed. */
export function installFlush() {
  W().flush = () => { for (const l of [...W().listeners]) l.check(); };
}
installFlush();
