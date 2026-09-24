// Forgets the athlete's tokens. Their Oura account is untouched — the app just
// stops being able to read it, which is what "disconnect" should mean.

import { adminClient, userFromRequest } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: "not_signed_in" });
  const { error } = await adminClient().from("oura_connections").delete().eq("user_id", user.id);
  if (error) return res.status(500).json({ error: "disconnect_failed" });
  return res.status(200).json({ connected: false });
}
