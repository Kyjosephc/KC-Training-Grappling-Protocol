// Shared helpers for the Oura Ring integration.
//
// Files in /api that start with an underscore are NOT deployed as routes by
// Vercel, so this one is only ever imported by the real endpoints beside it.
//
// Why there is a backend at all for this: Oura's OAuth token exchange requires
// a client secret, which can never ship in browser code, and Oura's API does
// not allow direct browser (cross-origin) calls. Both problems go away by
// doing the exchange and the data fetch server-side. The browser never talks
// to Oura directly -- it only talks to these endpoints, on the same origin.

export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

// "daily" covers sleep, readiness and activity summaries plus the detailed
// sleep records that carry HRV. "personal" is only used to show whose ring is
// connected. Nothing here can write to the athlete's Oura account.
export const OURA_SCOPES = "daily personal";

export function appOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

// The exact address Oura redirects back to after an athlete approves access.
// This string has to match what is registered on the Oura developer app, so
// the app surfaces it verbatim in Settings rather than making anyone guess it.
export function ouraRedirectUri(req) {
  return `${appOrigin(req)}/api/oura/callback`;
}

export function ouraCredentials() {
  return {
    clientId: process.env.OURA_CLIENT_ID || "",
    clientSecret: process.env.OURA_CLIENT_SECRET || "",
  };
}

export function isOuraConfigured() {
  const { clientId, clientSecret } = ouraCredentials();
  return Boolean(clientId && clientSecret);
}

export function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return;
      const key = part.slice(0, idx).trim();
      if (!key) return;
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    });
  return out;
}

// Scoped to /api/oura so these cookies are never sent with ordinary page loads.
export function cookie(name, value, maxAgeSeconds) {
  const bits = [
    `${name}=${value}`,
    "Path=/api/oura",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return bits.join("; ");
}

export function clearCookie(name) {
  return cookie(name, "", 0);
}

// Exchanges an authorization code (or a refresh token) for an access token.
// The client secret is read from the environment here and never leaves the
// server.
export async function exchangeOuraToken(params) {
  const { clientId, clientSecret } = ouraCredentials();
  const body = new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret });

  const response = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Oura returned something that isn't JSON -- fall through to the error below.
  }

  if (!response.ok || !json || !json.access_token) {
    const detail =
      (json && (json.error_description || json.error)) ||
      text.slice(0, 200) ||
      `Oura returned ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }

  return json;
}

// The shape stored against the athlete's own account. Deliberately just the
// tokens and an expiry -- no health data is cached server-side.
export function tokenPayload(tokens) {
  const expiresIn = Number(tokens.expires_in) || 86400;
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || "",
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    connected_at: new Date().toISOString(),
  };
}
