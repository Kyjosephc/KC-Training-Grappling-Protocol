// GET /api/oura/authorize
//
// Step 1 of connecting a ring: send the athlete to Oura's own consent screen.
// A random state value is stored in a short-lived HttpOnly cookie and checked
// again in the callback, so a link from somewhere else can't complete a
// connection on the athlete's behalf.

import crypto from "node:crypto";
import {
  OURA_AUTHORIZE_URL,
  OURA_SCOPES,
  cookie,
  isOuraConfigured,
  ouraCredentials,
  ouraRedirectUri,
} from "../_oura.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!isOuraConfigured()) {
    res.status(503).json({
      error: "not_configured",
      message:
        "Oura isn't set up on this site yet. Add OURA_CLIENT_ID and OURA_CLIENT_SECRET in the Vercel project settings, then redeploy.",
    });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", cookie("oura_state", state, 600));

  const url = new URL(OURA_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", ouraCredentials().clientId);
  url.searchParams.set("redirect_uri", ouraRedirectUri(req));
  url.searchParams.set("scope", OURA_SCOPES);
  url.searchParams.set("state", state);

  res.redirect(302, url.toString());
}
