// POST /api/oura/data  { access_token, start_date, end_date }
//
// Fetches the athlete's daily summaries from Oura and folds them into one
// simple per-day shape the app can read without knowing anything about Oura's
// response format.
//
// This exists as a server endpoint for two reasons: Oura's API doesn't permit
// direct browser calls, and keeping the shaping here means a change on Oura's
// side is a one-file fix rather than a hunt through the app.

import { OURA_API_BASE } from "../_oura.js";

const COLLECTIONS = ["daily_readiness", "daily_sleep", "daily_activity", "sleep"];

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, places) {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Oura returns every sleep period, naps included. The main night's sleep is the
// longest one, which is also the only one with HRV worth reading for readiness.
function longestSleepPerDay(records) {
  const byDay = {};
  records.forEach((record) => {
    const day = record && record.day;
    if (!day) return;
    const duration = num(record.total_sleep_duration) || 0;
    const existing = byDay[day];
    if (!existing || duration > (num(existing.total_sleep_duration) || 0)) byDay[day] = record;
  });
  return byDay;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = req.body || {};
  const accessToken = body.access_token;
  const startDate = body.start_date;
  const endDate = body.end_date;

  if (!accessToken) {
    res.status(400).json({ error: "missing_access_token" });
    return;
  }
  if (!isDate(startDate) || !isDate(endDate)) {
    res.status(400).json({ error: "bad_dates", message: "start_date and end_date must look like 2026-09-18." });
    return;
  }

  const query = `start_date=${startDate}&end_date=${endDate}`;

  let results;
  try {
    results = await Promise.all(
      COLLECTIONS.map(async (collection) => {
        const response = await fetch(`${OURA_API_BASE}/${collection}?${query}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status === 401 || response.status === 403) {
          return { collection, unauthorized: true, rows: [] };
        }
        if (!response.ok) {
          return { collection, error: `Oura returned ${response.status}`, rows: [] };
        }
        const json = await response.json();
        return { collection, rows: Array.isArray(json.data) ? json.data : [] };
      })
    );
  } catch (e) {
    res.status(502).json({
      error: "oura_unreachable",
      message: e && e.message ? e.message : "Couldn't reach Oura just now.",
    });
    return;
  }

  // An expired or revoked token -- the app should refresh and retry once.
  if (results.some((r) => r.unauthorized)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const by = {};
  results.forEach((r) => {
    by[r.collection] = r.rows;
  });

  const sleepByDay = longestSleepPerDay(by.sleep || []);
  const days = {};

  const ensure = (day) => {
    if (!days[day]) {
      days[day] = {
        day,
        readinessScore: null,
        sleepScore: null,
        activityScore: null,
        totalSleepHours: null,
        timeInBedHours: null,
        sleepEfficiency: null,
        averageHrv: null,
        averageHeartRate: null,
        restingHeartRate: null,
        temperatureDeviation: null,
        steps: null,
      };
    }
    return days[day];
  };

  (by.daily_readiness || []).forEach((row) => {
    if (!row || !row.day) return;
    const d = ensure(row.day);
    d.readinessScore = num(row.score);
    d.temperatureDeviation = num(row.temperature_deviation);
  });

  (by.daily_sleep || []).forEach((row) => {
    if (!row || !row.day) return;
    ensure(row.day).sleepScore = num(row.score);
  });

  (by.daily_activity || []).forEach((row) => {
    if (!row || !row.day) return;
    const d = ensure(row.day);
    d.activityScore = num(row.score);
    d.steps = num(row.steps);
  });

  Object.keys(sleepByDay).forEach((day) => {
    const row = sleepByDay[day];
    const d = ensure(day);
    const totalSeconds = num(row.total_sleep_duration);
    const bedSeconds = num(row.time_in_bed);
    d.totalSleepHours = totalSeconds === null ? null : round(totalSeconds / 3600, 2);
    d.timeInBedHours = bedSeconds === null ? null : round(bedSeconds / 3600, 2);
    d.sleepEfficiency = num(row.efficiency);
    d.averageHrv = num(row.average_hrv);
    d.averageHeartRate = round(num(row.average_heart_rate), 1);
    // Oura's lowest overnight heart rate is the closest thing it reports to a
    // true resting heart rate in beats per minute. (The "resting_heart_rate"
    // field inside daily readiness is a 0-100 contributor score, not a rate.)
    d.restingHeartRate = num(row.lowest_heart_rate);
  });

  const partial = results.filter((r) => r.error).map((r) => ({ collection: r.collection, error: r.error }));

  res.status(200).json({
    days,
    fetchedAt: new Date().toISOString(),
    partial: partial.length ? partial : undefined,
  });
}
