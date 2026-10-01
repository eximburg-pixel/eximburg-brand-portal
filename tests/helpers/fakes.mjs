/* In-memory stand-ins for Firestore, Firebase Auth and Netlify Identity, used by the server tests. */

export const SERVER_TIME = { __serverTime: true };

export function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  const writes = [];
  const ref = (path) => ({
    path,
    id: path.split("/").pop(),
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, id: path.split("/").pop(), data: () => (data === undefined ? undefined : structuredClone(data)) };
    },
    async set(data) { writes.push(["set", path]); store.set(path, structuredClone(data)); },
    async update(data) {
      writes.push(["update", path]);
      if (!store.has(path)) throw new Error("NOT_FOUND");
      store.set(path, { ...store.get(path), ...structuredClone(data) });
    }
  });
  return { store, writes, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), doc: (path) => ref(path) };
}

export function fakeAuth({ revokeError, getUserError = Object.assign(new Error("no such user"), { code: "auth/user-not-found" }) } = {}) {
  const calls = { tokens: [], revoked: [] };
  return {
    calls,
    async getUser() { throw getUserError; },
    async createCustomToken(uid, claims) { calls.tokens.push({ uid, claims }); return `token-for-${uid}`; },
    async revokeRefreshTokens(uid) {
      calls.revoked.push(uid);
      if (revokeError) throw revokeError;
    }
  };
}

/* A Netlify-like user as @netlify/identity returns it. */
export function netlifyUser(id, roles = ["user"], extra = {}) {
  return {
    id,
    email: `${id}@phone.eximburg.in`,
    createdAt: "2026-09-01T10:00:00Z",
    roles,
    role: extra.role,
    appMetadata: { provider: "email", roles, ...(extra.appMetadata || {}) },
    userMetadata: { full_name: "Person " + id, phone: "9876543210", city: "Surat", brand: "Brand " + id, login_id: "EXB-" + id, ...(extra.userMetadata || {}) }
  };
}

export function fakeIdentity(users, { ignoreRoleUpdate = false } = {}) {
  const map = new Map(users.map((u) => [u.id, structuredClone(u)]));
  const calls = { updates: [] };
  return {
    calls,
    map,
    async getUser(id) {
      if (!map.has(id)) throw new Error("not found");
      return structuredClone(map.get(id));
    },
    async updateUser(id, attrs) {
      calls.updates.push({ id, attrs: structuredClone(attrs) });
      const u = map.get(id);
      if (!u) throw new Error("not found");
      if (!ignoreRoleUpdate) {
        if (attrs.app_metadata) {
          u.appMetadata = { ...u.appMetadata, ...attrs.app_metadata };
          u.roles = u.appMetadata.roles;
        }
        if (attrs.role !== undefined) u.role = attrs.role || undefined;
      }
      return structuredClone(u);
    },
    async listUsers({ page = 1, perPage = 50 } = {}) {
      const all = [...map.values()];
      return structuredClone(all.slice((page - 1) * perPage, page * perPage));
    }
  };
}

export const SITE = "https://eximburg.test";

export function makeRequest(path, { method = "POST", body, type = "application/json", origin = SITE } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (type) headers["content-type"] = type;
  return new Request(SITE + path, { method, headers, body: method === "GET" ? undefined : body === undefined ? "{}" : typeof body === "string" ? body : JSON.stringify(body) });
}

/* Same behaviour as @netlify/identity's verifyRequestOrigin: same origin only. */
export function verifyOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new Error("bad origin");
}

export const silent = () => {};
