/*
  An in-memory stand-in for the parts of Firestore (firebase-admin) that the server uses:
  documents, simple queries, sub-collections and TRANSACTIONS.

  Transactions behave like Firestore's optimistic mode: every document and query a transaction reads
  is remembered, and at commit time, if any of them changed since, the transaction is thrown away and
  run again. That is what makes "two people book at once" a real test here.

  checkQueries: false  = also ignore changes to query RESULTS (new documents appearing). Then only a
                         changed document the transaction read can cause a retry. It is used to prove
                         the booking code is safe because of the shared slot_months document it reads.
*/
import { randomBytes } from "node:crypto";

const clone = (v) => structuredClone(v);
const collectionOf = (path) => path.slice(0, path.lastIndexOf("/"));
const autoId = () => randomBytes(10).toString("hex").slice(0, 20);

export function fakeFirestore(seed = {}, { checkQueries = true } = {}) {
  const docs = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  const versions = new Map();
  const stats = { transactions: 0, retries: 0, committedWrites: [] };
  const version = (path) => versions.get(path) || 0;
  const bump = (path) => versions.set(path, version(path) + 1);

  const snapshotOf = (path) => {
    const data = docs.get(path);
    const ref = docRef(path);
    return { id: path.split("/").pop(), ref, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)) };
  };

  function runQuery(collection, filters, max) {
    const out = [];
    for (const path of docs.keys()) {
      if (collectionOf(path) !== collection) continue;
      const data = docs.get(path);
      if (filters.every(([field, op, value]) => matches(data, field, op, value))) out.push(path);
    }
    out.sort();
    return max ? out.slice(0, max) : out;
  }

  function matches(data, field, op, value) {
    const actual = data[field];
    if (op === "==") return actual === value;
    if (op === "in") return value.includes(actual);
    throw new Error("fake Firestore: unsupported operator " + op);
  }

  const querySnapshot = (paths) => ({
    docs: paths.map(snapshotOf), empty: paths.length === 0, size: paths.length
  });

  function query(collection, filters = [], max = 0) {
    return {
      __query: true, collection, filters, max,
      where: (field, op, value) => query(collection, [...filters, [field, op, value]], max),
      limit: (n) => query(collection, filters, n),
      async get() { return querySnapshot(runQuery(collection, filters, max)); }
    };
  }

  function docRef(path) {
    return {
      path, id: path.split("/").pop(),
      collection: (name) => collectionRef(`${path}/${name}`),
      async get() { return snapshotOf(path); },
      async set(data, options) { applyWrite({ op: "set", path, data, options }); },
      async update(data) { applyWrite({ op: "update", path, data }); },
      async delete() { applyWrite({ op: "delete", path }); }
    };
  }

  function collectionRef(name) {
    return { ...query(name), doc: (id) => docRef(`${name}/${id || autoId()}`) };
  }

  function applyWrite(w) {
    if (w.op === "delete") {
      docs.delete(w.path);
    } else if (w.op === "set") {
      docs.set(w.path, w.options && w.options.merge && docs.has(w.path) ? { ...docs.get(w.path), ...clone(w.data) } : clone(w.data));
    } else {
      if (!docs.has(w.path)) throw Object.assign(new Error("NOT_FOUND: " + w.path), { code: 5 });
      docs.set(w.path, { ...docs.get(w.path), ...clone(w.data) });
    }
    bump(w.path);
    stats.committedWrites.push([w.op, w.path]);
  }

  async function runTransaction(fn, maxAttempts = 8) {
    stats.transactions++;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const readDocs = new Map();
      const readQueries = [];
      const writes = [];
      let wrote = false;
      const t = {
        async get(target) {
          if (wrote) throw new Error("Firestore transactions require all reads to be executed before all writes.");
          await Promise.resolve(); // reads take time; this lets parallel transactions interleave
          if (target.__query) {
            const paths = runQuery(target.collection, target.filters, target.max);
            readQueries.push({ target, signature: paths.join("|") });
            paths.forEach((p) => readDocs.set(p, version(p)));
            return querySnapshot(paths);
          }
          readDocs.set(target.path, version(target.path));
          return snapshotOf(target.path);
        },
        set(ref, data, options) { wrote = true; writes.push({ op: "set", path: ref.path, data, options }); return t; },
        update(ref, data) { wrote = true; writes.push({ op: "update", path: ref.path, data }); return t; },
        delete(ref) { wrote = true; writes.push({ op: "delete", path: ref.path }); return t; }
      };
      const result = await fn(t);
      // ---- commit: all checks and all writes happen together, nothing can slip in between ----
      let conflict = false;
      for (const [path, seen] of readDocs) if (version(path) !== seen) conflict = true;
      if (checkQueries) {
        for (const q of readQueries) {
          if (runQuery(q.target.collection, q.target.filters, q.target.max).join("|") !== q.signature) conflict = true;
        }
      }
      if (conflict) { stats.retries++; continue; }
      // Validate every update() target exists BEFORE changing anything (a transaction is all or nothing).
      for (const w of writes) if (w.op === "update" && !docs.has(w.path)) throw Object.assign(new Error("NOT_FOUND: " + w.path), { code: 5 });
      for (const w of writes) applyWrite(w);
      return result;
    }
    throw Object.assign(new Error("Too much contention on these documents. Please try again."), { code: 10 });
  }

  return {
    docs, stats,
    doc: docRef,
    collection: collectionRef,
    runTransaction,
    /* test helpers */
    read: (path) => (docs.has(path) ? clone(docs.get(path)) : undefined),
    list: (collection) => runQuery(collection, [], 0).map((p) => ({ id: p.split("/").pop(), ...clone(docs.get(p)) })),
    put: (path, data) => { docs.set(path, clone(data)); bump(path); }
  };
}

/* Netlify Blobs stand-in. */
export function fakeFiles() {
  const store = new Map();
  return {
    store,
    async put(key, bytes, meta) { store.set(key, { bytes: bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer, meta }); },
    async get(key) { return store.get(key) || null; },
    async exists(key) { return store.has(key); },
    async count(prefix) { return [...store.keys()].filter((k) => k.startsWith(prefix)).length; }
  };
}

/* The first bytes of real files, padded so they look like uploads. */
export const SAMPLE = {
  jpeg: () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7)]).buffer,
  png: () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(7)]).buffer,
  webp: () => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, ...new Array(60).fill(7)]).buffer,
  pdf: () => new TextEncoder().encode("%PDF-1.4\n" + "x".repeat(60)).buffer,
  text: () => new TextEncoder().encode("hello, this is not an image").buffer,
  html: () => new TextEncoder().encode("<html><script>alert(1)</script></html>").buffer
};
