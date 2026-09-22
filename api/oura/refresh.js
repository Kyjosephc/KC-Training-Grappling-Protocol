// POST /api/oura/refresh  { refresh_token }
//
// Oura access tokens expire. The app calls this when its stored token is past
// (or near) its expiry, or when a data call comes back unauthorized, and gets a
// fresh pair to store. Rotating refresh tokens are handled by falling back to
// the existing one when Oura doesn't return a new one.

import { exchangeOuraToken, isOuraConfigured, tokenPayload } from "../_oura.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!isOuraConfigured()) {
    res.status(503).json({ error: "not_configured" });
    return;
  }

  const refreshToken = req.body && req.body.refresh_token;
  if (!refreshToken) {
    res.status(400).json({ error: "missing_refresh_token" });
    return;
  }

  try {
    const tokens = await exchangeOuraToken({
      grant_type: "refresh_token",
      refresh_token: String(refreshToken),
    });
    const payload = tokenPayload(tokens);
    if (!payload.refresh_token) payload.refresh_token = String(refreshToken);
    res.status(200).json(payload);
  } catch (e) {
    // A refresh token that Oura rejects means the athlete has to reconnect --
    // say so distinctly so the app can prompt for that rather than retrying.
    res.status(401).json({
      error: "refresh_failed",
      message: e && e.message ? e.message : "Oura rejected the refresh token.",
    });
  }
}
