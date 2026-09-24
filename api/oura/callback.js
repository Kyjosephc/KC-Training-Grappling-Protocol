// Where Oura sends the athlete back. Everything here ends in a redirect to the
// app with a short result code, because the athlete is looking at this page in
// their browser and a raw JSON error would be a dead end.

import { adminClient, isConfigured, exchangeCode, expiryFrom, siteUrl } from "./_lib.js";

function back(res, result) {
  res.writeHead(302, { Location: `${siteUrl()}/?oura=${result}` });
  res.end();
}

export default async function handler(req, res) {
  if (!isConfigured()) return back(res, "not_configured");

  const { code, state, error: denied } = req.query || {};
  // The athlete tapped "deny" on Oura's consent screen. Not a failure.
  if (denied) return back(res, "cancelled");
  if (!code || !state) return back(res, "failed");

  const admin = adminClient();
  const { data: pending } = await admin
    .from("oura_oauth_state")
    .select("user_id, created_at")
    .eq("state", state)
    .maybeSingle();
  // One use only, whatever happens next.
  await admin.from("oura_oauth_state").delete().eq("state", state);
  if (!pending) return back(res, "expired");
  // Ten minutes is long enough to read a consent screen and far too short to be
  // worth stealing.
  if (Date.now() - new Date(pending.created_at).getTime() > 10 * 60 * 1000) return back(res, "expired");

  try {
    const tokens = await exchangeCode(code);
    const { error } = await admin.from("oura_connections").upsert({
      user_id: pending.user_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: expiryFrom(tokens),
      scope: tokens.scope || null,
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return back(res, "failed");
    return back(res, "connected");
  } catch {
    return back(res, "failed");
  }
}
