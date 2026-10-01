/* Stands in for js/src/firebase-session.js inside the browser bundle during tests. */
export const auth = { get currentUser() { return globalThis.__FAKE__.uid ? { uid: globalThis.__FAKE__.uid } : null; } };
export const db = {};
export async function ensureFirebaseSession() { return { appRole: globalThis.__FAKE__.appRole }; }
export const lastSessionError = () => null;
export function currentIdToken() { return globalThis.__FAKE__.uid ? "test-id-token" : ""; }
