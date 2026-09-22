// POST /api/oura/claim
//
// Step 3: the app redeems the one-time cookie set by the callback and gets the
// tokens back as JSON, exactly once. The cookie is cleared on the way out
// whether or not it was there, so a connection can't be replayed.

import { clearCookie, parseCookies } from "../_oura.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", clearCookie("oura_tokens"));

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const raw = parseCookies(req.headers.cookie).oura_tokens;
  if (!raw) {
    res.status(404).json({ error: "no_pending_connection" });
    return;
  }

  try {
    const tokens = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    res.status(200).json(tokens);
  } catch {
    res.status(400).json({ error: "bad_payload" });
  }
}
