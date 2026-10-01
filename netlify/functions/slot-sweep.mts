import type { Config } from "@netlify/functions";
import { getFirebase } from "../lib/firebase-admin.js";
import { recomputeSlotMonths } from "../lib/orders.js";

// Every 10 minutes: rebuild the public slot board for this month and next, so a hold that ran out
// frees its slot even if nobody books or pays in the meantime. Writes only when something changed.
export default async () => {
  try {
    const { db } = getFirebase(Netlify.env.get("FIREBASE_SERVICE_ACCOUNT"));
    const changed = await recomputeSlotMonths(db, Date.now());
    console.log("slot sweep done; changed months:", changed.join(", ") || "none");
  } catch (error) {
    console.error("slot sweep failed:", error && (error as Error).message);
  }
};

export const config: Config = { schedule: "*/10 * * * *" };
