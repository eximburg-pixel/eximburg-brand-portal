/*
  The Netlify Identity JWT, for sending on our own API calls.
  Login writes it to the nf_jwt cookie. Password-set from an email link may only
  leave it in gotrue.user (localStorage), so we read both.
*/
export function identityJwt() {
  if (typeof document === "undefined") return "";
  const match = String(document.cookie || "").match(/(?:^|; )nf_jwt=([^;]*)/);
  if (match) {
    try { return decodeURIComponent(match[1].trim()); } catch { return match[1].trim(); }
  }
  try {
    const saved = JSON.parse(localStorage.getItem("gotrue.user") || "null");
    const token = saved && saved.token;
    return (token && (token.access_token || token.accessToken)) || saved?.access_token || "";
  } catch {
    return "";
  }
}

export function persistIdentityCookie() {
  if (typeof document === "undefined") return;
  const jwt = identityJwt();
  if (!jwt) return;
  document.cookie = "nf_jwt=" + encodeURIComponent(jwt) + "; path=/; secure; samesite=lax";
  try {
    const saved = JSON.parse(localStorage.getItem("gotrue.user") || "null");
    const refresh = saved && saved.token && saved.token.refresh_token;
    if (refresh) document.cookie = "nf_refresh=" + encodeURIComponent(refresh) + "; path=/; secure; samesite=lax";
  } catch {}
}

export function withIdentityHeaders(headers) {
  const jwt = identityJwt();
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    if (jwt && !next.has("Authorization")) next.set("Authorization", "Bearer " + jwt);
    return next;
  }
  const next = { ...(headers || {}) };
  const hasAuth = Object.keys(next).some((key) => key.toLowerCase() === "authorization");
  if (jwt && !hasAuth) next.Authorization = "Bearer " + jwt;
  return next;
}

export function authedFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    credentials: opts.credentials || "same-origin",
    headers: withIdentityHeaders(opts.headers)
  });
}
