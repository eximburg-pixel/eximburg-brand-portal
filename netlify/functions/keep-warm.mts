import type { Config } from "@netlify/functions";
import { getFirebase } from "../lib/firebase-admin.js";
import { keepWarm, siteBase } from "../lib/warm.js";

// Every 4 minutes. A hot server wakes the visitor functions before they shut down.
// A cold server leaves them asleep. Admin chooses which, from the Settings tab.
export default async () => {
  try {
    const { db } = getFirebase();
    const result = await keepWarm({ db, fetchImpl: fetch, siteUrl: siteBase() });
    console.log("keep warm:", result.mode, result.ready ? "ready" : "waiting", result.pinged);
  } catch (error) {
    console.error("keep warm failed:", error && (error as Error).message);
  }
};

export const config: Config = { schedule: "*/4 * * * *" };
