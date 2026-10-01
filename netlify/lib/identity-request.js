/*
  Who is calling this function?
  @netlify/identity's getUser() looks at Netlify.context cookies. Functions often get the
  nf_jwt cookie on the Request instead, so we read that (and Authorization) ourselves and
  ask Netlify Identity who the token belongs to. The JWT is never trusted on its own.
*/
export function jwtFromRequest(request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(\S+)/i);
  if (bearer) return bearer[1];
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)nf_jwt=([^;]*)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

function clip(value) {
  return typeof value === "string" && value ? value : undefined;
}

/* Same shape @netlify/identity getUser() returns, so profileFrom/roleOf keep working. */
export function userFromGoTrue(data) {
  if (!data || typeof data !== "object" || !data.id) return null;
  const userMeta = data.user_metadata && typeof data.user_metadata === "object" ? data.user_metadata : {};
  const appMeta = data.app_metadata && typeof data.app_metadata === "object" ? data.app_metadata : {};
  const roles = Array.isArray(appMeta.roles) ? appMeta.roles.filter((r) => typeof r === "string") : [];
  const name = userMeta.full_name || userMeta.name;
  return {
    id: data.id,
    email: data.email || "",
    createdAt: data.created_at,
    role: clip(data.role),
    name: typeof name === "string" ? name : undefined,
    roles,
    userMetadata: userMeta,
    appMetadata: { ...appMeta, roles }
  };
}

export async function getUserFromRequest(request, { fetchImpl = fetch } = {}) {
  const jwt = jwtFromRequest(request);
  if (!jwt) return null;
  const identityUrl = new URL("/.netlify/identity", request.url).href;
  try {
    const res = await fetchImpl(identityUrl + "/user", {
      headers: { Authorization: "Bearer " + jwt }
    });
    if (!res.ok) return null;
    return userFromGoTrue(await res.json());
  } catch {
    return null;
  }
}
