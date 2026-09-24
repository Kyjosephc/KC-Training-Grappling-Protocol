// Step one of connecting a ring: hand the browser a one-time URL to send the
// athlete to. The state value ties the trip to their account so the callback
// cannot be replayed or aimed at somebody else's profile.

import { randomBytes } from "node:crypto";
import { adminClient, userFromRequest, isConfigured, redirectUri, OURA_AUTHORIZE_URL, OURA_SCOPE } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!isConfigured() || !redirectUri()) return res.status(503).json({ error: "not_configured" });

  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: "not_signed_in" });

  const admin = adminClient();
  const state = randomBytes(32).toString("base64url");
  const { error } = await admin.from("oura_oauth_state").insert({ state, user_id: user.id });
  if (error) return res.status(500).json({ error: "state_not_saved" });

  const url = new URL(OURA_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.OURA_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", OURA_SCOPE);
  url.searchParams.set("state", state);
  return res.status(200).json({ url: url.toString() });
}
