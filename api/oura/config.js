// GET /api/oura/config
//
// Lets the app know whether the Oura integration has been set up yet, and
// tells the coach the exact redirect address to register on Oura's side.
// Returns no secrets -- only whether they are present.

import { isOuraConfigured, ouraRedirectUri } from "../_oura.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    configured: isOuraConfigured(),
    redirectUri: ouraRedirectUri(req),
  });
}
