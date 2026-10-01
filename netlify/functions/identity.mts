import type { UserSignupEvent } from "@netlify/functions";

export default {
  userSignup(event: UserSignupEvent) {
    const existing = event.user.appMetadata?.roles;
    if (Array.isArray(existing) && existing.length > 0) return;
    return {
      user: {
        ...event.user,
        appMetadata: {
          ...event.user.appMetadata,
          roles: ["user"]
        }
      }
    };
  }
};
