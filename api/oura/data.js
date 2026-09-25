// Everything the app shows about a ring comes through here: a fortnight of
// daily scores, newest last. The browser never holds an Oura token, so it also
// never has to be trusted with one.

import { adminClient, userFromRequest, isConfigured, missingConfig, accessTokenFor, ouraGet } from "./_lib.js";

const DAYS = 14;

function isoDay(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!isConfigured()) return res.status(200).json({ connected: false, configured: false, days: [], missing: missingConfig() });

  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: "not_signed_in" });

  const admin = adminClient();
  let token;
  try {
    token = await accessTokenFor(admin, user.id);
  } catch {
    // The refresh token is dead — usually because the athlete removed the app
    // from their Oura account. Clear it so the app offers to reconnect rather
    // than retrying a token that will never work again.
    await admin.from("oura_connections").delete().eq("user_id", user.id);
    return res.status(200).json({ connected: false, configured: true, days: [], reason: "reconnect_needed" });
  }
  if (!token) return res.status(200).json({ connected: false, configured: true, days: [] });

  const params = { start_date: isoDay(-(DAYS - 1)), end_date: isoDay(1) };

  try {
    const [readiness, sleep, activity] = await Promise.all([
      ouraGet("daily_readiness", token, params),
      ouraGet("daily_sleep", token, params),
      ouraGet("daily_activity", token, params),
    ]);

    const byDay = new Map();
    const touch = (day) => {
      if (!byDay.has(day)) byDay.set(day, { day });
      return byDay.get(day);
    };
    (readiness.data || []).forEach((r) => {
      const row = touch(r.day);
      row.readiness = r.score ?? null;
      row.restingHeartRate = r.contributors?.resting_heart_rate ?? null;
      row.hrvBalance = r.contributors?.hrv_balance ?? null;
      row.bodyTemperature = r.contributors?.body_temperature ?? null;
      row.temperatureDeviation = r.temperature_deviation ?? null;
    });
    (sleep.data || []).forEach((s) => {
      const row = touch(s.day);
      row.sleep = s.score ?? null;
      row.sleepEfficiency = s.contributors?.efficiency ?? null;
      row.remSleep = s.contributors?.rem_sleep ?? null;
      row.deepSleep = s.contributors?.deep_sleep ?? null;
      row.totalSleep = s.contributors?.total_sleep ?? null;
    });
    (activity.data || []).forEach((a) => {
      const row = touch(a.day);
      row.activity = a.score ?? null;
      row.steps = a.steps ?? null;
      row.activeCalories = a.active_calories ?? null;
    });

    const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
    return res.status(200).json({
      connected: true,
      configured: true,
      days,
      today: days.length ? days[days.length - 1] : null,
    });
  } catch (e) {
    const reason = String(e.message || "");
    if (reason === "oura_unauthorized") {
      await admin.from("oura_connections").delete().eq("user_id", user.id);
      return res.status(200).json({ connected: false, configured: true, days: [], reason: "reconnect_needed" });
    }
    if (reason === "oura_rate_limited") {
      return res.status(200).json({ connected: true, configured: true, days: [], reason: "rate_limited" });
    }
    return res.status(200).json({ connected: true, configured: true, days: [], reason: "oura_unavailable" });
  }
}
