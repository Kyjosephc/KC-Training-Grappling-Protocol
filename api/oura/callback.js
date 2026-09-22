// GET /api/oura/callback
//
// Step 2: Oura sends the athlete back here with a one-time code. That code is
// traded for tokens using the client secret, which only exists on the server.
//
// The tokens are handed back to the app through a short-lived HttpOnly cookie
// that the app redeems once via /api/oura/claim -- deliberately NOT through the
// URL, so access tokens never land in browser history, bookmarks, or a shared
// link. The app then stores them against the athlete's own Supabase row, where
// row-level security keeps them as private as the rest of their training data.

import {
  appOrigin,
  clearCookie,
  cookie,
  exchangeOuraToken,
  isOuraConfigured,
  ouraRedirectUri,
  parseCookies,
  tokenPayload,
} from "../_oura.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const origin = appOrigin(req);

  const finish = (marker, extraCookie) => {
    const cookies = [clearCookie("oura_state")];
    if (extraCookie) cookies.push(extraCookie);
    res.setHeader("Set-Cookie", cookies);
    res.redirect(302, `${origin}/#${marker}`);
  };

  const fail = (reason) => finish(`oura_error=${encodeURIComponent(reason)}`);

  if (!isOuraConfigured()) return fail("Oura isn't set up on this site yet.");

  const { code, state, error, error_description: errorDescription } = req.query || {};

  if (error) return fail(String(errorDescription || error));
  if (!code) return fail("Oura didn't send back an authorization code.");

  const cookies = parseCookies(req.headers.cookie);
  if (!state || !cookies.oura_state || String(state) !== cookies.oura_state) {
    return fail("That connection link expired or didn't match. Please try connecting again.");
  }

  try {
    const tokens = await exchangeOuraToken({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: ouraRedirectUri(req),
    });

    const payload = Buffer.from(JSON.stringify(tokenPayload(tokens)), "utf8").toString("base64url");
    finish("oura_connected=1", cookie("oura_tokens", payload, 300));
  } catch (e) {
    fail(e && e.message ? e.message : "Couldn't complete the connection with Oura.");
  }
}
