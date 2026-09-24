// Shared plumbing for the Oura connection.
//
// Oura retired the paste-a-key method in December 2025, so connecting a ring
// means a real OAuth round trip, and OAuth means a client secret. A secret
// cannot live in the browser bundle — anyone who opens the site can read it —
// so these four functions run on Vercel instead, and the browser never sees
// anything but the data it asked for.

import { createClient } from "@supabase/supabase-js";

export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

// Only the scope the app actually reads. Oura shows the athlete this list on the
// consent screen, and a short list is the difference between "this reads my
// sleep" and "why does my coach's app want everything?".
export const OURA_SCOPE = "daily";

export function isConfigured() {
  return Boolean(
    process.env.OURA_CLIENT_ID &&
    process.env.OURA_CLIENT_SECRET &&
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// The service-role client bypasses row-level security, which is exactly why it
// only ever runs here and never in the browser. Every function below scopes its
// queries to one verified user id.
export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Identity comes from the athlete's own Supabase session token, checked against
// Supabase on every call. Nothing trusts an id sent in the request body.
export async function userFromRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

// Oura matches the redirect URI exactly against the whitelist on the app's
// settings page, so it is pinned to one env var rather than guessed from the
// request — a preview deployment has a different host every time and would
// otherwise fail the comparison in a way that is miserable to debug.
export function redirectUri() {
  if (process.env.OURA_REDIRECT_URI) return process.env.OURA_REDIRECT_URI;
  const site = process.env.PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!site) return null;
  const base = site.startsWith("http") ? site : `https://${site}`;
  return `${base.replace(/\/$/, "")}/api/oura/callback`;
}

export function siteUrl() {
  const uri = redirectUri();
  if (!uri) return "/";
  return uri.replace(/\/api\/oura\/callback$/, "");
}

export async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: process.env.OURA_CLIENT_ID,
    client_secret: process.env.OURA_CLIENT_SECRET,
  });
  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token_exchange_failed_${res.status}`);
  return res.json();
}

export async function refreshTokens(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.OURA_CLIENT_ID,
    client_secret: process.env.OURA_CLIENT_SECRET,
  });
  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token_refresh_failed_${res.status}`);
  return res.json();
}

export function expiryFrom(payload) {
  const seconds = Number(payload.expires_in) || 3600;
  // A minute of slack, so a token that expires mid-request is refreshed before
  // it is used rather than after it fails.
  return new Date(Date.now() + (seconds - 60) * 1000).toISOString();
}

// Returns a usable access token for this user, refreshing and re-storing it if
// the stored one has run out. Null means they are not connected.
export async function accessTokenFor(admin, userId) {
  const { data: row } = await admin
    .from("oura_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  const stillValid = row.expires_at && new Date(row.expires_at).getTime() > Date.now();
  if (stillValid) return row.access_token;
  if (!row.refresh_token) return row.access_token || null;

  const fresh = await refreshTokens(row.refresh_token);
  await admin
    .from("oura_connections")
    .update({
      access_token: fresh.access_token,
      // Oura rotates the refresh token on use; keeping the old one would lock
      // the athlete out the next time this runs.
      refresh_token: fresh.refresh_token || row.refresh_token,
      expires_at: expiryFrom(fresh),
    })
    .eq("user_id", userId);
  return fresh.access_token;
}

export async function ouraGet(path, token, params = {}) {
  const url = new URL(`${OURA_API_BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) throw new Error("oura_unauthorized");
  if (res.status === 429) throw new Error("oura_rate_limited");
  if (!res.ok) throw new Error(`oura_failed_${res.status}`);
  return res.json();
}
