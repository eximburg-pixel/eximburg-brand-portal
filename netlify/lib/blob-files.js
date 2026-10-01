/*
  The only place that talks to Netlify Blobs (our file storage).
  Everything else receives this as `files`, so the tests can use a plain in-memory stand-in.
  "strong" consistency means a file is readable the moment it is written, which a payment
  slip needs: the customer uploads it, then submits the payment a second later.
*/
import { getStore } from "@netlify/blobs";

export function blobFiles() {
  const store = getStore({ name: "portal-files", consistency: "strong" });
  return {
    async put(key, bytes, meta) {
      await store.set(key, bytes, { metadata: meta });
    },
    async get(key) {
      const found = await store.getWithMetadata(key, { type: "arrayBuffer" });
      return found ? { bytes: found.data, meta: found.metadata || {} } : null;
    },
    async exists(key) {
      return (await store.getMetadata(key)) !== null;
    },
    async count(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.length;
    }
  };
}
