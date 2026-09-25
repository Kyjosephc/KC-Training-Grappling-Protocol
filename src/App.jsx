import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Home, CalendarDays, History as HistoryIcon, TrendingUp, Trophy,
  Users, Plus, ChevronRight, ChevronLeft, Check, Timer, ArrowLeft, Pencil, Trash2,
  Scale, ListChecks, Info, Settings as SettingsIcon, Sun, Moon, X, Calendar, RotateCcw, Calculator, ListOrdered, HelpCircle, BookOpen, LogOut, Mail, Lock, Download, LayoutDashboard, Share2, DollarSign
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";

/* ============================== SUPABASE (real accounts, real database) ============================== */
// Every person who uses this app creates their own account below and gets their own
// permanently saved data, on any device. This replaces the old Claude-only storage.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const coachVenmo = import.meta.env.VITE_COACH_VENMO || "";
const coachCashApp = import.meta.env.VITE_COACH_CASHAPP || "";
const coachPaymentLink = import.meta.env.VITE_COACH_PAYMENT_LINK || "";
const COACH_USER_ID = import.meta.env.VITE_COACH_USER_ID || "";
const PROGRAM_PRICE = 20;
// Promo codes map to a dollar amount off PROGRAM_PRICE. Add more codes here as needed.
const PROMO_CODES = { INFINITI: 5 };

/* ============================== STORAGE HELPERS ============================== */
// Returned by a read that FAILED, as opposed to a read that found nothing. The
// difference matters enormously: "no client list" means show onboarding, and
// "couldn't reach the server" must never mean that.
const LOAD_FAILED = Symbol("load-failed");
// These five functions are the ONLY place the rest of the app talks to storage.
// Everything else in this file is unchanged from the original Claude-artifact version.

const CLIENT_LIST_KEY = "sc-app:client-list";
const SETTINGS_KEY = "sc-app:settings";
const REVIEWED_SIGNUPS_KEY = "sc-app:reviewed-signups";
const clientKey = (id) => `sc-app:client:${id}`;

/* ============================== SYNC STATUS / ERROR TOASTS ============================== */
// A small pub/sub layer so a failed save surfaces to the person using the app instead of
// failing silently. Reads and writes route through kvGet/kvSet/kvDelete below, which retry
// automatically on a hiccup and report here only if they ultimately fail.

let toastListeners = [];
let toastSeq = 0;
function emitToast(toast) {
  const withId = { id: ++toastSeq, ...toast };
  toastListeners.forEach((fn) => fn(withId));
  return withId.id;
}
function useToastFeed() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const listener = (toast) => {
      setToasts((prev) => [...prev, toast]);
      if (toast.autoDismissMs) setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), toast.autoDismissMs);
    };
    toastListeners.push(listener);
    return () => { toastListeners = toastListeners.filter((l) => l !== listener); };
  }, []);
  return { toasts, dismiss: (id) => setToasts((prev) => prev.filter((t) => t.id !== id)) };
}

let syncListeners = [];
let lastSyncedAt = null;
function markSynced() {
  lastSyncedAt = new Date();
  syncListeners.forEach((fn) => fn(lastSyncedAt));
}
function useLastSynced() {
  const [t, setT] = useState(lastSyncedAt);
  useEffect(() => {
    const listener = (d) => setT(d);
    syncListeners.push(listener);
    return () => { syncListeners = syncListeners.filter((l) => l !== listener); };
  }, []);
  return t;
}

async function withRetry(fn, retries = 2, delayMs = 900) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { const result = await fn(); return { ok: true, result }; }
    catch (err) { lastErr = err; if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1))); }
  }
  return { ok: false, error: lastErr };
}

async function kvGet(userId, key) {
  if (!supabase || !userId) return null;
  const outcome = await withRetry(async () => {
    const { data, error } = await supabase.from("kv_store").select("value").eq("user_id", userId).eq("key", key).maybeSingle();
    if (error) throw error;
    return data;
  });
  if (!outcome.ok) {
    // NOT null. A failed read and an empty record are completely different
    // things, and conflating them is how an eight-week athlete gets shown the
    // welcome screen on bad gym wifi and overwrites their own client list.
    emitToast({ kind: "error", message: "Couldn't load your data — check your connection.", autoDismissMs: 6000 });
    return LOAD_FAILED;
  }
  return outcome.result ? outcome.result.value : null;
}
// The newest value written for each key, so a Retry tapped minutes later sends
// current data rather than the snapshot that originally failed.
const latestWrites = new Map();
async function kvSet(userId, key, value) {
  if (!supabase || !userId) return { ok: false };
  latestWrites.set(`${userId}:${key}`, value);
  const outcome = await withRetry(async () => {
    const { error } = await supabase.from("kv_store").upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  });
  if (outcome.ok) { markSynced(); return { ok: true }; }
  // Re-read the latest value at retry time. Retrying the stale snapshot could
  // overwrite work the athlete did after the failure while the toast sat there.
  emitToast({ kind: "error", message: "Couldn't save your last change — check your connection.", retryLabel: "Retry", onRetry: () => kvSet(userId, key, latestWrites.get(`${userId}:${key}`) ?? value) });
  return { ok: false };
}
async function kvDelete(userId, key) {
  if (!supabase || !userId) return { ok: false };
  const outcome = await withRetry(async () => {
    const { error } = await supabase.from("kv_store").delete().eq("user_id", userId).eq("key", key);
    if (error) throw error;
  });
  if (outcome.ok) { markSynced(); return { ok: true }; }
  emitToast({ kind: "error", message: "Couldn't delete — check your connection.", retryLabel: "Retry", onRetry: () => kvDelete(userId, key) });
  return { ok: false };
}

async function getClientList(userId) { const v = await kvGet(userId, CLIENT_LIST_KEY); return v === LOAD_FAILED ? LOAD_FAILED : (v || []); }
async function setClientList(userId, list) { return kvSet(userId, CLIENT_LIST_KEY, list); }
async function getClient(userId, id) { const v = await kvGet(userId, clientKey(id)); return v === LOAD_FAILED ? LOAD_FAILED : (v || null); }
async function setClient(userId, id, data) { return kvSet(userId, clientKey(id), data); }
async function deleteClientStorage(userId, id) { return kvDelete(userId, clientKey(id)); }
async function getSettings(userId) { const v = await kvGet(userId, SETTINGS_KEY); return (!v || v === LOAD_FAILED) ? { theme: "dark" } : v; }
async function setSettings(userId, s) { return kvSet(userId, SETTINGS_KEY, s); }

/* ============================== ID / MATH HELPERS ============================== */

const uid = () => Math.random().toString(36).slice(2, 10);
// Local calendar date, not UTC — new Date().toISOString() rolls over to the next
// day for anyone west of UTC once it's evening locally (all of the US, for example),
// which silently mis-logs workouts/bodyweight/check-ins to tomorrow's date.
const toLocalDateStr = (d) => {
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
};
const todayStr = () => toLocalDateStr(new Date());
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
// Charts keep the ISO date as their key so two different years can never land
// on the same point, and only format it for display. Past twelve months the
// year is shown, because "Sep 24" alone stops being unambiguous.
const fmtChartDate = (d) => {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return String(d ?? "");
  const dt = new Date(d + "T00:00:00");
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" });
};
// Full date and time, for the waiver record — a signature without a timestamp
// is not much of a record.
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }); } catch { return String(iso || ""); } };

function daysSinceLastActivity(client) {
  const dates = [
    ...(client.logs || []).map((l) => l.date),
    ...(client.mobilityLogs || []).map((m) => m.date),
  ].filter(Boolean).sort();
  const last = dates.length ? dates[dates.length - 1] : client.createdAt;
  if (!last) return 0;
  const lastDate = new Date(last + "T00:00:00");
  const now = new Date(todayStr() + "T00:00:00");
  return Math.max(0, Math.round((now - lastDate) / (1000 * 60 * 60 * 24)));
}

function reengagementMessage(days) {
  if (days < 5) return null;
  if (days < 10) return `It's been ${days} days since your last session — jump back in today, even a short one counts.`;
  if (days < 21) return `It's been ${days} days. No judgment — everything's saved exactly where you left it, and picking back up today is the whole move.`;
  return `It's been over ${Math.floor(days / 7)} weeks since your last session. Nothing is lost — restart whenever it works for you, today or any day.`;
}

// Epley, capped. Past about a dozen reps the formula stops describing strength
// and starts describing work capacity — at 20 reps it claims 1.67x, which would
// then drive every weight suggestion the app makes from that day on.
const E1RM_REP_CAP = 12;
function est1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + Math.min(reps, E1RM_REP_CAP) / 30));
}
function bestSetOf(sets) {
  let best = null;
  for (const s of sets || []) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    if (!w || !r) continue;
    // A high-rep back-off set is not evidence of a new max. Ignore those
    // entirely rather than letting one set of twenty poison the estimate.
    if (r > E1RM_REP_CAP) continue;
    const e = est1RM(w, r);
    if (!best || e > best.e1rm) best = { weight: w, reps: r, e1rm: e };
  }
  return best;
}
function upsertBodyweight(log, date, weight) {
  const filtered = (log || []).filter((e) => e.date !== date);
  filtered.push({ date, weight });
  return filtered.sort((a, b) => (a.date < b.date ? -1 : 1));
}
function rpeFromRir(rir) {
  const n = Number(rir);
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.min(10, 10 - n));
}
// Standard strength-coaching RPE chart (the same one used by most autoregulated programs):
// %1RM at true 0-reps-in-reserve (RPE 10) for a given rep count, then roughly 2.5% is subtracted
// per point below RPE 10. This lets any RPE + rep target also show a calculated suggested weight,
// once a real max has been logged for that exercise — the RPE stays the actual target effort,
// the percentage is just what that effort is expected to correspond to.
const PCT_AT_RPE10_BY_REPS = { 1: 100, 2: 95, 3: 92, 4: 89, 5: 86, 6: 84, 7: 81, 8: 79, 9: 76, 10: 74, 11: 72, 12: 70, 15: 65, 20: 58 };
function pctFromRpeReps(rpe, reps) {
  const match = String(reps).match(/^\d+/);
  const r = match ? Number(match[0]) : NaN;
  if (!r || Number.isNaN(r) || !rpe) return null;
  let base;
  if (PCT_AT_RPE10_BY_REPS[r] !== undefined) base = PCT_AT_RPE10_BY_REPS[r];
  else if (r > 20) base = 50;
  else {
    // interpolate between the nearest known rep counts
    const knownReps = Object.keys(PCT_AT_RPE10_BY_REPS).map(Number).sort((a, b) => a - b);
    let lo = knownReps[0], hi = knownReps[knownReps.length - 1];
    for (let i = 0; i < knownReps.length - 1; i++) { if (r >= knownReps[i] && r <= knownReps[i + 1]) { lo = knownReps[i]; hi = knownReps[i + 1]; break; } }
    const t = (r - lo) / (hi - lo);
    base = PCT_AT_RPE10_BY_REPS[lo] + t * (PCT_AT_RPE10_BY_REPS[hi] - PCT_AT_RPE10_BY_REPS[lo]);
  }
  const pct = base - (10 - rpe) * 2.5;
  const clamped = Math.max(30, Math.min(100, pct));
  // Round up to the nearest 5 percent — 79% becomes 80%, 74% becomes 75% — so every
  // percentage shown anywhere in the app is a clean, easy-to-load number on the bar.
  return Math.ceil(clamped / 5) * 5;
}
// A rep target counts as "loadable" (worth a %1RM suggestion) only if it's a genuine number of reps —
// "6", "3 each side", "10 to 12 each" all count. Holds, carries, and distance work (seconds, meters,
// minutes) don't get a percentage, since %1RM doesn't apply to them.
function isLoadableReps(repsStr) {
  const s = String(repsStr).trim().toLowerCase();
  if (/second|minute|meter|\bsec\b|\bmin\b|hold/.test(s)) return false;
  return /^\d+/.test(s);
}
function defaultRepsFor(target, setIdx) {
  if (target.perSetTargets) return String(target.perSetTargets[setIdx]?.reps ?? "");
  const m = String(target.reps ?? "").match(/\d+/);
  return m ? m[0] : "";
}
function defaultRirFor(target, setIdx) {
  if (target.perSetTargets) return target.perSetTargets[setIdx]?.rir !== undefined ? String(target.perSetTargets[setIdx].rir) : "";
  return target.rir !== undefined ? String(target.rir) : "";
}

/* ============================== TOTAL WEIGHT LIFTED / MILESTONES ============================== */
// Approximate, rounded real-world weights for fun comparisons — not scientific figures.

const LIFT_MILESTONE_BASE = [
  { name: "a Touring Motorcycle", weight: 900, emoji: "🏍️" },
  { name: "an Adult Grizzly Bear", weight: 900, emoji: "🐻" },
  { name: "a Grand Piano", weight: 1000, emoji: "🎹" },
  { name: "a Vending Machine", weight: 1200, emoji: "🥤" },
  { name: "a Polar Bear", weight: 1500, emoji: "🐻‍❄️" },
  { name: "a Draft Horse", weight: 1800, emoji: "🐴" },
  { name: "an American Bison", weight: 2000, emoji: "🦬" },
  { name: "a Giraffe", weight: 2600, emoji: "🦒" },
  { name: "a Compact Car", weight: 2700, emoji: "🚗" },
  { name: "a Sedan", weight: 3300, emoji: "🚗" },
  { name: "a Walrus", weight: 4000, emoji: "🦭" },
  { name: "a Small Fishing Boat", weight: 4500, emoji: "🚤" },
  { name: "a Pickup Truck", weight: 5000, emoji: "🛻" },
  { name: "a Sport Utility Vehicle", weight: 5500, emoji: "🚙" },
  { name: "a Rhinoceros", weight: 6000, emoji: "🦏" },
  { name: "a Cement Mixer Truck (empty)", weight: 8000, emoji: "🚛" },
  { name: "a Killer Whale", weight: 12000, emoji: "🐳" },
  { name: "a Hippopotamus", weight: 12000, emoji: "🦛" },
  { name: "an African Elephant", weight: 14000, emoji: "🐘" },
  { name: "a Loaded Delivery Truck", weight: 15000, emoji: "🚚" },
  { name: "a Young Humpback Whale", weight: 20000, emoji: "🐋" },
  { name: "a School Bus", weight: 24000, emoji: "🚌" },
  { name: "a Loaded Concrete Mixer", weight: 35000, emoji: "🚛" },
  { name: "a Fire Truck", weight: 40000, emoji: "🚒" },
  { name: "an Articulated City Bus", weight: 45000, emoji: "🚌" },
  { name: "a Small Yacht", weight: 55000, emoji: "⛵" },
  { name: "a Light Military Tank", weight: 60000, emoji: "🛡️" },
  { name: "a Young Sperm Whale", weight: 65000, emoji: "🐋" },
  { name: "a Fully Loaded Semi-Truck", weight: 80000, emoji: "🚛" },
  { name: "a Modern Battle Tank", weight: 140000, emoji: "🛡️" },
  { name: "a Small Private Jet", weight: 150000, emoji: "🛩️" },
  { name: "a Space Shuttle Orbiter", weight: 165000, emoji: "🚀" },
  { name: "a Steam Locomotive", weight: 200000, emoji: "🚂" },
  { name: "an Average Wood-Frame House", weight: 250000, emoji: "🏠" },
  { name: "an Adult Humpback Whale", weight: 280000, emoji: "🐋" },
  { name: "a Wind Turbine (nacelle and blades)", weight: 300000, emoji: "🌬️" },
  { name: "a Blue Whale", weight: 330000, emoji: "🐋" },
  { name: "a Boeing 747 (empty)", weight: 400000, emoji: "✈️" },
  { name: "the Statue of Liberty", weight: 450000, emoji: "🗽" },
  { name: "an Airbus A380 (empty)", weight: 500000, emoji: "✈️" },
  { name: "a Modern Passenger Train Locomotive", weight: 600000, emoji: "🚆" },
  { name: "a Small Diesel-Electric Submarine", weight: 700000, emoji: "🌊" },
  { name: "the International Space Station", weight: 925000, emoji: "🛰️" },
  { name: "an Antonov An-225 (heaviest airplane ever built)", weight: 1400000, emoji: "✈️" },
  { name: "a Space Shuttle at Launch", weight: 4400000, emoji: "🚀" },
  { name: "a Nuclear Submarine", weight: 6000000, emoji: "🌊" },
  { name: "a Saturn V Rocket, Fully Fueled", weight: 6500000, emoji: "🚀" },
  { name: "a Historic Ocean Liner", weight: 8000000, emoji: "🚢" },
  { name: "a Small Passenger Cruise Ship", weight: 10000000, emoji: "🚢" },
  { name: "the Eiffel Tower", weight: 16000000, emoji: "🗼" },
  { name: "a Large Cargo Container Ship", weight: 25000000, emoji: "🚢" },
  { name: "an Older Escort Aircraft Carrier", weight: 35000000, emoji: "🚢" },
  { name: "a Large Modern Cruise Ship", weight: 50000000, emoji: "🚢" },
  { name: "the RMS Titanic", weight: 100000000, emoji: "🚢" },
  { name: "a Nimitz-Class Aircraft Carrier", weight: 200000000, emoji: "🚢" },
  { name: "an Ultra-Large Container Ship, Fully Loaded", weight: 300000000, emoji: "🚢" },
  { name: "the Empire State Building", weight: 730000000, emoji: "🏙️" },
  { name: "the Golden Gate Bridge", weight: 1600000000, emoji: "🌉" },
  { name: "the Great Pyramid of Giza", weight: 12000000000, emoji: "🔺" },
  { name: "the Hoover Dam", weight: 13200000000, emoji: "🏞️" },
  { name: "the Three Gorges Dam", weight: 70000000000, emoji: "🏞️" },
  { name: "a Small Near-Earth Asteroid", weight: 1000000000000, emoji: "☄️" },
  { name: "Mount Everest", weight: 350000000000000, emoji: "🏔️" },
  { name: "the Moon", weight: 162000000000000000000000, emoji: "🌙" },
  { name: "the entire World", weight: 13170000000000000000000000, emoji: "🌍" },
];
function pluralizeMilestoneName(rawName, count) {
  if (count === 1) return rawName;
  let base = rawName.replace(/^(a|an|the)\s+/i, "");
  const m = base.match(/^(.*?)(\s*\([^)]*\))?$/);
  let main = (m[1] || base).trim();
  const paren = m[2] || "";
  if (/(s|x|z|ch|sh)$/i.test(main)) main += "es";
  else if (/[^aeiou]y$/i.test(main)) main = main.slice(0, -1) + "ies";
  else main += "s";
  return `${count} ${main}${paren}`;
}
// The first 5 milestones are 50,000 pounds apart; every one after that is 100,000
// pounds apart, so the full climb to all 300 takes noticeably longer than an
// object-weight-derived scale would. Each threshold still gets a fun real-world
// comparison — whichever base object (at 1 to 5 of it) lands closest to that exact
// number, so the name shown next to a milestone stays consistent with its weight.
function generateMilestones() {
  const thresholds = [];
  for (let i = 0; i < 300; i++) {
    thresholds.push(i < 5 ? 50000 * (i + 1) : 250000 + 100000 * (i - 4));
  }
  let prevKey = null;
  return thresholds.map((weight) => {
    let best = null;
    LIFT_MILESTONE_BASE.forEach((obj) => {
      for (let count = 1; count <= 5; count++) {
        const approx = obj.weight * count;
        const err = Math.abs(approx - weight) / weight;
        const key = `${obj.name}|${count}`;
        // Slightly penalize repeating the exact same object+count as the milestone
        // right before it, so a long run of identical names is rare, not the norm.
        const adjErr = key === prevKey ? err + 0.01 : err;
        if (!best || adjErr < best.adjErr) best = { obj, count, adjErr, key };
      }
    });
    prevKey = best.key;
    return { name: pluralizeMilestoneName(best.obj.name, best.count), weight, emoji: best.obj.emoji };
  });
}
const LIFT_MILESTONES = generateMilestones();

const BELT_COLORS = { White: "#d9d9d9", Grey: "#8a8d91", Yellow: "#e8c547", Orange: "#e07b39", Green: "#3f9142", Blue: "#2f6fb3", Purple: "#7c3fa8", Brown: "#7a4a24", Black: "#c81e2c" };

function formatWeight(lbs) {
  if (lbs >= 1e24) return `${(lbs / 1e24).toFixed(1)} septillion pounds`;
  if (lbs >= 1e21) return `${(lbs / 1e21).toFixed(1)} sextillion pounds`;
  if (lbs >= 1e18) return `${(lbs / 1e18).toFixed(1)} quintillion pounds`;
  if (lbs >= 1e15) return `${(lbs / 1e15).toFixed(1)} quadrillion pounds`;
  if (lbs >= 1e12) return `${(lbs / 1e12).toFixed(1)} trillion pounds`;
  if (lbs >= 1e9) return `${(lbs / 1e9).toFixed(1)} billion pounds`;
  if (lbs >= 1e6) return `${(lbs / 1e6).toFixed(1)} million pounds`;
  return `${Math.round(lbs).toLocaleString()} pounds`;
}
function milestoneProgress(client) {
  const sortedLogs = [...client.logs].sort((a, b) => (a.date < b.date ? -1 : 1));
  let cumulative = 0;
  const achievedDates = {};
  for (const log of sortedLogs) {
    cumulative += log.totalVolume || 0;
    LIFT_MILESTONES.forEach((m, idx) => {
      if (cumulative >= m.weight && achievedDates[idx] === undefined) achievedDates[idx] = log.date;
    });
  }
  return { total: cumulative, achievedDates };
}
function weeklyVolumeSeries(client) {
  const map = {};
  client.logs.forEach((log) => {
    const d = new Date(log.date + "T00:00:00");
    const day = d.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    const key = toLocalDateStr(monday);
    map[key] = (map[key] || 0) + (log.totalVolume || 0);
  });
  return Object.keys(map).sort().map((k) => ({ date: k, volume: map[k] }));
}

/* ============================== CONJUGATE HELPERS ============================== */

// Human-readable label for each rotating exercise pool. Falls back to "Max Effort Upper"
// only for the two known Max Effort pools; anything else (durability, core, conditioning
// pools, or a pool added later) gets its own real label instead of being mislabeled.
const ROTATING_POOL_LABELS = {
  meLowerPool: "Max Effort Lower",
  meUpperPool: "Max Effort Upper",
  hipPool: "Hip & Adductor Durability",
  wristPool: "Wrist & Grip Durability",
  coreAntiPool: "Anti-Rotation Core",
  conditioningIntervalPool: "Conditioning",
};
function poolLabelFor(rotatingPool) {
  return ROTATING_POOL_LABELS[rotatingPool] || "Rotating Exercise";
}

function resolveExercise(e, weekNumber, program, phase, opts = {}) {
  const blockNumber = opts.blockNumber || 1;
  const excludedExercises = opts.excludedExercises || [];
  if (e.rotatingPool && program.conjugate?.[e.rotatingPool]) {
    const fullPool = program.conjugate[e.rotatingPool];
    // Skip anything the athlete has flagged to avoid, unless that would empty the pool.
    const filteredPool = fullPool.filter((item) => !excludedExercises.includes(item.name));
    const pool = filteredPool.length ? filteredPool : fullPool;
    const rotW = program.conjugate.meRotationWeeks || 2;
    // Folding blockNumber into the offset means block 2 doesn't start the rotation at the
    // exact same spot as block 1 — without this, every restart replayed an identical sequence.
    const idx = (Math.floor((weekNumber - 1) / rotW) + (blockNumber - 1)) % pool.length;
    const chosen = pool[idx];
    return { ...e, name: chosen.name, purpose: chosen.notes || e.purpose, videoUrl: chosen.videoUrl || lookupVideo(chosen.name) || "",
      reps: chosen.reps || e.reps, sets: chosen.sets || e.sets, load: chosen.load || e.load, cues: chosen.cues || e.cues,
      rir: chosen.rir !== undefined ? chosen.rir : e.rir,
      poolLabel: poolLabelFor(e.rotatingPool) };
  }
  // The phase text promises the effort climbs across a block. Without this the
  // athlete saw the identical target in week 1 and week 3. Capped at one rep in
  // reserve rather than true failure: these people roll the next day.
  if (e.rpeWave && phase && phase.weekEnd > phase.weekStart) {
    const step = Math.min(Math.max(weekNumber - phase.weekStart, 0), 1);
    const waved = Math.max(1, (e.rir === undefined ? 2 : e.rir) - step);
    if (waved !== e.rir) e = { ...e, rir: waved };
  }
  if (e.deWave) {
    const pct = phase?.dePercent || "55%";
    const nums = (pct.match(/\d+/g) || []).map(Number);
    const pctNum = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    // A jump is not a box squat. Peak power on a loaded jump sits far below the
    // percentages that are correct for a barbell Dynamic Effort lift, and past
    // roughly a third of a max the athlete stops leaving the ground and just
    // absorbs the landing. deJump lifts get their own, much lighter wave.
    const jumpPct = pctNum === null ? null : pctNum <= 50 ? 20 : pctNum <= 55 ? 25 : 30;
    const effPct = e.deJump ? jumpPct : pctNum;
    const maxLabel = e.deMaxLabel || "One-Rep Max";
    const perSetTargets = effPct ? Array.from({ length: e.sets || 8 }, () => ({ pct1rm: effPct, reps: e.reps, rir: e.rir })) : e.perSetTargets;
    const loadText = e.deJump
      ? `${effPct}% of your ${maxLabel} — light enough that you clear the floor on every rep`
      : `${pct} of your ${maxLabel}, maximal bar speed`;
    return { ...e, load: loadText, perSetTargets };
  }
  return e;
}
function resolveSectionExercises(section, weekNumber, program, phase, opts) {
  return section.exercises.map((e) => resolveExercise(e, weekNumber, program, phase, opts));
}
function resolveDaySections(day, weekNumber, program, phase, veteranMode, opts) {
  const isDeload = (phase?.name || "").toLowerCase().includes("deload");
  return day.sections.map((sec) => {
    let exercises = resolveSectionExercises(sec, weekNumber, program, phase, opts);
    if (veteranMode && isDeload && sec.type === "strength") {
      exercises = exercises.map((e) => ({
        ...e,
        perSetTargets: e.perSetTargets ? e.perSetTargets.map((t) => ({ ...t, pct1rm: t.pct1rm ? Math.max(35, t.pct1rm - 10) : t.pct1rm, rir: t.rir + 1 })) : e.perSetTargets,
        cues: `${e.cues || ""} Veteran Athlete Mode: this deload is deeper than standard — every set trimmed further and with an extra rep in reserve, since accumulated training age benefits from more genuine unloading here.`.trim(),
      }));
    }
    // Applied last, so a substitution is what the athlete actually sees and
    // logs — in the preview and in the live session alike, since both resolve
    // through here.
    exercises = applyInjurySubstitutions(exercises, opts && opts.injuryAreas);
    return { ...sec, exercises };
  });
}
function primaryLiftName(day, weekNumber, program, phase, opts) {
  for (const sec of day.sections) {
    if (sec.type === "strength" || sec.type === "power") {
      const first = sec.exercises[0];
      if (first) return resolveExercise(first, weekNumber, program, phase, opts).name;
    }
  }
  return day.name;
}
function resolveOptsFor(client) {
  return { blockNumber: client.blockNumber || 1, excludedExercises: client.excludedExercises || [], injuryAreas: client.injuryAreas || [] };
}
function sectionHeadline(resolvedSec) {
  if ((resolvedSec.type === "strength" || resolvedSec.type === "power") && resolvedSec.exercises[0]) {
    return resolvedSec.exercises[0].name;
  }
  return resolvedSec.name;
}
function totalSessionsIn(program) {
  const perWeek = program.sessionsPerWeek || 3;
  const totalWeeks = Math.max(...program.phases.map((p) => p.weekEnd));
  return perWeek * totalWeeks;
}
function positionAtIndex(program, index) {
  const perWeek = program.sessionsPerWeek || 3;
  const totalWeeks = Math.max(...program.phases.map((p) => p.weekEnd));
  const total = perWeek * totalWeeks;
  const clamped = Math.max(0, Math.min(index, total - 1));
  const weekNumber = Math.floor(clamped / perWeek) + 1;
  const dayIndex = clamped % perWeek;
  const phase = program.phases.find((p) => weekNumber >= p.weekStart && weekNumber <= p.weekEnd) || program.phases[program.phases.length - 1];
  const day = phase.days[dayIndex % phase.days.length];
  return { index: clamped, weekNumber, phase, day, total };
}

/* ============================== READINESS-BASED ADJUSTMENT ============================== */

function adjustSectionsForReadiness(sections, readinessEntry) {
  if (!readinessEntry) return { sections, adjustedNote: null };
  const color = readinessEntry.color;
  const bjjHard = !!readinessEntry.bjjHard;
  const notes = [];

  const adjusted = sections.map((sec) => {
    let exs = sec.exercises;
    let skipped = false;
    // The warm-up always stays. Walking in cold and ramping to a heavy lift is
    // the last thing a beaten-up athlete should do, and this block was being
    // deleted on exactly the day it mattered most.
    if (color === "RED" && sec.type === "arms_core") {
      return { ...sec, exercises: [], skipped: true };
    }
    // Durability — neck, adductors, tibialis — costs almost no fatigue and is
    // the most protective work in the session. This athlete is still rolling
    // tonight and still getting choked. It stays, at a reduced dose.
    if (color === "RED" && sec.type === "durability") {
      exs = exs.map((e) => ({ ...e, sets: Math.max(1, Math.round((e.sets || 2) * 0.5)) }));
    }
    if (color === "RED" && sec.type === "agility") {
      exs = exs.map((e) => ({ ...e, sets: Math.max(1, Math.round((e.sets || 2) * 0.5)),
        cues: `${e.cues || ""} Today: movement prep only — keep it easy and submaximal.`.trim() }));
    }
    // Cut the neural work first, and cut SETS rather than shaving load —
    // volume is what drives fatigue, and a 15% lighter bar over the same six
    // ramping sets is barely a reduction at all.
    if (color === "RED" && sec.type === "strength") {
      exs = exs.map((e) => {
        // A max-effort ramp collapses to a single controlled top set; everything
        // else just loses half its sets.
        const isRamp = /down to 1|top single|working sets/i.test(String(e.reps));
        return {
        ...e,
        sets: isRamp ? 1 : Math.max(1, Math.round((e.sets || 3) * 0.5)),
        reps: isRamp ? "one top set of 3 to 5, well short of a max" : e.reps,
        rir: Math.max(e.rir || 0, 3),
        cues: `${e.cues || ""} Today: no singles and no grinding. One controlled top set of 3 to 5 at roughly 70 percent, then move on. You flagged low readiness and this is the session respecting that.`.trim(),
        perSetTargets: e.perSetTargets ? e.perSetTargets.slice(0, 1).map((t) => ({ ...t, rir: Math.max(t.rir, 3), pct1rm: t.pct1rm ? Math.min(t.pct1rm, 70) : t.pct1rm, note: t.pct1rm && t.pct1rm >= 80 ? "Capped — low readiness" : t.note })) : e.perSetTargets,
        pct1rmFlat: e.pct1rmFlat ? Math.min(e.pct1rmFlat, 70) : e.pct1rmFlat,
        };
      });
    }
    // Speed and power work is a nervous-system and landing demand, and it is
    // the first thing that degrades when you are wrecked. Halve it.
    if (color === "RED" && sec.type === "power") {
      exs = exs.map((e) => ({
        ...e,
        sets: Math.max(1, Math.round((e.sets || 6) * 0.5)),
        cues: `${e.cues || ""} Today: half the usual sets. Speed work is worth nothing when you are this tired — stop early if it is not sharp.`.trim(),
        perSetTargets: e.perSetTargets ? e.perSetTargets.map((t) => ({ ...t, pct1rm: t.pct1rm ? Math.min(t.pct1rm, 55) : t.pct1rm })) : e.perSetTargets,
        pct1rmFlat: e.pct1rmFlat ? Math.min(e.pct1rmFlat, 55) : e.pct1rmFlat,
      }));
    }
    if (color === "RED" && sec.type === "conditioning") {
      exs = exs.map((e) => {
        const isHard = /interval|round|tempo|hard|sprint|power/i.test(`${e.name} ${e.reps}`);
        // Easy aerobic work on a bad day actively helps you recover. It is the
        // hard intervals that are worth nothing today, so those are what goes.
        return isHard
          ? { ...e, name: e.name, reps: "20 minutes easy — conversational pace", cues: "Today's intervals are replaced with easy aerobic work. A hard session on low readiness costs a lot and delivers almost nothing, because the efforts will not be sharp enough to drive the adaptation anyway. Easy movement is genuinely useful on a day like this." }
          : { ...e, cues: `${e.cues || ""} Keep this easy today — on a low-readiness day this is recovery work, and it is worth doing.`.trim() };
      });
    }
    if (color === "YELLOW" && (sec.type === "strength" || sec.type === "power")) {
      exs = exs.map((e) => ({
        ...e, rir: (e.rir || 0) + 1,
        perSetTargets: e.perSetTargets ? e.perSetTargets.map((t) => ({ ...t, rir: t.rir + 1, pct1rm: t.pct1rm ? Math.max(50, t.pct1rm - 5) : t.pct1rm })) : e.perSetTargets,
        pct1rmFlat: e.pct1rmFlat ? Math.max(50, e.pct1rmFlat - 5) : e.pct1rmFlat,
      }));
    }
    // Durability is left alone on yellow. It is minutes of work and it is the
    // reason the athlete stays on the mat; arm and core work is the filler.
    if (color === "YELLOW" && sec.type === "arms_core") {
      exs = exs.map((e) => ({ ...e, sets: Math.max(1, Math.round((e.sets || 2) * 0.7)) }));
    }
    if (color === "YELLOW" && sec.type === "conditioning") {
      exs = exs.map((e) => ({ ...e, cues: `${e.cues || ""} Yellow readiness: back today's effort off slightly from what the protocol normally asks for — moderate rather than maximal, whichever modality this is.`.trim() }));
    }
    if (bjjHard && sec.type === "conditioning") {
      exs = exs.map((e) => ({ ...e, sets: 1, reps: "optional — trim or skip, hard grappling already supplied today's conditioning stimulus" }));
    }
    return { ...sec, exercises: exs, skipped };
  });

  if (color === "RED") notes.push("You flagged a rough day, so today is half the sets, no singles, and no hard conditioning. Your warm-up and your neck and adductor work stay in — they cost almost nothing and they are what keeps you training.");
  else if (color === "YELLOW") notes.push("A notch back today: 5% lighter, one extra rep in reserve, less arm and core filler. Everything that protects you stays in.");
  if (bjjHard) notes.push("Hard grappling flagged: conditioning trimmed since training already supplied that stimulus today.");

  return { sections: adjusted, adjustedNote: notes.length ? notes.join(" ") : null };
}

/* ============================== SEED PROGRAM: CONJUGATE BRAZILIAN JIU-JITSU / WRESTLING ============================== */

const VIDEO_LIBRARY = {
  "barbell romanian deadlift": "https://www.youtube.com/shorts/5rIqP63yWFg",
  "incline bench press": "https://www.youtube.com/watch?v=lJ2o89kcnxY",
  "incline close grip bench press": "https://www.youtube.com/shorts/0_Xy7U9YZ7A",
  "toes to bar": "https://www.youtube.com/watch?v=dupHeq21Jm8",
  "briefcase carry": "https://www.youtube.com/shorts/iTjwbts8Djw",
  "moderate farmer carry": "https://www.youtube.com/watch?v=8OtwXwrJizk",
  "banded face pulls": "https://www.youtube.com/watch?v=hbo-nSIEmXo",
  "rice grips": "https://www.youtube.com/shorts/VLI3fRk__bc",
  "bench press": "https://www.youtube.com/shorts/hWbUlkb5Ms4",
  "split stance trap bar deadlift": "https://www.youtube.com/shorts/7mB2Ct6WRTU",
  "weighted neck bridge": "https://www.youtube.com/shorts/_M6zOSJrZNo",
  "dumbbell glute bridge floor press": "https://www.youtube.com/shorts/UABeQA4iIGM",
  "single leg glute bridge dumbbell floor press": "https://www.youtube.com/shorts/7ABRskqokUE",
  "single leg glute bridge": "https://www.youtube.com/shorts/ZC9NpfMU5AI",
  "bent over single arm dumbbell row": "https://www.youtube.com/shorts/rO4Q7nW0ygo",
  "pallof press": "https://www.youtube.com/shorts/5aZ0IhJS8O8",
  "world's greatest stretch": "https://www.youtube.com/watch?v=-CiWQ2IvY34",
  "leg swings": "https://www.youtube.com/shorts/wF10oYsLUw0",
  "hip circles": "https://www.youtube.com/shorts/P8P1E_IosqA",
  "thoracic rotations (quadruped)": "https://www.youtube.com/shorts/Lfn-Fv_xmmQ",
  "cable pull-apart": "https://www.youtube.com/shorts/Ol-QWheu9Yg",
  "multi-planar lunge matrix": "https://www.youtube.com/shorts/6hiVTg5rD7Y",
  "cable diagonal chop": "https://www.youtube.com/shorts/8OZImYISmSg",
  "glute bridge": "https://www.youtube.com/shorts/mSuDY5J0Fwo",
  "supine hamstring single leg glute bridge": "https://www.youtube.com/watch?v=sNIePOcTVTs",
  "bodyweight lateral squat walk": "https://www.youtube.com/shorts/vIEmbHOSY2U",
  "dead bug": "https://www.youtube.com/shorts/DqLL45uk2Tk",
  "lateral shuffle": "https://www.youtube.com/shorts/nqLsCj7pgbw",
  "tibialis raise": "https://www.youtube.com/shorts/HliiXSj2aIE",
  "scap push-up": "https://www.youtube.com/shorts/emB58J1SyXA",
  "dip station support hold": "https://www.youtube.com/watch?v=_vPttkLHZMw",
  "cable external rotation": "https://www.youtube.com/watch?v=ci727TUmr80",
  "close-grip bench press": "https://www.youtube.com/watch?v=FiQUzPtS90E",
  "weighted pull-up": "https://www.youtube.com/shorts/pYhflsmHAy4",
  "single-arm dumbbell row": "https://www.youtube.com/shorts/i9BJwVCK5VQ",
  "single arm dumbbell row": "https://www.youtube.com/shorts/i9BJwVCK5VQ",
  "cable face pull": "https://www.youtube.com/shorts/lbt7obncwVs",
  "pull-up bar dead hang": "https://www.youtube.com/shorts/XPcT3capkyk",
  "paused bottom-position bench press hold": "https://www.youtube.com/shorts/YHtd4XKsd7I",
  "barbell wrist curl and reverse wrist curl": "https://www.youtube.com/shorts/xENVg7RX_O8",
  "neck curl and neck extension": "https://www.youtube.com/shorts/i7Fn4aimzOM",
  "standing barbell overhead press": "https://www.youtube.com/watch?v=cGnhixvC8uA",
  "upright shoulder overhead press": "https://www.youtube.com/watch?v=cGnhixvC8uA",
  "half-kneeling landmine press hold": "https://www.youtube.com/watch?v=fx6lSVNvu-4",
  "trap bar high pull": "https://www.youtube.com/watch?v=_reAqpSF-m0",
  "trap bar deadlift": "https://www.youtube.com/shorts/kpyCkyVIxjI",
  "heavy dumbbell swing": "https://www.youtube.com/watch?v=QEMGYrebtxE",
  "back squat": "https://www.youtube.com/shorts/PPmvh7gBTi0",
  "front squat": "https://www.youtube.com/shorts/N4WGYDGu6bI",
  "zercher squat": "https://www.youtube.com/watch?v=eDf49a4Vx5k",
  "bulgarian split squat": "https://www.youtube.com/watch?v=Fmjj7wFJWRE",
  "front-foot-elevated split squat": "https://www.youtube.com/shorts/w2oxzOGPgfU",
  "ab roll out": "https://www.youtube.com/shorts/kISuoI7QCYk",
  "banded single leg single arm row": "https://www.youtube.com/shorts/2ZBEy0oh_-Y",
  "banded terminal knee extension": "https://www.youtube.com/shorts/CU7Fn11YMTw",
  "cable lat row": "https://www.youtube.com/shorts/UyI7Sc7ZVdU",
  "medicine ball abdominal extension": "https://www.youtube.com/watch?v=bld2VhFtH9I",
  "4-way isometric neck holds": "https://www.youtube.com/watch?v=CtbZUhBxNOM",
  "prone bench y, t, w's": "https://www.youtube.com/shorts/dCPuXZ5xH8k",
  "supine y, t, w": "https://www.youtube.com/watch?v=uuU5InOhwLw",
  "pull-up hold": "https://www.youtube.com/shorts/E9tgI5ZMQAE",
  "rice bucket grip drills": "https://www.youtube.com/shorts/VLI3fRk__bc",
  "suitcase carry": "https://www.youtube.com/shorts/iTjwbts8Djw",
  "valslide hamstring curls": "https://www.youtube.com/shorts/vWg6217Wsqc",
  "weighted plank": "https://www.youtube.com/shorts/Hc4RgCygkqk",
  "weighted push-ups": "https://www.youtube.com/shorts/z4oz6W1X10w",
  "weighted scarecrows": "https://www.youtube.com/watch?v=MEcO3V75fno",
  "landmine punch press": "https://www.youtube.com/shorts/BVblhbECAtg",
  "offset single arm dumbbell press": "https://www.youtube.com/shorts/kfrAo42YG1I",
  "renegade row": "https://www.youtube.com/shorts/oZkZC33zm-A",
  "seal row": "https://www.youtube.com/shorts/YSW2SKoiN1s",
  "side plank": "https://www.youtube.com/shorts/1Ng5zRnf7tU",
  "scapular push-up": "https://www.youtube.com/shorts/emB58J1SyXA",
  "glute hip thrust with medicine ball": "https://www.youtube.com/shorts/WS_vrW_AOaA",
  "heavy pallof press hold": "https://www.youtube.com/shorts/bnpqMNtaBIA",
  "high plank kettlebell pull-through": "https://www.youtube.com/shorts/xdPjToOJM1o",
  "incline chest-supported dumbbell row": "https://www.youtube.com/shorts/b_QO3PedVR8",
  "paused bottom-position incline press hold": "https://www.youtube.com/shorts/JclaYaFPX3w",
  "single arm kettlebell hold": "https://www.youtube.com/shorts/L-zTmBumZmI",
  "trap bar static hold": "https://www.youtube.com/watch?v=OkxnHHkJ8eQ",
  "arm swings forward & backward": "https://www.youtube.com/shorts/vaPFiFV9OtY",
  "banded lateral step": "https://www.youtube.com/watch?v=RW4ZvH22l48",
  "banded sumo steps": "https://www.youtube.com/shorts/MeCwofJYAzo",
  "box jumps": "https://www.youtube.com/shorts/bCNpPn5b3Y4",
  "bulldog circuit": "https://www.youtube.com/watch?v=JuQcNsyMolY",
  "child's pose with lateral reach": "https://www.youtube.com/watch?v=5uQ2Xuc3LiE",
  "couch stretch": "https://www.youtube.com/shorts/TIJu5aWPke0",
  "deep squat hold": "https://www.youtube.com/shorts/LPa3LKlQ7eU",
  "figure-4 / pigeon stretch": "https://www.youtube.com/shorts/pjmR5Kacu1w",
  "heel walks": "https://www.youtube.com/shorts/h4V7X5ZDnU0",
  "heel to toe walks": "https://www.youtube.com/shorts/d1fpuaq6RVg",
  "open book thoracic rotation": "https://www.youtube.com/shorts/SKapoHxQxuk",
  "overhead lat and shoulder stretch": "https://www.youtube.com/shorts/_q_Y5jElgrU",
  "straddle hamstring and adductor hold": "https://www.youtube.com/shorts/oH53L8OMTCk",
  "toe walks": "https://www.youtube.com/watch?v=3d2S7a3D9YY",
  "barbell good morning": "https://www.youtube.com/shorts/5DonmXxz6Qk",
  "bent over barbell row": "https://www.youtube.com/watch?v=bm0_q9bR_HA",
  "box squat": "https://www.youtube.com/shorts/6_xQf5A3WmE",
  "incline barbell press": "https://www.youtube.com/shorts/98HWfiRonkE",
  "single leg romanian deadlift": "https://www.youtube.com/shorts/R_fJ6H3FlVw",
  "split stance romanian deadlift": "https://www.youtube.com/shorts/5fUAdAXu3PI",
  "spoto press": "https://www.youtube.com/shorts/8Fq0oo-PrcQ",
  "weighted dip": "https://www.youtube.com/shorts/ZDOrGNvRdM0",
  "wide-grip bench press": "https://www.youtube.com/shorts/d2QSpIHUPZ4",
  "anderson squat": "https://www.youtube.com/shorts/SNssQJuEzX8",
  "band pull-apart": "https://www.youtube.com/shorts/SuvO4TBwSu4",
  "banded pull-apart": "https://www.youtube.com/shorts/SuvO4TBwSu4",
  "banded clamshell": "https://www.youtube.com/shorts/Y1vuVuP754M",
  "90/90 hip switch flow": "https://www.youtube.com/watch?v=m51AZSXMvEA",
  "single-leg balance reach": "https://www.youtube.com/shorts/X6isWRdfCE4",
  "pogo hops": "https://www.youtube.com/shorts/L_khHgMz9uU",
  "copenhagen plank": "https://www.youtube.com/watch?v=aDsaGBnvDQo",
  "five-ten-five pro agility shuttle": "https://www.youtube.com/watch?v=XSc-g5o2qhY",
  "hanging leg raise": "https://www.youtube.com/shorts/Gtv_pe0E42U",
  "heavy farmer carry": "https://www.youtube.com/watch?v=8OtwXwrJizk",
  "heavy isometric wall sit": "https://www.youtube.com/shorts/4ZS2W4SlnHU",
  "heavy landmine anti-rotation hold": "https://www.youtube.com/watch?v=c6_FnMLPsys",
  "landmine rotational press": "https://www.youtube.com/watch?v=ONDeomDVlbE",
  "speed bench press — dynamic effort": "https://www.youtube.com/shorts/32SZmZgc1KI",
  "trap bar jump squat — dynamic effort": "https://www.youtube.com/shorts/2TfyFQRndNk",
  "hip abduction machine": "https://www.youtube.com/shorts/S_FGYHNHJ_c",
  "hip adduction machine": "https://www.youtube.com/shorts/BmMmt-c9aNM",
  "plate lifts": "https://www.youtube.com/shorts/zF9ZkUYp7Rk",
  "pendlay row": "https://www.youtube.com/shorts/0PSfteHhUtg",
  "cable triceps pushdown": "https://www.youtube.com/shorts/Fmiob5b0EAk",
  "acceleration sprint": "https://www.youtube.com/shorts/7_-gaumnzWw",
  "neck bridge": "https://www.youtube.com/shorts/hxMolBuXmY0",
};
function lookupVideo(name) {
  const key = (name || "").toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (VIDEO_LIBRARY[key]) return VIDEO_LIBRARY[key];
  // try matching by whether the library key is contained in (or contains) the exercise name,
  // so things like "Split Stance Trap Bar Deadlift" still pick up the "Trap Bar Deadlift" video
  const found = Object.keys(VIDEO_LIBRARY).find((k) => key.includes(k) || k.includes(key));
  return found ? VIDEO_LIBRARY[found] : "";
}
// Exercises whose logged number isn't a rep count — held for TIME or covering DISTANCE rather
// than counted in reps. Historical logs and Personal Records only ever store an exercise's name
// (the number a client typed carries no unit with it), so these two lists cover exercises by
// name for that case.
const TIME_BASED_EXERCISES = new Set([
  "pull-up bar dead hang",
  "copenhagen plank",
  "heavy isometric wall sit",
  "dip station support hold",
  "paused bottom-position bench press hold",
  "paused bottom-position incline press hold",
  "heavy landmine anti-rotation hold",
  "half-kneeling landmine press hold",
  "rice bucket grip drills",
  "4-way isometric neck holds",
  "briefcase carry",
  "heavy pallof press hold",
  "pull-up hold",
  "side plank",
  "single arm kettlebell hold",
  "trap bar static hold",
  "weighted plank",
]);
const DISTANCE_BASED_EXERCISES = new Set([
  "heavy farmer carry",
  "moderate farmer carry",
  "suitcase carry",
  "lateral shuffle",
]);
// Exercises prescribed and logged in MINUTES rather than seconds — continuous
// aerobic/conditioning pieces (Zone 2 base work, power intervals, deload-phase
// easy aerobic and maintenance pieces). Kept separate from TIME_BASED_EXERCISES
// so the set-logging grid can label these "Minutes" instead of "Seconds".
const MINUTE_BASED_EXERCISES = new Set([
  "assault bike or incline treadmill walk — aerobic base",
  "assault bike or treadmill — aerobic maintenance",
  "assault bike or treadmill — easy aerobic",
  "assault bike or treadmill — vo2max 4x4 intervals",
  "assault bike or treadmill — sustained effort",
  "assault bike, treadmill, or outdoor — aerobic base",
  "assault bike or treadmill — aerobic power intervals",
  "assault bike or treadmill — repeated-effort tempo",
]);
// Exercises with no external load at all — sprints, shuttles, bodyweight conditioning, band
// work, and isometric neck holds done without a plate. The Weight input is hidden for these
// rather than shown unused, since a client typing a pounds figure into a shuttle run just adds
// noise. Reviewed and confirmed by Kyle on 2026-09-20.
const NO_WEIGHT_EXERCISES = new Set([
  "4-way isometric neck holds",
  "ab roll out",
  "acceleration sprint",
  "assault bike or incline treadmill walk — aerobic base",
  "assault bike or treadmill — aerobic maintenance",
  "assault bike or treadmill — easy aerobic",
  "assault bike or treadmill — sustained effort",
  "assault bike or treadmill — vo2max 4x4 intervals",
  "assault bike, treadmill, or outdoor — aerobic base",
  "assault bike or treadmill — aerobic power intervals",
  "assault bike or treadmill — repeated-effort tempo",
  "band pull-apart",
  "banded clamshell",
  "banded face pulls",
  "banded lat row",
  "banded single leg single arm row",
  "banded terminal knee extension",
  "copenhagen plank",
  "dip station support hold",
  "five-ten-five pro agility shuttle",
  "lateral shuffle",
  "neck bridge",
  "pogo hops",
  "rice bucket grip drills",
  "rice grips",
  "scapular push-up",
  "side plank",
  "single-leg balance reach",
  "supine hamstring single leg glute bridge",
  "toes to bar",
  "valslide hamstring curls",
]);
function normalizeExerciseKey(name) {
  return (name || "").toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
}
// The unit a client's logged number represents for a given exercise: "seconds", "meters", or
// "reps". Pass the exercise's actual prescribed reps text (repsText) whenever it's on hand — a
// live program target — since reading it directly also catches any future exercise whose target
// text says "meters"/"seconds"/"minutes" even before its name is added to the lists above.
// Historical logs and Personal Records only ever store the exercise's name, so those fall back
// to the name lookup.
function exerciseUnit(name, repsText) {
  if (repsText && /meter|yard/i.test(repsText)) return "meters";
  // A curated name match is the author's explicit intent and wins over parsing
  // the reps text — e.g. "Weighted Plank" is prescribed as "1 minute" but is
  // always logged in seconds for precision, while "Assault Bike... Aerobic Base"
  // isn't in either list, so it falls through to the reps-text check below and
  // correctly reads as minutes.
  const key = normalizeExerciseKey(name);
  if (TIME_BASED_EXERCISES.has(key)) return "seconds";
  if (MINUTE_BASED_EXERCISES.has(key)) return "minutes";
  if (DISTANCE_BASED_EXERCISES.has(key)) return "meters";
  if (repsText) {
    const t = String(repsText).toLowerCase();
    const hasMinute = /\bminutes?\b|\bmin\b/.test(t);
    const hasSecond = /\bseconds?\b|\bsec\b/.test(t);
    if (hasMinute && !hasSecond) return "minutes";
    if (hasSecond || /\bhold\b|\btime\b/.test(t)) return "seconds";
  }
  return "reps";
}
function exerciseUnitLabel(name, repsText) {
  const u = exerciseUnit(name, repsText);
  return u === "seconds" ? "Seconds" : u === "minutes" ? "Minutes" : u === "meters" ? "Meters" : "Reps";
}
function isTimedExercise(name) {
  return exerciseUnit(name) === "seconds";
}
// Whether an exercise takes an external load at all — false for sprints, shuttles, band work,
// and unweighted conditioning drills, so the logging grid can skip the Weight input for them.
function needsWeight(name) {
  return !NO_WEIGHT_EXERCISES.has(normalizeExerciseKey(name));
}
function ex(o) {
  const base = { id: uid(), sets: 3, reps: "8", load: "", rir: 2, rest: "90 seconds", tempo: "", cues: "", purpose: "", quality: "", videoUrl: "", perSetTargets: null, ...o };
  if (!base.videoUrl) base.videoUrl = lookupVideo(base.name);
  return base;
}
function meWorkingSets() {
  // Ramps from lighter warm-up triples down to a true heavy single, so no two sets are identical.
  // Percentages are standard estimates for the given rep and reps-in-reserve combination (a 3-rep set with
  // 4 reps in reserve is roughly a 7-rep-max load, which sits at about 70% of a true One-Rep Max, and so on).
  return [
    { reps: 3, rir: 4, note: "Warm-up", pct1rm: 70 },
    { reps: 3, rir: 2, note: "Build", pct1rm: 80 },
    { reps: 2, rir: 2, note: "Build", pct1rm: 85 },
    { reps: 2, rir: 1, note: "Heavy", pct1rm: 90 },
    { reps: 1, rir: 1, note: "Heavy", pct1rm: 95 },
    { reps: 1, rir: 0, note: "Top single", pct1rm: 100 },
  ];
}
function meRetestSets() {
  // This is Week 12 — the week right before a brand new block starts. The goal here is not
  // to test anything: it's to walk into the new block's Week 1 completely recovered so those
  // heavy top sets can actually be hit hard. Every set stays at 50 to 60 percent of your last
  // known One-Rep Max, with reps in reserve high enough that nothing here is remotely close to a grind.
  return [
    { reps: 3, rir: 6, note: "Light", pct1rm: 50 },
    { reps: 3, rir: 6, note: "Light", pct1rm: 55 },
    { reps: 2, rir: 5, note: "Light", pct1rm: 55 },
    { reps: 2, rir: 5, note: "Light", pct1rm: 60 },
    { reps: 1, rir: 5, note: "Light", pct1rm: 60 },
  ];
}
function meLowerBlock() {
  return ex({ name: meLowerPool[0].name, rotatingPool: "meLowerPool", sets: 6, reps: "working sets of 3 down to 1", perSetTargets: meWorkingSets(), load: "autoregulated", rir: 0, rest: "3 to 4 minutes", quality: "Max Effort",
    cues: "Work up in doubles and triples to a heavy top single or triple. This is a true max effort — stop when bar speed or technique breaks down, not at a preset percentage.\n\nNew to barbell training? If you have been lifting seriously for less than about six months, do not chase a true single yet. Work up to a heavy triple that still looks clean and stop there. The max effort method assumes you can read your own bar speed, and that is a skill that takes a while to build. You lose nothing by waiting — a heavy triple drives almost the same adaptation at a fraction of the risk." });
}
function meUpperBlock() {
  return ex({ name: meUpperPool[0].name, rotatingPool: "meUpperPool", sets: 6, reps: "working sets of 3 down to 1", perSetTargets: meWorkingSets(), load: "autoregulated", rir: 0, rest: "3 to 4 minutes", quality: "Max Effort",
    cues: "Work up in doubles and triples to a heavy top single or triple. Stop on any breakdown in bar speed or technique." });
}
function deSquat(pct1rm) {
  return ex({ name: "Trap Bar Jump Squat — Dynamic Effort", deWave: true, deJump: true, deMaxLabel: "trap bar deadlift One-Rep Max", sets: 8, reps: "3", load: "", rir: 4, rest: "90 seconds", quality: "Dynamic Effort", pct1rmFlat: pct1rm,
    cues: "This is a jump, so it stays light — the percentage is off your trap bar deadlift max, not your squat. Sit the hips back, explode into a jump, land soft through the whole foot and reset fully between reps. If you are not clearing the floor, or you are landing flat and loud, take weight off. Stop the set the moment jump height drops.",
    purpose: "Rate of force development — loaded triple extension directly transferable to shots, sprawls, and scrambles" });
}
function deBench(pct1rm) {
  return ex({ name: "Speed Bench Press — Dynamic Effort", deWave: true, deMaxLabel: "bench press One-Rep Max", sets: 8, reps: "3", load: "", rir: 4, rest: "60 seconds", quality: "Dynamic Effort", pct1rmFlat: pct1rm,
    cues: "Fast, controlled descent; maximal bar speed off the chest. Stop the set if speed visibly drops.", purpose: "Upper body rate of force development" });
}

const meLowerPool = [
  { name: "Box Squat (bench set to box height)", notes: "Sit back to the bench at parallel, pause, drive up. Rotated to avoid staleness.", videoUrl: "" },
  { name: "Front Squat", notes: "Upright torso, quad and trunk-bracing emphasis", videoUrl: "" },
  { name: "Anderson Squat (from pins)", notes: "Dead-stop squat starting from safety pins set just below parallel — builds strength without any stretch-reflex assistance, a genuine Westside staple", videoUrl: "" },
  { name: "Zercher Squat", notes: "Heavy anterior-loaded trunk bracing — carries over to grappling posture under load", videoUrl: "" },
  { name: "Trap Bar Deadlift", notes: "Neutral grip, lower technical demand heavy pull — the safest way to push a true top single on your own", videoUrl: "https://www.youtube.com/shorts/kpyCkyVIxjI" },
  { name: "Barbell Good Morning", notes: "Posterior chain and hip-hinge strength", videoUrl: "" },
];
const meUpperPool = [
  { name: "Close-Grip Bench Press", notes: "Triceps-dominant press — frame and pummel strength", videoUrl: "https://www.youtube.com/watch?v=FiQUzPtS90E" },
  { name: "Spoto Press", notes: "Pause one inch off the chest — strength off the chest without bounce", videoUrl: "" },
  { name: "Standing Barbell Overhead Press", notes: "Overhead strength, shoulder resilience", videoUrl: "https://www.youtube.com/watch?v=cGnhixvC8uA" },
  { name: "Weighted Dip (dip station)", notes: "Pressing strength — chest, shoulders, and triceps under a heavy vertical load", videoUrl: "" },
  { name: "Incline Barbell Press", notes: "Upper chest and shoulder press strength", videoUrl: "" },
  { name: "Wide-Grip Bench Press", notes: "Chest-dominant press variation", videoUrl: "" },
  { name: "Pendlay Row", notes: "Dead-stop barbell row from the floor every rep — a true heavy pulling variation, rotated in so the Max Effort Upper day occasionally builds pulling strength instead of always pressing", videoUrl: "https://www.youtube.com/shorts/0PSfteHhUtg" },
];
const wristPool = [
  { name: "Barbell Wrist Curl and Reverse Wrist Curl (Flexors and Extensors)", notes: "Direct forearm strength through both wrist flexion and extension — the flexor and extensor work back to back", reps: "12 per direction", videoUrl: "https://www.youtube.com/shorts/xENVg7RX_O8" },
  { name: "Rice Bucket Grip Drills", notes: "Dig, twist, and squeeze through a bucket of rice — forearm and wrist rotator conditioning that also toughens the hands", reps: "20 seconds each direction" },
];
const coreAntiPool = [
  { name: "Heavy Pallof Press Hold (each side)", reps: "15 to 20 seconds per side", notes: "Anti-rotation under real load — resisting a cable trying to rotate your trunk is a far closer match to what grapplers actually get exposed to live than a bicep curl ever was", cues: "Stand side-on to the cable, press the handle straight out from your chest and hold. Do not let your ribs or hips turn toward the machine. If your torso rotates, the weight is too heavy." },
  { name: "Suitcase Carry (each side)", reps: "30 meters per side", notes: "Anti-lateral-flexion under load — a heavy single-side carry forces the trunk to resist being pulled sideways the entire walk, directly protective for the exact forces guard retention and scrambles put on the spine" },
  { name: "Plate Lifts (Around the World)", reps: "10 each direction", notes: "Circling a weight plate around the torso at arm's length — loaded rotational core and shoulder-girdle control, a third anti-rotation variation alongside the Pallof Press and the carry", videoUrl: "https://www.youtube.com/shorts/zF9ZkUYp7Rk" },
];
const hipPool = [
  { name: "Copenhagen Plank (each side)", notes: "Adductor strength and durability — directly protective for guard retention and hip health", reps: "20 to 30 seconds per side", load: "bodyweight", videoUrl: "" },
  { name: "Hip Abduction Machine", notes: "Direct, loaded hip abductor and glute medius strength — the frontal-plane counterpart to the Copenhagen Plank, protective for single-leg stability, sprawling, and scrambling under fatigue", reps: "12 to 15", load: "moderate, machine stack", videoUrl: "https://www.youtube.com/shorts/S_FGYHNHJ_c" },
  { name: "Hip Adduction Machine", notes: "Direct, loaded adductor strength through a full range of motion — a machine-based complement to the Copenhagen Plank for groin and guard-retention durability", reps: "12 to 15", load: "moderate, machine stack", videoUrl: "https://www.youtube.com/shorts/BmMmt-c9aNM" },
];
const conditioningIntervalPool = [
  { rir: 7, name: "Assault Bike, Treadmill, or Outdoor — Aerobic Base (Zone 2)", notes: "Low and slow aerobic base training. This is the foundation everything else sits on top of — it builds mitochondrial density and the ability to recover between hard rounds on the mat, without adding any real fatigue going into your next lift or roll", reps: "30 to 40 minutes, continuous, easy pace", cues: "This should feel genuinely easy the entire time. The test is that you could hold a full conversation the whole way through without gasping — if you can only manage short sentences, you are going too fast for what this session trains. If you have a heart rate monitor, 130 to 150 beats per minute is the band; the talk test comes first and the number is just the check. This is meant to feel almost boring. That's correct.\n\nDo this one at the end of today's session, and then do one or two more like it across the rest of the week, off your lifting days — a brisk walk, an easy bike, a ruck with the dog. That is the part that actually builds the base, and it costs you no gym time and no recovery. One session a week will not do it; three easy ones will." },
  { rir: 1, name: "Assault Bike or Treadmill — Aerobic Power Intervals", notes: "Jamieson-style aerobic power work for raising the ceiling on your aerobic system — hard, honest intervals with equal-time recovery, shorter and more frequent than a straight endurance-sport VO2max protocol so the work-to-rest pattern mirrors a real exchange on the mat instead of one long grind", reps: "4 rounds of 2 to 3 minutes at 88 to 92 percent of your max heart rate, equal time easy between each round", cues: "Pace this off heart rate, not off how hard it feels. You are aiming to be at 88 to 92 percent of your max heart rate by about the ninety-second mark and to hold it there to the end of the round — hard and honest, but deliberately below what you could manage for a single round, because you have to do it four times. The check that you paced it right: the last round should be within about five percent of the first. If round four falls off a cliff, you went out too hard and turned an aerobic session into an anaerobic one. Take the full equal-time recovery between rounds, easy movement or complete rest." },
  { rir: 3, name: "Assault Bike or Treadmill — Repeated-Effort Tempo", notes: "Jamieson's extensive tempo method — short, hard-but-controlled efforts with incomplete recovery between them. This trains the specific gap most conditioning programs skip: the ability to fire off another hard scramble, shot, or transition without a full rest first, which is exactly what a real match actually demands round after round", reps: "12 rounds of 15 seconds hard effort, 45 seconds easy recovery between rounds", cues: "Hard means genuinely pushing — not an all-out sprint, but well past comfortable. Your breathing should climb during each 15-second effort and only partially settle during the 45 seconds of recovery, the same incomplete-recovery pattern as the gap between exchanges in a real round. If you feel fully recovered before the next effort starts, you're not pushing hard enough on the work." },
];

function meLowerDeloadBlock() {
  return ex({ name: meLowerPool[0].name, rotatingPool: "meLowerPool", sets: 4, reps: "light doubles and triples", load: "autoregulated, deliberately light", rir: 2,
    perSetTargets: [{ reps: 3, rir: 4, note: "Light" }, { reps: 3, rir: 3, note: "Light" }, { reps: 2, rir: 3, note: "Moderate" }, { reps: 2, rir: 2, note: "Moderate" }],
    rest: "2 to 3 minutes", quality: "Max Effort (Deload)",
    cues: "This is a deload — stay light on purpose. Build to a moderate double or triple, at least 2 reps in reserve on every set. No max attempts this week." });
}
function meUpperDeloadBlock() {
  return ex({ name: meUpperPool[0].name, rotatingPool: "meUpperPool", sets: 4, reps: "light doubles and triples", load: "autoregulated, deliberately light", rir: 2,
    perSetTargets: [{ reps: 3, rir: 4, note: "Light" }, { reps: 3, rir: 3, note: "Light" }, { reps: 2, rir: 3, note: "Moderate" }, { reps: 2, rir: 2, note: "Moderate" }],
    rest: "2 to 3 minutes", quality: "Max Effort (Deload)",
    cues: "This is a deload — stay light on purpose. Build to a moderate double or triple, at least 2 reps in reserve on every set. No max attempts this week." });
}
function deloadWeekPhase(weekNum, afterPhaseName) {
  return {
    id: uid(), name: `Deload Week (Week ${weekNum})`, weekStart: weekNum, weekEnd: weekNum,
    objective: `This week is deliberately light. The goal is simple: dissipate the fatigue built up over the last three weeks of ${afterPhaseName} so you walk into the next phase fresh, not to test anything or push a top set. Every 4th week in this program works this way.`,
    intensityNote: "No Dynamic Effort work this week at all. Max Effort days cap out at a moderate double or triple, at least 2 reps in reserve — never a true top single. Durability, arm and core, and agility work are trimmed or dropped entirely.",
    days: [
      { id: uid(), label: "1", name: "Max Effort Lower — Deload",
        intent: "Stay light on purpose. This is recovery, not a second max-effort day — leave real reps in the tank on every set.",
        sections: [
          { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
            ex({ name: "Single-Leg Balance Reach", sets: 1, reps: "5 reaches per leg", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Brief movement preparation only", quality: "Neuromuscular" }),
          ]},
          { id: uid(), type: "strength", name: "Main Strength", exercises: [ meLowerDeloadBlock() ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "4-Way Isometric Neck Holds", sets: 2, reps: "15 seconds each direction", load: "your own hand, or a folded towel against a wall, for resistance", rir: 5, rest: "45 seconds", purpose: "A deload is a deload from lifting — you are still rolling this week and still getting choked. This stays in at a maintenance dose.", quality: "Durability", videoUrl: "https://www.youtube.com/shorts/hxMolBuXmY0" }),
            ex({ name: "Moderate Farmer Carry", sets: 2, reps: "20 meters", load: "moderate", rir: 3, rest: "90 seconds", purpose: "Light grip and trunk maintenance, low fatigue cost", quality: "Grip/Trunk" }),
          ]},
        ]},
      { id: uid(), label: "2", name: "Max Effort Upper — Deload",
        intent: "Same idea upstairs — moderate weight, clean technique, plenty of reps left in reserve.",
        sections: [
          { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
            ex({ name: "Scapular Push-Up", sets: 1, reps: "10", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Brief shoulder preparation only", quality: "Neuromuscular" }),
          ]},
          { id: uid(), type: "strength", name: "Main Strength", exercises: [ meUpperDeloadBlock() ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "moderate time, well short of maximum", load: "bodyweight", rir: 3, rest: "60 seconds", purpose: "Light grip maintenance", quality: "Grip" , videoUrl: "https://www.youtube.com/shorts/XPcT3capkyk" }),
          ]},
        ]},
      { id: uid(), label: "3", name: "Full Body Recovery + Light Conditioning",
        intent: "No explosive lifting this week — just movement quality and an easy aerobic session. Let your body catch up.",
        sections: [
          { id: uid(), type: "agility", name: "Movement Quality", exercises: [
            ex({ name: "Multi-Planar Lunge Matrix", sets: 1, reps: "6 per direction", load: "bodyweight", rir: 3, rest: "45 seconds", purpose: "Easy full-body movement quality work, no explosive intent this week", quality: "Movement Quality" , videoUrl: "https://www.youtube.com/shorts/6hiVTg5rD7Y" }),
          ]},
          { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
            ex({ name: "Assault Bike or Treadmill — Easy Aerobic", sets: 1, reps: "10 to 12 minutes", load: "easy, conversational pace", rir: 7, rest: "none", purpose: "Active recovery — keep the aerobic system ticking over without adding fatigue", quality: "Conditioning" }),
          ]},
        ]},
    ],
  };
}

const conjugateProgram = {
  id: uid(),
  name: "Brazilian Jiu-Jitsu / Wrestling — Conjugate Twelve-Week Program",
  sport: "Brazilian Jiu-Jitsu / Wrestling",
  sessionsPerWeek: 3,
  coachNote:
    "I've spent years studying the training philosophies of Westside Barbell, Phil Daru, Joel Jamieson, Marv Marinovich, Doctor Edythe Heus, Dane Miller, Josh Settlage, and other coaches who train elite strength and combat athletes, and merged that study with my own coaching experience to build this all-in-one program for grapplers who want to be the strongest, most durable version of themselves on the mat. Technique decides a match between two athletes of different skill levels. But when two athletes are matched in technique, the stronger, more explosive, more durable athlete wins that exchange the overwhelming majority of the time. That gap — physical advantage between technically equal grapplers — is what this program exists to close.",
  methodology:
    "Structure: a condensed conjugate system (Max Effort and Dynamic Effort work) in the tradition of Westside Barbell, adapted for grappling the way coaches like Phil Daru and Josh Settlage (widely known as \"The Brazilian Jiu-Jitsu Strength Coach\") build combat-sport programs — Settlage's publicly stated approach keeps main lifts in an efficient 3-to-6 rep range to build strength without adding unnecessary size, pairs jump training with squat and deadlift work for explosiveness, and trains only as much volume as an athlete can actually recover from given their mat time, which is exactly the same governing principle behind this program's readiness-based auto-adjustment. Explosive strength work also draws on approaches associated with coaches like Dane Miller. Tissue preparation: warm-ups and select accessory work draw on fascia-focused, multi-planar movement principles associated with Marv Marinovich and Doctor Edythe Heus, and on Thomas Myers' Anatomy Trains myofascial-line concept, including loaded rotational work since grappling is a rotational sport. Neuromuscular and durability work: activation and durability blocks use reactive neuromuscular training principles associated with physical therapists Gray Cook and Michael Voight, and tendon-loading ideas associated with Cal Dietz's triphasic method, with dedicated coverage for the neck, ankles, wrists and elbows, shoulders, adductors, and knees. Conditioning: built around Joel Jamieson's actual combat-sport energy-system model rather than random high-intensity work — a genuine aerobic base as the foundation (heart rate held at 130 to 150 beats per minute, with the talk test as the primary gate), Jamieson's extensive tempo method for repeat-effort work capacity, and his real aerobic power interval protocol for raising VO2max (roughly 2 to 3 minute hard efforts at about 90 percent of max heart rate, equal time easy between rounds) — used sparingly rather than every week, since it's genuinely demanding and grappling itself already supplies plenty of high-intensity stimulus on its own. Equipment: every exercise in this program is built specifically around a squat rack, barbell and plates, a flat bench, dumbbells, a dip station, a cable machine, a trap bar, a landmine attachment, bands, an adjustable weighted vest, a pull-up bar, an assault bike, and a treadmill. There is no sled in this program — anywhere that kind of loaded, repeat-effort work would normally show up, it's replaced with heavy carries, loaded barbell or trap bar pulls, weighted-vest incline or backward treadmill walking, or assault bike intervals, which deliver a comparable training stimulus with the equipment actually on hand. Fatigue management: not every method appears in every session — Max Effort, Dynamic Effort, accessory work, plyometrics, conditioning, and postural or joint work rotate intelligently across the week and across phases rather than being crammed into one long workout, and volume is trimmed automatically as grappling training and life stress go up. All of this is Category D — established, well-known coaching practice rather than heavily research-tested systems in isolation — layered on general strength principles (progressive overload, autoregulation using reps in reserve) that carry stronger evidence (National Strength and Conditioning Association and American College of Sports Medicine position stands). Every session also adjusts automatically to your daily readiness check-in and to hard grappling training.",
  philosophy:
    "Brazilian Jiu-Jitsu and wrestling are the priority. This program exists to make you stronger, more explosive, and more durable without taking anything away from the mats. Max Effort work is genuinely hard — push it, that's where strength is earned. Everything else here (agility preparation, durability work, conditioning) is deliberately dosed, and it automatically trims itself when your readiness check-in reads Yellow or Red, or when you flag hard grappling training. When in doubt, the app already errs toward less strength and conditioning work, not more.",
  conjugate: { meLowerPool, meUpperPool, wristPool, coreAntiPool, conditioningIntervalPool, hipPool, meRotationWeeks: 2 },
  warmup: defaultWarmup(),
  mobility: defaultMobility(),

  phases: [
    {
      id: uid(), name: "Conjugate Base — Work Capacity", weekStart: 1, weekEnd: 3,
      objective: "This phase builds your ability to safely work up to a heavy top set, builds speed on the Dynamic Effort lifts, and improves movement quality in the agility and durability work. You'll log your bodyweight and complete a daily readiness check-in so any early signs of overtraining get caught quickly.",
      intensityNote: "On Max Effort days, work up to a true heavy top single or triple — the exact weight depends on how you feel that day, not a fixed number. On Dynamic Effort days, use 50 percent of your One-Rep Max for 8 sets, moving the weight as explosively as possible, with short rest between sets. The agility and durability work stays light on purpose — it's preparation for the main lifts, not a second workout.",
      dePercent: "50%",
      days: [
        { id: uid(), label: "1", name: "Max Effort Lower + Durability",
          intent: "True max effort on the main lift — build to an honest heavy top set, then stop. Everything else today is light preparation and tissue work, not a second workout.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Single-Leg Balance Reach", sets: 2, reps: "5 reaches per leg", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Reactive neuromuscular training for ankle and knee stability before loading the lift", quality: "Neuromuscular" }),
              ex({ name: "Lateral Shuffle", sets: 2, reps: "10 meters", load: "bodyweight", rir: 5, rest: "45 seconds", purpose: "Primes lateral hip stability and change-of-direction patterning relevant to scrambles", quality: "Agility" , videoUrl: "https://www.youtube.com/shorts/nqLsCj7pgbw" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meLowerBlock(),
              ex({ name: "Bulgarian Split Squat (rear foot elevated, dumbbells)", sets: 3, reps: "8 per leg", load: "moderate", rir: 2, rest: "90 seconds", purpose: "Unilateral knee-dominant strength — trains the single-leg loading pattern a sprawl or single-leg takedown defense actually uses, which bilateral squatting alone under-trains", quality: "Accessory" }),
              ex({ name: "Barbell Romanian Deadlift", sets: 3, reps: "8", load: "moderate — leave the last rep comfortably in the tank", rir: 3, rest: "90 seconds", tempo: "3/0/1", purpose: "Eccentric-biased posterior chain strength. This program prescribes maximal sprinting every week, and sprinting is where hamstrings tear — loading the hamstring long and slow under control is the best-evidenced protection against that, and it also balances the knee-dominant accessory work on this day.", cues: "Push the hips back, keep the bar close to the legs, and take a full three seconds to lower. Stop the rep the moment your lower back rounds — the range comes from the hips, not the spine. The lowering half is the point; don't rush it to get more reps.", quality: "Posterior Chain" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Heavy Farmer Carry", sets: 3, reps: "30 meters", load: "heavy dumbbells — if your grip is what gives out, that is the session working", rir: 3, rest: "2 minutes", purpose: "Grip and trunk bracing under load. If grip is the limiter, shorten the distance rather than adding weight — your grip failing is what stops you loading your spine with more than you can hold, and grip is the quality we are actually training here.", quality: "Grip/Trunk" }),
              ex({ name: hipPool[0].name, rotatingPool: "hipPool", sets: 2, reps: hipPool[0].reps, load: hipPool[0].load, rir: 3, rest: "60 seconds", purpose: hipPool[0].notes, quality: "Durability" }),
              ex({ name: "4-Way Isometric Neck Holds", sets: 3, reps: "20 seconds each direction", load: "your own hand, or a folded towel against a wall, for resistance", rir: 2, rest: "45 seconds", purpose: "Builds the neck before anything asks it to carry bodyweight — close to non-negotiable for anyone taking regular guillotine and choke pressure. The bridge comes in the next block, once this base is there.", cues: "Press your hand into your forehead, then each side, then the back of your head. Push hard enough that your head does not actually move — you are resisting, not nodding. Build the pressure over the first two seconds rather than jerking into it. If anything pinches, or any sensation travels down an arm, stop the set and note it in your check-in.", quality: "Durability", videoUrl: "https://www.youtube.com/shorts/hxMolBuXmY0", videoUrl2: "https://www.youtube.com/shorts/_uewQzQ3uYE" }),
              ex({ name: "Tibialis Raise", sets: 2, reps: "15", load: "bodyweight or a light plate", rir: 2, rest: "45 seconds", purpose: "Ankle and shin strength and durability — protects the ankle joint under guard-retention and scrambling loads", quality: "Durability" , videoUrl: "https://www.youtube.com/shorts/HliiXSj2aIE" }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper + Durability + Core",
          intent: "Same approach on the press — one hard top set, then shoulder-health, pulling, grip, and core work. Don't chase extra volume this early in the block.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Scapular Push-Up", sets: 2, reps: "10", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Activates the serratus anterior, primes shoulder blade control before heavy pressing", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meUpperBlock(),
              ex({ name: "Weighted Pull-Up", sets: 4, reps: "5", load: "added weight", rir: 2, rest: "2 to 3 minutes", purpose: "Pulling strength, grappling transfer", quality: "Accessory" , videoUrl: "https://www.youtube.com/shorts/pYhflsmHAy4" }),
              ex({ name: "Chest-Supported Dumbbell Row", sets: 3, reps: "10", load: "moderate — a weight you can hold at the top for a beat", rir: 2, rest: "90 seconds", purpose: "The horizontal pull this program was missing. Twelve weeks of pressing against one vertical pull leaves the shoulder unbalanced, and more to the point, pulling an opponent toward you is the most common upper-body action in grappling — collar drags, arm drags, two-on-one, breaking posture from guard. A face pull is prehab; this is the actual pattern.", cues: "Chest stays on the pad the whole set — no heaving off it. Pull to the bottom of your ribs, elbows past your body, and hold the top for a beat before lowering under control.", quality: "Accessory" }),
              ex({ name: "Cable Face Pull", sets: 3, reps: "15", load: "light to moderate", rir: 2, rest: "60 seconds", purpose: "Shoulder and scapular health", quality: "Prehab" , videoUrl: "https://www.youtube.com/shorts/lbt7obncwVs" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Towel Hang (two towels over the bar)", sets: 3, reps: "20 to 30 seconds", load: "bodyweight, one towel in each hand", rir: 3, rest: "90 seconds", purpose: "The gi-specific version of a dead hang, and the single biggest gap this program had. Gi grip is cloth, not steel — a four-finger hold on fabric under a sustained pull, which is a genuinely different demand from a crush grip on a smooth bar. This is the closest gym analogue to holding a sleeve against someone trying to strip it.", cues: "Two towels to start, one in each hand. Shoulders active, not hanging dead off the joint. Progress by adding time first, then by moving to a single towel held in both hands. Stop the set when your grip starts sliding rather than fighting the last second — you are training the hold, not the failure.", quality: "Grip", videoUrl: "https://www.youtube.com/shorts/R57zGkwfbo8" }),
              ex({ name: wristPool[0].name, rotatingPool: "wristPool", sets: 2, reps: wristPool[0].reps, load: "light", rir: 2, rest: "45 seconds", purpose: "Direct wrist flexor and extensor strength, alternated every 2 weeks with rice bucket grip work for tendon health and grip conditioning", quality: "Durability" }),
            ]},
            { id: uid(), type: "arms_core", name: "Core", exercises: [
              ex({ name: coreAntiPool[0].name, rotatingPool: "coreAntiPool", sets: 3, reps: "10 per side", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Anti-rotation and anti-lateral-flexion core strength — resisting rotation and side-bending under load, a closer match to what grapplers actually get exposed to live than isolated arm work, alternated every 2 weeks between the two variations", quality: "Core" }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Speed & Agility + Rotational Power + Conditioning",
          intent: "Speed and rhythm over grinding. The conditioning piece should feel easy — if it doesn't, you're going too hard for a base week. Training grappling four or more times this week? It's fine to split the rotational power work and the conditioning piece into two shorter sessions instead of stacking them together.",
          sections: [
            { id: uid(), type: "agility", name: "Speed, Agility & Change of Direction", exercises: [
              ex({ name: "Pogo Hops", sets: 2, reps: "10", load: "bodyweight", rir: 5, rest: "45 seconds", purpose: "Elastic ankle stiffness preparation before jump-loaded work", quality: "Neuromuscular" }),
              ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 4, reps: "3 build-up runs at about 60, 80 and 90 percent over the same distance, then 1 maximal effort sprint", load: "bodyweight, full recovery between efforts", rir: 1, rest: "90 seconds", purpose: "Alactic power and acceleration — short maximal efforts with full recovery, directly relevant to explosive takedown entries", quality: "Alactic Power", videoUrl: "https://www.youtube.com/shorts/7_-gaumnzWw" }),
              ex({ name: "Five-Ten-Five Pro Agility Shuttle", sets: 3, reps: "1 shuttle", load: "bodyweight", rir: 1, rest: "90 seconds", purpose: "Combines acceleration, deceleration, lateral movement, and change of direction in a single drill", quality: "Agility" }),
            ]},
            { id: uid(), type: "power", name: "Grappling Power", exercises: [
              ex({ name: "Landmine Rotational Press (each side)", sets: 3, reps: "6 per side", load: "light to moderate", rir: 1, rest: "90 seconds", purpose: "Loaded rotational power — hip-to-shoulder force transfer directly relevant to underhooks, throws, and scrambles", quality: "Rotational Power" }),
              ex({ name: "Heavy Landmine Anti-Rotation Hold (each side)", sets: 3, reps: "15 to 20 seconds per side, genuinely heavy", load: "heavy — this should be a real grinding effort, not light", rir: 1, rest: "90 seconds", purpose: "True max-effort loaded rotation — grappling is a rotational sport, and this is the missing piece next to the rotational power work above: real heavy resistance to rotation, not just moving fast against light load", quality: "Rotational Strength" }),
            ]},
            { id: uid(), type: "arms_core", name: "Arm Isolation", exercises: [
              ex({ name: "Cable Triceps Pushdown", sets: 3, reps: "12", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Direct arm isolation — triceps strength for framing and pushing off the mat", quality: "Arms", videoUrl: "https://www.youtube.com/shorts/Fmiob5b0EAk" }),
            ]},
            { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
              ex({ name: conditioningIntervalPool[0].name, rotatingPool: "conditioningIntervalPool", sets: 1, reps: conditioningIntervalPool[0].reps, load: "", rir: 7, rest: "none", purpose: "Rotates every 2 weeks through three modalities — easy aerobic base building, hard aerobic power intervals, and repeated-effort tempo work — so every energy system gets trained across the block", quality: "Conditioning" }),
            ]},
          ]},
      ],
    },
    deloadWeekPhase(4, "the base phase"),
    {
      id: uid(), name: "Conjugate Intensification", weekStart: 5, weekEnd: 7,
      objective: "Dynamic Effort intensity goes up, and durability and secondary exercise volume comes down, so your Max Effort top sets and your grappling training both recover fully.",
      intensityNote: "Max Effort days stay the same in structure — a true heavy top single or triple. Dynamic Effort moves up to 55 percent of your One-Rep Max.",
      dePercent: "55%",
      days: [
        { id: uid(), label: "1", name: "Max Effort Lower + Durability",
          intent: "This is where lower body strength gets built — push the top set, but keep the extras minimal. Grappling volume doesn't change, so recovery capacity is the limiting factor, not ambition.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Single-Leg Balance Reach", sets: 2, reps: "5 reaches per leg", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Reactive neuromuscular training for ankle and knee stability", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meLowerBlock(),
              ex({ name: "Barbell Romanian Deadlift", sets: 3, reps: "6", load: "heavier than the base block — still leave reps in the tank", rir: 3, rest: "90 seconds", tempo: "3/0/1", purpose: "Eccentric-biased posterior chain strength. This program prescribes maximal sprinting every week, and sprinting is where hamstrings tear — loading the hamstring long and slow under control is the best-evidenced protection against that, and it also balances the knee-dominant accessory work on this day.", cues: "Push the hips back, keep the bar close to the legs, and take a full three seconds to lower. Stop the rep the moment your lower back rounds — the range comes from the hips, not the spine. The lowering half is the point; don't rush it to get more reps.", quality: "Posterior Chain" }),
              ex({ name: "Front-Foot-Elevated Split Squat (dumbbells)", sets: 3, reps: "6 per leg", load: "moderate to heavy", rir: 2, rest: "90 seconds", purpose: "Unilateral knee-dominant strength — a different single-leg loading angle than the base phase to keep the movement fresh while still training the pattern a sprawl or single-leg takedown defense relies on", quality: "Accessory" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Heavy Farmer Carry", sets: 3, reps: "20 meters", load: "heavier", rir: 1, rest: "2 minutes", purpose: "Grip and trunk under near-maximal load", quality: "Grip/Trunk" }),
              ex({ name: hipPool[0].name, rotatingPool: "hipPool", sets: 2, reps: hipPool[0].reps, load: hipPool[0].load, rir: 3, rest: "60 seconds", purpose: hipPool[0].notes, quality: "Durability" }),
              ex({ name: "Neck Bridge (back only, hands assisting)", sets: 1, reps: "5, slow and controlled", load: "bodyweight, with both hands on the mat taking part of your weight", rir: 5, rest: "90 seconds", purpose: "Dynamic neck strength through a real range of motion — protective against the guillotine and choke pressure that isometric holds alone don't fully cover. Deliberately one short set: this is your first exposure to loading the neck dynamically and the only goal for these three weeks is that it feels easy.", quality: "Durability", videoUrl: "https://www.youtube.com/shorts/hxMolBuXmY0", videoUrl2: "https://www.youtube.com/shorts/_uewQzQ3uYE" }),
              ex({ name: "Tibialis Raise", sets: 2, reps: "15", load: "bodyweight or a light plate", rir: 2, rest: "45 seconds", purpose: "Ankle and shin durability", quality: "Durability" , videoUrl: "https://www.youtube.com/shorts/HliiXSj2aIE" }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper + Durability + Core",
          intent: "Same logic upstairs — hard top set, short accessory list. If grappling was rough this week, this is the day to trim first.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Scapular Push-Up", sets: 2, reps: "10", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Serratus activation before pressing", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meUpperBlock(),
              ex({ name: "Weighted Pull-Up", sets: 4, reps: "4", load: "added weight", rir: 2, rest: "2 to 3 minutes", purpose: "Pulling strength maintenance", quality: "Accessory" , videoUrl: "https://www.youtube.com/shorts/pYhflsmHAy4" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Chest-Supported Dumbbell Row", sets: 3, reps: "10", load: "moderate — a weight you can hold at the top for a beat", rir: 2, rest: "90 seconds", purpose: "The horizontal pull this program was missing. Twelve weeks of pressing against one vertical pull leaves the shoulder unbalanced, and more to the point, pulling an opponent toward you is the most common upper-body action in grappling — collar drags, arm drags, two-on-one, breaking posture from guard. A face pull is prehab; this is the actual pattern.", cues: "Chest stays on the pad the whole set — no heaving off it. Pull to the bottom of your ribs, elbows past your body, and hold the top for a beat before lowering under control.", quality: "Accessory" }),
              ex({ name: "Cable Face Pull", sets: 3, reps: "15", load: "light to moderate", rir: 2, rest: "60 seconds", tempo: "1/1/2", purpose: "Scapular retraction and posterior shoulder health. Pressing volume only climbs from here, so this is the counterweight that keeps the shoulder centred.", cues: "Rope to the bridge of your nose, elbows high, finish with your knuckles pointing back behind you. Hold the end position for a full second.", quality: "Prehab", videoUrl: "https://www.youtube.com/watch?v=hbo-nSIEmXo" }),
              ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "30 to 40 seconds, shoulders active", load: "bodyweight", rir: 3, rest: "90 seconds", purpose: "Support grip — kept low volume, grappling already fatigues grip", quality: "Grip" , videoUrl: "https://www.youtube.com/shorts/XPcT3capkyk" }),
              ex({ name: wristPool[0].name, rotatingPool: "wristPool", sets: 2, reps: wristPool[0].reps, load: "light", rir: 2, rest: "45 seconds", purpose: "Direct wrist flexor and extensor strength, alternated every 2 weeks with rice bucket grip work", quality: "Durability" }),
            ]},
            { id: uid(), type: "arms_core", name: "Core", exercises: [
              ex({ name: coreAntiPool[0].name, rotatingPool: "coreAntiPool", sets: 3, reps: "10 per side", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Anti-rotation and anti-lateral-flexion core strength, alternated every 2 weeks between the two variations", quality: "Core" }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Speed & Agility + Rotational Power + Conditioning",
          intent: "Tempo work, not a fight. Moderate-hard effort, never all-out — save your nervous system for the mats and for the next top set. Training grappling four or more times this week? Split the rotational power work and the conditioning piece across two shorter sessions instead of stacking them back to back.",
          sections: [
            { id: uid(), type: "agility", name: "Speed, Agility & Change of Direction", exercises: [
              ex({ name: "Pogo Hops", sets: 2, reps: "10", load: "bodyweight", rir: 5, rest: "45 seconds", purpose: "Elastic ankle stiffness preparation", quality: "Neuromuscular" }),
              ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 4, reps: "3 build-up runs at about 60, 80 and 90 percent over the same distance, then 1 maximal effort sprint", load: "bodyweight, full recovery between efforts", rir: 1, rest: "90 seconds", purpose: "Alactic power and acceleration", quality: "Alactic Power", videoUrl: "https://www.youtube.com/shorts/7_-gaumnzWw" }),
              ex({ name: "Five-Ten-Five Pro Agility Shuttle", sets: 3, reps: "1 shuttle", load: "bodyweight", rir: 1, rest: "90 seconds", purpose: "Acceleration, deceleration, lateral movement, and change of direction in one drill", quality: "Agility" }),
            ]},
            { id: uid(), type: "power", name: "Grappling Power", exercises: [
              ex({ name: "Landmine Rotational Press (each side)", sets: 3, reps: "6 per side", load: "light to moderate", rir: 1, rest: "90 seconds", purpose: "Loaded rotational power for throws and scrambles", quality: "Rotational Power" }),
              ex({ name: "Half-Kneeling Landmine Press Hold (each side)", sets: 3, reps: "15 to 20 seconds per side, genuinely heavy", load: "heavy — this should be a real grinding effort", rir: 1, rest: "90 seconds", purpose: "True max-effort loaded anti-rotation from a different base than the standing version in the base phase — real heavy resistance to rotation, not just moving fast against light load", quality: "Rotational Strength" , videoUrl: "https://www.youtube.com/watch?v=fx6lSVNvu-4" }),
            ]},
            { id: uid(), type: "arms_core", name: "Arm Isolation", exercises: [
              ex({ name: "Cable Triceps Pushdown", sets: 3, reps: "12", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Direct arm isolation", quality: "Arms", videoUrl: "https://www.youtube.com/shorts/Fmiob5b0EAk" }),
            ]},
            { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
              ex({ name: conditioningIntervalPool[0].name, rotatingPool: "conditioningIntervalPool", sets: 1, reps: conditioningIntervalPool[0].reps, load: "", rir: 7, rest: "none", purpose: "Rotates every 2 weeks through three modalities — easy aerobic base building, hard aerobic power intervals, and repeated-effort tempo work — so every energy system actually gets trained across the block instead of the same stimulus every week", quality: "Conditioning" }),
            ]},
          ]},
      ],
    },
    deloadWeekPhase(8, "the intensification phase"),
    {
      id: uid(), name: "Conjugate Peak / Compete Prep", weekStart: 9, weekEnd: 11,
      objective: "Extra exercises are kept to a bare minimum here. The priority is a heavy, fresh Max Effort top set and fast Dynamic Effort work, all while your grappling training volume stays high.",
      intensityNote: "Dynamic Effort moves up to 60 to 65 percent of your One-Rep Max. No new exercises are introduced this late in the program.",
      dePercent: "60 to 65%",
      days: [
        { id: uid(), label: "1", name: "Max Effort Lower",
          intent: "One hard, clean top set. No lingering — get in, get strong, get out. Freshness for grappling outranks extra sets right now.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Single-Leg Balance Reach", sets: 1, reps: "5 reaches per leg", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Brief preparation only — freshness is the priority", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [ meLowerBlock() ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Heavy Farmer Carry", sets: 2, reps: "20 meters", load: "heavy", rir: 1, rest: "90 seconds", purpose: "Grip and trunk maintenance, low volume for freshness", quality: "Grip/Trunk" }),
              ex({ name: "Neck Bridge (back only, hands assisting)", sets: 1, reps: "5, slow and controlled", load: "bodyweight, hands assisting as needed", rir: 5, rest: "60 seconds", purpose: "Brief neck maintenance this close to competition — kept to one set on purpose, since freshness outranks adding volume this late in the block", quality: "Durability", videoUrl: "https://www.youtube.com/shorts/hxMolBuXmY0", videoUrl2: "https://www.youtube.com/shorts/_uewQzQ3uYE" }),
              ex({ name: "Hanging Leg Raise", sets: 2, reps: "10", load: "bodyweight", rir: 2, rest: "60 seconds", purpose: "Trunk flexion strength, kept brief to protect freshness", quality: "Trunk" }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper",
          intent: "Same — hard top set, minimal accessory. This late in the block, more volume doesn't make you stronger, it just makes you tired.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Scapular Push-Up", sets: 1, reps: "10", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Brief shoulder preparation only", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [ meUpperBlock() ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Cable Face Pull", sets: 2, reps: "15", load: "light to moderate", rir: 2, rest: "60 seconds", tempo: "1/1/2", purpose: "Scapular retraction and posterior shoulder health. Pressing volume only climbs from here, so this is the counterweight that keeps the shoulder centred.", cues: "Rope to the bridge of your nose, elbows high, finish with your knuckles pointing back behind you. Hold the end position for a full second.", quality: "Prehab", videoUrl: "https://www.youtube.com/watch?v=hbo-nSIEmXo" }),
              ex({ name: "Chest-Supported Dumbbell Row", sets: 2, reps: "10", load: "moderate", rir: 3, rest: "90 seconds", purpose: "Horizontal pulling, kept through the peak block at a reduced dose. Pressing volume does not drop here and neither should the thing balancing it — and this is the pattern you actually use to break posture and drag an arm.", cues: "Chest on the pad, pull to the bottom of your ribs, hold for a beat.", quality: "Pull" }),
              ex({ name: "Weighted Pull-Up", sets: 3, reps: "5", load: "moderate — speed matters more than load this close to competing", rir: 3, rest: "2 minutes", purpose: "The week's only loaded vertical pulling, moved here off Day 3 so it survives if Day 3 gets cut. Pressing volume stays high right through the peak, and dropping pulling entirely leaves the shoulder working against an imbalance in the weeks it can least afford one.", quality: "Pull" }),
              ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "30 to 40 seconds, shoulders active", load: "bodyweight", rir: 3, rest: "90 seconds", purpose: "Grip maintenance, minimal volume", quality: "Grip" , videoUrl: "https://www.youtube.com/shorts/XPcT3capkyk" }),
              ex({ name: wristPool[0].name, rotatingPool: "wristPool", sets: 1, reps: wristPool[0].reps, load: "light", rir: 2, rest: "45 seconds", purpose: "Brief wrist flexor and extensor maintenance, kept low to protect freshness this close to peak weeks", quality: "Durability" }),
              ex({ name: "Neck Curl and Neck Extension (light plate or manual resistance)", sets: 1, reps: "8 per direction", load: "light plate or your own hand for resistance", rir: 2, rest: "45 seconds", purpose: "Brief neck maintenance, kept low to protect freshness this close to peak weeks", quality: "Durability" , videoUrl: "https://www.youtube.com/shorts/i7Fn4aimzOM" }),
              ex({ name: "Pallof Press (Anti-Rotation)", sets: 2, reps: "10 per side", load: "light cable", rir: 2, rest: "60 seconds", purpose: "Anti-rotation trunk strength, kept brief to protect freshness", quality: "Core" }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Speed, Durability & Conditioning",
          intent: "Keep it snappy and short. This is the easiest day to cut entirely if grappling is heavy this week. If you're training grappling four or more times a week, splitting the Dynamic Effort lift and the conditioning piece across two days works just as well as cutting either one.",
          sections: [
            { id: uid(), type: "agility", name: "Speed & Agility", exercises: [
              ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 3, reps: "3 build-up runs at about 60, 80 and 90 percent over the same distance, then 1 maximal effort sprint", load: "bodyweight, full recovery", rir: 1, rest: "90 seconds", purpose: "Alactic power maintenance", quality: "Alactic Power", videoUrl: "https://www.youtube.com/shorts/7_-gaumnzWw" }),
            ]},
            // Speed bench already runs on Day 1 of this week. A second eight-set
            // block of it in a taper block is volume for its own sake, and the
            // heavy dumbbell swing that sat here was a brand-new ballistic hinge
            // in a phase whose own note says no new exercises this late.
            { id: uid(), type: "power", name: "Grappling Power", exercises: [
              ex({ name: "Landmine Rotational Press (each side)", sets: 3, reps: "4 per side", load: "light to moderate", rir: 4, rest: "75 seconds", purpose: "Rotational power, kept short. Already a staple of the earlier blocks, so nothing new is being learned in the week before competing.", cues: "Drive from the back foot through the hip and finish with the shoulder — the arm is the last thing that moves. Every rep the same speed; stop the set the moment it slows.", quality: "Rotational Power" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Copenhagen Plank (each side)", sets: 2, reps: "20 to 25 seconds per side", load: "bodyweight", rir: 3, rest: "45 seconds", purpose: "Adductor strength and durability. Adductor strain is one of the most common injuries in grappling and the peak block is when mat intensity is highest — this is exactly the wrong time to stop training it.", quality: "Durability" }),
            ]},
            { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
              ex({ name: "Assault Bike or Treadmill — Aerobic Power Intervals", sets: 1, reps: "4 rounds of 2 to 3 minutes at 88 to 92 percent of your max heart rate, equal time easy between each round", load: "hard but repeatable — you have to do it four times", rir: 2, rest: "none", purpose: "The highest-value conditioning in the program, in the block that most needs it. You maintain an aerobic quality by cutting volume and holding intensity, not by cutting both — eight easy minutes maintains nothing. This is also the closest thing in the program to what a hard round actually demands.", cues: "Shorter than the base-phase sessions but not easier — that is the point. You hold onto an aerobic quality by cutting volume and keeping intensity, not by cutting both. Pace it off heart rate rather than off how hard it feels. Aim to be at 88 to 92 percent by about the ninety-second mark and hold it to the end of the round. The check that you paced it right: the last round should be within about five percent of the first. If round four falls off a cliff, you went out too hard and turned an aerobic session into an anaerobic one. Take the full equal-time recovery between rounds. No heart rate monitor? Three or four words at a time, not a sentence, and you are at that point by ninety seconds. If you are competing this week, skip this session entirely: nothing you do in here five days out makes you fitter, and plenty makes you slower.", quality: "Conditioning" }),
            ]},
          ]},
      ],
    },
    {
      id: uid(), name: "Deload Week", weekStart: 12, weekEnd: 12,
      objective: "This is a full, genuine deload — not a retest. Every Max Effort set stays at 50 to 60 percent of your last known One-Rep Max, well short of anything hard, so you walk into the next twelve-week block's Week 1 completely recovered and ready to actually push a new heavy top single there instead of here.",
      intensityNote: "No Dynamic Effort work this week. Every other exercise is done at low volume too. Nothing this week should feel like a grind — if a set feels harder than it should at 50 to 60 percent, that's useful information for your readiness check-in, not a reason to push through it.",
      days: [
        { id: uid(), label: "1", name: "Max Effort Lower — Deload",
          intent: "Stay light on purpose — every set here is 50 to 60 percent of your last known max. This is recovery, not a test.",
          sections: [
            { id: uid(), type: "strength", name: "Main Strength — Deload", exercises: [
              ex({ ...meLowerBlock(), sets: 5, rir: 5, quality: "Max Effort (Deload)", reps: "five light sets, building doubles and triples", perSetTargets: meRetestSets(), cues: "Every set stays at 50 to 60 percent of your last known One-Rep Max — this is deliberately light, not a build-up to anything heavy." }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper — Deload",
          intent: "Same approach — stay light on purpose, no ego reps.",
          sections: [
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "4-Way Isometric Neck Holds", sets: 2, reps: "15 seconds each direction", load: "your own hand, or a folded towel against a wall, for resistance", rir: 5, rest: "45 seconds", purpose: "A deload is a deload from lifting — you are still rolling this week and still getting choked. This stays in at a maintenance dose.", quality: "Durability", videoUrl: "https://www.youtube.com/shorts/hxMolBuXmY0" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength — Deload", exercises: [
              ex({ ...meUpperBlock(), sets: 5, rir: 5, quality: "Max Effort (Deload)", reps: "five light sets, building doubles and triples", perSetTargets: meRetestSets(), cues: "Every set stays at 50 to 60 percent of your last known One-Rep Max. No max attempts this week." }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Recovery & Easy Conditioning",
          intent: "Light and easy, full stop. The only goal this week is walking into the next block's Week 1 completely recovered.",
          sections: [
            { id: uid(), type: "conditioning", name: "Aerobic Base — Deload", exercises: [
              ex({ name: "Assault Bike or Incline Treadmill Walk — Aerobic Base (Zone 2)", sets: 1, reps: "12 to 15 minutes", load: "heart rate held at 130 to 150 beats per minute — easy, conversational pace", rir: 7, rest: "none", purpose: "Easy aerobic movement to stay loose without adding any real fatigue heading into next week's fresh start", quality: "Conditioning" }),
            ]},
          ]},
      ],
    },
  ],
};

function rigoWarmup() {
  return [
    { id: uid(), block: "Movement Prep", duration: "8 to 10 minutes", items: [
      { id: uid(), name: "Heel to Toe Walks", detail: "10 meters", videoUrl: "" },
      { id: uid(), name: "Heel Walks", detail: "20 meters", videoUrl: "" },
      { id: uid(), name: "Toe Walks", detail: "20 meters", videoUrl: "" },
      { id: uid(), name: "Banded Lateral Step", detail: "20 meters both ways", videoUrl: "" },
      { id: uid(), name: "Banded Sumo Steps", detail: "20 meters both ways", videoUrl: "" },
      { id: uid(), name: "Single Leg Glute Bridge", detail: "10 reps each side", videoUrl: "https://www.youtube.com/shorts/mSuDY5J0Fwo" },
      { id: uid(), name: "Bulldog Circuit", detail: "5 reps each way", videoUrl: "" },
      { id: uid(), name: "Box Jumps", detail: "5 reps", videoUrl: "" },
      { id: uid(), name: "Arm Swings Forward & Backward", detail: "30 reps each way", videoUrl: "" },
    ]},
  ];
}
// Builds one superset pair as two adjacent exercises sharing a numbered A/B label, RPE-driven (not %1RM),
// with tempo notation exactly as in the source program (eccentric/pause/concentric, X = explosive).
// Whether a percentage-of-1RM target means anything for this exercise. Bands,
// bodyweight drills, isometric holds, carries and neck work have no meaningful
// one-rep max, so showing a percentage for them is noise rather than guidance.
function takesPercentTarget(name, reps) {
  if (!isLoadableReps(reps)) return false;
  if (!needsWeight(name)) return false;
  return !/\b(hold|plank|bridge|carry|grip|neck|pull-through|roll out)\b/i.test(name || "");
}
// Program B was built from a coach's own written sheet, which carried the
// technique knowledge in the coach's head rather than on the page. These are the
// lifts where that gap actually costs someone something, so the cue travels with
// the exercise instead of having to be repeated at every call site.
const rpeProgramCues = {
  "Back Squat": "Brace before you unrack, not after. Knees track over the middle of the foot the whole way down, and the hips and chest rise together out of the bottom — if the hips shoot up first, that set is done.",
  "Front Squat": "Elbows stay high and the bar stays on your shoulders, not your hands. The moment the elbows drop the bar rolls forward and your back takes it. Finish the set there.",
  "Bench Press": "Shoulder blades pulled back and down into the bench and kept there. Feet planted. Lower to the same spot on your chest every rep — control the bar down, do not let it drop onto you.",
  "Incline Bench Press": "Shoulder blades set back and down before you unrack. Keep the elbows from flaring straight out to the sides — about 45 degrees from your body keeps the shoulder safe.",
  "Zercher Squat": "Bar in the crease of your elbows, not out on your forearms. Use a towel or a pad for the first few sessions — what limits you here is the discomfort, not your legs. Elbows tucked in and high, chest up, and set the pins so you can dump it forward if you miss.",
  "Trap Bar Deadlift": "Hips somewhere between a squat and a deadlift, chest up, and push the floor away. The bar comes up in a straight line. Reset your brace on the floor between every rep rather than bouncing them.",
  "Split Stance Trap Bar Deadlift": "Front foot flat, back foot up on the toes taking maybe a fifth of the weight. Hips stay square — the back hip wants to open and that is the thing to stop.",
  "Trap Bar Static Hold (Quarter Squat)": "If you have a rack, set the pins at standing height and take the bar off them — that way you never have to pull the weight, you only hold it, which is the whole point of the exercise. No rack? Then use a weight you can comfortably stand up with, around ninety percent of your best pull, and deadlift it normally before you hold. Either way: stand tall, shoulders back, ribs down, shallow breaths, and set it down under control rather than dropping it. If your back rounds getting it up, the weight is wrong — this is a holding exercise, not a pulling one.",
  "Single Arm Kettlebell Hold": "Stand tall and do not let the weight pull you sideways — the whole point is the side that is not holding anything. Ribs down, glutes on.",
  "4-Way Isometric Neck Holds": "Press your hand into your forehead, then each side, then the back of your head. Push hard enough that your head does not actually move — you are resisting, not nodding. Build the pressure over the first two seconds rather than jerking into it. Anything that pinches or travels down an arm, stop there.",
  "Weighted Neck Bridge (front and back, light plate on chest, controlled)": "Only start this once the isometric holds from the earlier blocks feel easy. Begin with a five or ten pound plate on your chest and add nothing for the first two weeks. Move slowly through the middle of the range — do not roll all the way onto the crown of your head, and never turn your head while you are on it. Anything that pinches, tingles, or travels down an arm, stop the set and put the plate down.",
  "Neck Bridge (back only, hands assisting)": "Only start this once the 4-way isometric holds from the earlier block feel genuinely easy — if they don't, keep doing those instead and come back to this next block. Keep both hands on the mat taking part of your weight, and only reduce that once five reps feel like nothing. Move slowly through the middle of the range — do not roll all the way onto the crown of your head, and never turn your head while you are on it. Never bridge on a day your neck is already sore from training. Anything that pinches, tingles, or travels down an arm: stop the set, come off it, and tell your coach.",
  "Acceleration Sprint (10 to 15 yards)": "Never sprint cold. Do the three build-ups first — they are not a warm-up formality, they are how you avoid tearing a hamstring, and this program has you sprinting every week. Sixty percent, then eighty, then ninety, with about a minute between each, and only then go all out. In your first week keep even the \"maximal\" effort at around eighty-five percent while you find out how your body handles it. Accelerate rather than launching: build speed over the distance instead of exploding off the first step.",
  "Toes to Bar": "No swinging. If you cannot get your toes to the bar with straight legs, bring your knees to your chest instead and work toward the full version. Lower under control — that half is the part that counts.",
  "Copenhagen Plank (each side)": "Start with the short version: top leg bent, knee resting on the bench, bottom leg on the floor. Only straighten the top leg once you can hold the full time without shaking. Lift from the inner thigh and end the set when your hips start to sag, rather than fighting for the last few seconds.",
  "Renegade Row": "Feet wide for a stable base. The hips are what you are really training here — do not let them rotate as you row. If they twist, go lighter.",
  "Bulgarian Split Squat (rear foot elevated, dumbbells)": "Far enough forward that the front shin stays near vertical. Drop the back knee straight down. If the front knee caves inward, drop the weight.",
  "Seal Row": "Chest stays flat on the bench the whole set — no heaving up off it to move the weight. Pull to the bottom of your ribs and squeeze the shoulder blades together at the top.",
};
function ssPair(num, aName, aPre, bName, bPre) {
  return [
    ex({ name: aName, supersetLabel: `${num}A`, rpeWave: true, cues: aPre.cues || rpeProgramCues[aName] || "", load: aPre.load || "", sets: aPre.sets, reps: aPre.reps, tempo: aPre.tempo || "", rir: 10 - aPre.rpe, rest: "as needed between the paired exercises, 2 to 3 minutes after both are done", quality: "Strength", pct1rmFlat: takesPercentTarget(aName, aPre.reps) ? pctFromRpeReps(aPre.rpe, aPre.reps) : null }),
    ex({ name: bName, supersetLabel: `${num}B`, cues: bPre.cues || rpeProgramCues[bName] || "", load: bPre.load || "", sets: bPre.sets, reps: bPre.reps, tempo: bPre.tempo || "", rir: 10 - bPre.rpe, rest: "moves straight into the next superset round", quality: "Accessory", pct1rmFlat: takesPercentTarget(bName, bPre.reps) ? pctFromRpeReps(bPre.rpe, bPre.reps) : null }),
  ];
}
function ssSingle(num, name, pre, quality) {
  return ex({ name, supersetLabel: String(num), rpeWave: (quality || "Strength") === "Strength", cues: pre.cues || rpeProgramCues[name] || "", load: pre.load || "", sets: pre.sets, reps: pre.reps, tempo: pre.tempo || "", rir: 10 - pre.rpe, rest: "90 seconds to 2 minutes", quality: quality || "Strength", pct1rmFlat: takesPercentTarget(name, pre.reps) ? pctFromRpeReps(pre.rpe, pre.reps) : null });
}

function buildProgramCPhase(nameLabel, weekStart, weekEnd, objective, dayDefs) {
  return {
    id: uid(), name: nameLabel, weekStart, weekEnd, objective,
    intensityNote: "Every prescription below is driven by Rate of Perceived Exertion, not a percentage of your One-Rep Max — the number shown after each exercise is the target RPE for that set. Tempo notation (for example 2/1/X) means seconds lowering the weight, seconds pausing, then the lifting phase — X means as explosive as you can make it.",
    days: dayDefs.map((d, i) => ({ id: uid(), label: String(i + 1), name: d.name, intent: d.intent, sections: d.sections })),
  };
}

function buildProgramCContent() {
  const phase1 = buildProgramCPhase(
    "Strength / Strength Endurance / Isometrics / Core Stability — Weeks 1 to 3",
    1, 3,
    "Foundational strength block. Same movements and the same sets and reps all three weeks — the load is what climbs. Week 1 sits at Rate of Perceived Exertion 8, two good reps left in the tank. Weeks 2 and 3 push to 9, one rep left. Add weight whenever last week's load leaves more in you than that.",
    [
      { name: "Day 1", intent: "Squat, bench, and row pattern with isometric neck work to finish.", sections: [
        { id: uid(), type: "strength", name: "Working Sets", exercises: [
          ...ssPair(1, "Back Squat", { sets: 4, reps: "6", tempo: "1/2/X", rpe: 8 }, "Side Plank", { sets: 4, reps: "20 seconds each side", rpe: 7 }),
          ...ssPair(2, "Bench Press", { sets: 3, reps: "6", tempo: "1/2/X", rpe: 8 }, "Band Pull-Apart", { sets: 3, reps: "10", tempo: "1/3/1", rpe: 7 }),
          ...ssPair(3, "Bent Over Single Arm Dumbbell Row", { sets: 3, reps: "8 each side", tempo: "1/2/X", rpe: 8 }, "Scapular Push-Up", { sets: 3, reps: "10", tempo: "1/3/1", rpe: 7 }),
          ssSingle(4, "4-Way Isometric Neck Holds", { sets: 3, reps: "20 seconds each direction", rpe: 6 }, "Durability"),
          ...ssPair(5, "Hip Abduction Machine", { sets: 3, reps: "12", rpe: 7 }, "Hip Adduction Machine", { sets: 3, reps: "12", rpe: 7 }),
        ]},
      ]},
      { name: "Day 2", intent: "Zercher squat and overhead press pattern, with a longer accessory chain for grip and trunk.", sections: [
        { id: uid(), type: "strength", name: "Working Sets", exercises: [
          ...ssPair(1, "Zercher Squat", { sets: 4, reps: "6", tempo: "1/2/X", rpe: 8 }, "Supine Hamstring Single Leg Glute Bridge (ball or slides)", { sets: 4, reps: "8 each side", tempo: "2/0/X", rpe: 8 }),
          ...ssPair(2, "Standing Barbell Overhead Press", { sets: 3, reps: "6", tempo: "2/1/X", rpe: 8 }, "Banded Face Pulls", { sets: 3, reps: "10", tempo: "2/0/1", rpe: 7 }),
          ...ssPair(3, "Weighted Pull-Up", { sets: 3, reps: "8", tempo: "1/2/X", rpe: 8 }, "Cable Lat Row", { sets: 3, reps: "10", tempo: "3/1/X", rpe: 7 }),
          ...ssPair(4, "Toes to Bar", { sets: 2, reps: "10", tempo: "3/0/1", rpe: 8 }, "Weighted Plank", { sets: 2, reps: "1 minute", rpe: 8 }),
          ssSingle(5, "Rice Bucket Grip Drills", { sets: 2, reps: "20 seconds each direction", rpe: 6 }, "Grip"),
        ]},
      ]},
      { name: "Day 3", intent: "Single-leg hinge and pressing day, finishing on a loaded carry for anti-lateral-flexion core strength.", sections: [
        { id: uid(), type: "strength", name: "Working Sets", exercises: [
          ...ssPair(1, "Single Leg Romanian Deadlift", { sets: 3, reps: "6 each side", tempo: "2/0/1", rpe: 8 }, "Side Plank", { sets: 3, reps: "20 seconds each side", rpe: 7 }),
          ...ssPair(2, "Weighted Push-Ups", { sets: 3, reps: "6", tempo: "2/1/X", rpe: 8 }, "Weighted Scarecrows", { sets: 3, reps: "8, controlled", rpe: 7 }),
          ...ssPair(3, "Seal Row", { sets: 3, reps: "8", tempo: "2/1/X", rpe: 8 }, "Suitcase Carry (each side)", { sets: 3, reps: "30 meters each side", rpe: 9 }),
        ]},
        { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
          ex({ name: "Assault Bike, Treadmill, or Outdoor — Aerobic Base (Zone 2)", sets: 1, reps: "25 to 30 minutes, continuous, easy pace", load: "heart rate held at 130 to 150 beats per minute — conversational the whole way", rir: 7, rest: "none", purpose: "Builds the aerobic base everything else sits on top of — how fast you recover between rounds, between scrambles, and between sets. This block is where that foundation gets laid, so the harder conditioning in later blocks has something to build on.", cues: "This has to feel genuinely easy or it isn't doing its job. You should be able to hold a full conversation the entire time. If you're breathing hard, you've drifted out of the zone that actually builds this quality and into one that just costs you recovery for tomorrow's mat time. It's meant to feel almost boring — that's correct.", quality: "Conditioning" }),
        ]},
      ]},
    ]
  );

  const phase2 = buildProgramCPhase(
    "Strength Endurance, Isometrics, Core Stability — Weeks 5 to 7",
    5, 7,
    "Different main lifts than the first block on purpose — trap bar deadlift and front squat replace back squat and Zercher, keeping the same superset structure so the movement pattern stays fresh while total training stress builds. Effort follows the same pattern as the first block: Rate of Perceived Exertion 8 in week 1, then 9 in weeks 2 and 3, with one good rep always left in the tank.",
    [
      { name: "Day 1", intent: "Trap bar deadlift and floor press pattern, finishing on a pull-up hold and neck work.", sections: [
        { id: uid(), type: "strength", name: "Working Sets", exercises: [
          ...ssPair(1, "Trap Bar Deadlift", { sets: 4, reps: "5", tempo: "2/1/X", rpe: 8 }, "Banded Clamshell", { sets: 4, reps: "8 each side", tempo: "2/1/1", rpe: 7 }),
          ...ssPair(2, "Dumbbell Glute Bridge Floor Press", { sets: 3, reps: "6", tempo: "2/0/X", rpe: 8 }, "Supine Y, T, W", { sets: 3, reps: "5", tempo: "2/1/1", rpe: 7 }),
          ...ssPair(3, "Pull-Up Hold", { sets: 3, reps: "20 seconds", rpe: 8 }, "Medicine Ball Abdominal Extension", { sets: 3, reps: "10", rpe: 7 }),
          ssSingle(4, "4-Way Isometric Neck Holds", { sets: 3, reps: "30 seconds each way", rpe: 6 }, "Durability"),
          ssSingle(5, "Hip Adduction Machine", { sets: 3, reps: "12", rpe: 7 }, "Durability"),
        ]},
      ]},
      { name: "Day 2", intent: "Front squat and landmine press pattern.", sections: [
        { id: uid(), type: "strength", name: "Working Sets", exercises: [
          ...ssPair(1, "Front Squat", { sets: 4, reps: "5", tempo: "2/0/X", rpe: 8 }, "Banded Terminal Knee Extension", { sets: 4, reps: "10 each side", tempo: "2/2/2", rpe: 7 }),
          ...ssPair(2, "Landmine Punch Press", { sets: 3, reps: "6 each side", tempo: "2/0/X", rpe: 8 }, "Banded Face Pulls", { sets: 3, reps: "10", tempo: "2/2/2", rpe: 7 }),
          ...ssPair(3, "Bent Over Barbell Row", { sets: 3, reps: "6", tempo: "2/1/X", rpe: 8 }, "Prone Bench Y, T, W's", { sets: 3, reps: "5 each way", rpe: 7 }),
          ssSingle(4, "Toes to Bar", { sets: 3, reps: "10", tempo: "2/0/1", rpe: 8 }, "Trunk"),
        ]},
      ]},
      { name: "Day 3", intent: "Rear-foot-elevated split squat and offset pressing, ending on an arm isolation set.", sections: [
        { id: uid(), type: "strength", name: "Working Sets", exercises: [
          ...ssPair(1, "Bulgarian Split Squat (rear foot elevated, dumbbells)", { sets: 4, reps: "5 each side", tempo: "2/1/X", rpe: 8 }, "Valslide Hamstring Curls", { sets: 4, reps: "8", tempo: "2/2/2", rpe: 7 }),
          ...ssPair(2, "Offset Single Arm Dumbbell Press", { sets: 3, reps: "6 each side", tempo: "2/1/X", rpe: 8 }, "Band Pull-Apart", { sets: 3, reps: "10", tempo: "2/2/2", rpe: 7 }),
          ...ssPair(3, "Renegade Row", { sets: 3, reps: "6 each side", tempo: "2/1/X", rpe: 8 }, "Cable Lat Row", { sets: 3, reps: "10", tempo: "2/1/X", rpe: 7 }),
          ssSingle(4, "Heavy Pallof Press Hold (each side)", { sets: 2, reps: "20 seconds each side", tempo: "", rpe: 6 }, "Core"),
        ]},
        { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
          ex({ name: "Assault Bike or Treadmill — Repeated-Effort Tempo", sets: 1, reps: "10 rounds of 15 seconds hard effort, 45 seconds easy recovery between rounds", load: "hard but controlled — well past comfortable, short of an all-out sprint", rir: 3, rest: "none", purpose: "Jamieson's extensive tempo method — repeat-effort capacity, which is the same quality this block's strength-endurance work is building in the weight room. It trains the ability to fire off another hard scramble, shot or transition without a full rest first, which is exactly what a real match asks for round after round.", cues: "Your breathing should climb during each 15-second effort and only partly settle during the 45 seconds of recovery. That incomplete recovery is the whole point — it's the same pattern as the gap between exchanges in a live round. If you feel fully recovered before the next effort starts, you aren't pushing hard enough on the work.", quality: "Conditioning" }),
        ]},
      ]},
    ]
  );

  const phase3 = buildProgramCPhase(
    "Strength Speed, Speed Strength, Yielding Strength, Contralateral Stability, Concurrent Aerobic — Weeks 9 to 11",
    9, 11,
    "The realization block — the lightest week-to-week workload of the program paired with its heaviest loads. Six sets of low reps on the main lift, moved with real intent, with accessory volume deliberately stripped back so the main lifts land on fresh legs rather than on top of the previous two blocks' accumulated fatigue. Total sets per week step down across the program (roughly 76, then 72, then 67) while the loads step up, which is the point: you express the strength you built rather than keep grinding for more. Yielding-strength holds (the static trap bar hold, the single-arm kettlebell hold) train your ability to resist being moved, which is a different and just as important quality for grappling as producing force. Neck work also progresses here — once you've built a base with the isometric holds in earlier blocks, this block adds a light weighted bridge, since flat, unprogressed neck work indefinitely stops being real programming.",
    [
      { name: "Day 1", intent: "Split-stance trap bar deadlift for six triples, then supporting single-effort work.", sections: [
        { id: uid(), type: "power", name: "Working Sets", exercises: [
          ...ssPair(1, "Split Stance Trap Bar Deadlift", { sets: 6, reps: "3 each side", tempo: "2/0/X", rpe: 8 }, "Glute Hip Thrust with Medicine Ball", { sets: 4, reps: "6 each side", tempo: "3/1/X", rpe: 7 }),
          ssSingle(2, "Dumbbell Glute Bridge Floor Press", { sets: 3, reps: "5", tempo: "2/0/X", rpe: 8 }, "Strength"),
          ssSingle(3, "Incline Chest-Supported Dumbbell Row", { sets: 3, reps: "8", tempo: "2/0/X", rpe: 8 }, "Strength"),
          ssSingle(4, "Trap Bar Static Hold (Quarter Squat)", { sets: 2, reps: "one 10 second hold", load: "about 90 percent of your trap bar deadlift max — heavy, but a weight you can genuinely stand up with", rpe: 7 }, "Yielding Strength"),
          ssSingle(5, "Ab Roll Out", { sets: 2, reps: "12", rpe: 7 }, "Trunk"),
          ssSingle(6, "Weighted Neck Bridge (front and back, light plate on chest, controlled)", { sets: 2, reps: "6 per direction", rpe: 7 }, "Durability"),
          ssSingle(7, "Plate Lifts (Around the World)", { sets: 2, reps: "10 each direction", rpe: 7 }, "Core"),
        ]},
      ]},
      { name: "Day 2", intent: "Front squat for speed, then supporting single-effort accessory work.", sections: [
        { id: uid(), type: "power", name: "Working Sets", exercises: [
          ...ssPair(1, "Front Squat", { sets: 6, reps: "3", tempo: "2/0/X", rpe: 8 }, "Banded Terminal Knee Extension", { sets: 3, reps: "10 each side", tempo: "3/2/1", rpe: 7 }),
          ssSingle(2, "Incline Close Grip Bench Press", { sets: 4, reps: "5", tempo: "2/0/X", rpe: 8 }, "Strength"),
          ssSingle(3, "Renegade Row", { sets: 4, reps: "5 each side", tempo: "2/0/X", rpe: 8 }, "Strength"),
          ssSingle(4, "Copenhagen Plank (each side)", { sets: 2, reps: "20 to 25 seconds per side", rpe: 7 }, "Durability"),
          ssSingle(5, "Heavy Pallof Press Hold (each side)", { sets: 2, reps: "15 seconds each side", rpe: 6 }, "Core"),
          ssSingle(6, "Pallof Press (Anti-Rotation)", { sets: 2, reps: "10 each side", rpe: 7 }, "Contralateral Stability"),
        ]},
      ]},
      { name: "Day 3", intent: "Split-stance Romanian deadlift for speed, single-leg and single-arm work throughout for contralateral stability.", sections: [
        { id: uid(), type: "power", name: "Working Sets", exercises: [
          ...ssPair(1, "Split Stance Romanian Deadlift", { sets: 6, reps: "3 each side", tempo: "2/0/X", rpe: 8 }, "Valslide Hamstring Curls", { sets: 4, reps: "6", tempo: "3/1/1", rpe: 7 }),
          ssSingle(2, "Single Leg Glute Bridge Dumbbell Floor Press", { sets: 3, reps: "5 each side", tempo: "2/0/X", rpe: 8 }, "Contralateral Stability"),
          ssSingle(3, "Banded Single Leg Single Arm Row", { sets: 3, reps: "6 each side", tempo: "2/0/X", rpe: 8 }, "Contralateral Stability"),
          ssSingle(4, "Single Arm Kettlebell Hold", { sets: 2, reps: "one 20 second hold each side", rpe: 8 }, "Yielding Strength"),
          ssSingle(5, "High Plank Kettlebell Pull-Through", { sets: 2, reps: "8 each side", rpe: 8 }, "Contralateral Stability"),
        ]},
        { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
          ex({ name: "Assault Bike or Treadmill — Aerobic Power Intervals", sets: 1, reps: "3 rounds of 2 to 3 minutes at 90 percent maximum effort, equal time easy between each round", load: "88 to 92 percent of your max heart rate — pace this off heart rate, not off how hard it feels", rir: 1, rest: "none", purpose: "The concurrent aerobic work this block is named for. Jamieson's aerobic power protocol raises the ceiling on the aerobic system, and the work-to-rest pattern mirrors a real exchange on the mat rather than one long grind.", cues: "Deliberately only three rounds. This block already carries the heaviest session of the program and you're doing speed and power work on top of your mat time — three honest rounds is a real stimulus without turning this into a second workout. Each round should be close to all you can hold for its full length. Take the whole recovery between rounds so you can bring genuine effort to the next one instead of just surviving it.", quality: "Conditioning" }),
        ]},
      ]},
    ]
  );

  const deloadPhase = (weekNum, afterLabel) => buildProgramCPhase(
    `Deload — Week ${weekNum}`,
    weekNum, weekNum,
    `A genuine deload, not a retest. Every exercise from ${afterLabel} repeats at the same structure and tempo, but every set target drops to RPE 6 — a moderate, controlled effort with real reps in reserve on every set.`,
    [
      { name: "Day 1 — Deload", intent: "Same pattern as the block you just finished, at RPE 6.", sections: [
        { id: uid(), type: "strength", name: "Working Sets — Deload", exercises: [
          ...ssPair(1, weekNum === 4 ? "Back Squat" : weekNum === 8 ? "Trap Bar Deadlift" : "Split Stance Trap Bar Deadlift", { sets: 3, reps: weekNum === 12 ? "5 each side" : "6", tempo: "1/2/X", rpe: 6 }, weekNum === 4 ? "Side Plank" : weekNum === 8 ? "Banded Clamshell" : "Glute Hip Thrust with Medicine Ball", { sets: 3, reps: weekNum === 4 ? "15 to 20 seconds each side" : weekNum === 8 ? "8 each side" : "6 each side", rpe: 6 }),
          ssSingle(2, weekNum === 4 ? "Bench Press" : weekNum === 8 ? "Dumbbell Glute Bridge Floor Press" : "Dumbbell Glute Bridge Floor Press", { sets: 3, reps: "6", tempo: "2/0/X", rpe: 6 }, "Strength"),
          ssSingle(3, "4-Way Isometric Neck Holds", { sets: 3, reps: "15 seconds each way", rpe: 5 }, "Durability"),
        ]},
      ]},
      { name: "Day 2 — Deload", intent: "Same pattern as the block you just finished, at RPE 6.", sections: [
        { id: uid(), type: "strength", name: "Working Sets — Deload", exercises: [
          ...ssPair(1, weekNum === 4 ? "Zercher Squat" : "Front Squat", { sets: 3, reps: "6", tempo: "2/0/X", rpe: 6 }, "Banded Terminal Knee Extension", { sets: 3, reps: "10 each side", tempo: "2/2/2", rpe: 6 }),
          ssSingle(2, weekNum === 4 ? "Standing Barbell Overhead Press" : weekNum === 8 ? "Incline Bench Press" : "Incline Close Grip Bench Press", { sets: 3, reps: "5", tempo: "2/0/X", rpe: 6 }, "Strength"),
          ssSingle(3, "Rice Bucket Grip Drills", { sets: 2, reps: "20 seconds each direction", rpe: 5 }, "Grip"),
        ]},
      ]},
      { name: "Day 3 — Deload", intent: "Same pattern as the block you just finished, at RPE 6.", sections: [
        { id: uid(), type: "strength", name: "Working Sets — Deload", exercises: [
          ...ssPair(1, weekNum === 4 ? "Single Leg Romanian Deadlift" : "Split Stance Romanian Deadlift", { sets: 3, reps: "6 each side", tempo: "2/0/1", rpe: 6 }, "Valslide Hamstring Curls", { sets: 3, reps: "6", rpe: 6 }),
          ssSingle(2, weekNum === 4 ? "Weighted Push-Ups" : "Single Leg Glute Bridge Dumbbell Floor Press", { sets: 3, reps: "6 each side", tempo: "2/1/X", rpe: 6 }, "Strength"),
          ssSingle(3, "Heavy Pallof Press Hold (each side)", { sets: 2, reps: "15 seconds each side", rpe: 5 }, "Core"),
        ]},
        { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
          ex({ name: "Assault Bike or Treadmill — Easy Aerobic", sets: 1, reps: "10 to 12 minutes", load: "easy, conversational pace", rir: 7, rest: "none", purpose: "Easy aerobic movement on a deload week actively helps you recover rather than costing you anything — it moves blood without adding fatigue, and keeps the aerobic habit unbroken through the down week.", cues: "Easy the whole way. If it feels like training, it's too hard for this week.", quality: "Conditioning" }),
        ]},
      ]},
    ]
  );

  return { phases: [phase1, deloadPhase(4, "the first block"), phase2, deloadPhase(8, "the second block"), phase3, deloadPhase(12, "the speed-strength block")], warmup: rigoWarmup() };
}

function defaultWarmup() {
  return [
    { id: uid(), block: "General Raise", duration: "3 to 5 minutes", items: [
      { id: uid(), name: "Assault Bike or Treadmill, light pace", detail: "Build to a light sweat, nasal breathing only", videoUrl: "" },
    ]},
    { id: uid(), block: "Dynamic Mobility", duration: "5 to 6 minutes", items: [
      { id: uid(), name: "World's Greatest Stretch", detail: "5 reps per side", videoUrl: "https://www.youtube.com/watch?v=-CiWQ2IvY34" },
      { id: uid(), name: "Leg Swings, front-to-back and lateral", detail: "10 reps per direction per side", videoUrl: "https://www.youtube.com/shorts/wF10oYsLUw0" },
      { id: uid(), name: "Hip Circles", detail: "8 reps per direction per side", videoUrl: "https://www.youtube.com/shorts/P8P1E_IosqA" },
      { id: uid(), name: "Thoracic Rotations (quadruped)", detail: "8 reps per side", videoUrl: "https://www.youtube.com/shorts/Lfn-Fv_xmmQ" },
      { id: uid(), name: "Cable Pull-Apart (light, rope attachment)", detail: "15 reps", videoUrl: "https://www.youtube.com/shorts/Ol-QWheu9Yg" },
    ]},
  ];
}

function defaultMobility() {
  // Fifteen minutes, ordered the way the evidence supports.
  //
  // Breathing comes first, while heart rate is still high — that's when
  // shifting out of sympathetic drive is worth the most. Six breaths a minute
  // rather than box breathing: tested head to head in athletes straight after
  // high-intensity work, box breathing left them at a HIGHER heart rate (165
  // versus 155 beats per minute) and a higher perceived exertion, and the
  // authors advised against it in this window — most likely the breath holds.
  //
  // The stretching is here for range of motion and for down-regulation, which
  // is what it demonstrably does. It is not here to reduce soreness or speed
  // recovery, because post-exercise stretching does neither to any meaningful
  // degree, and the cue text says so rather than promising otherwise.
  return [
    { id: uid(), name: "Slow Breathing — Six Breaths a Minute", seconds: 150, type: "breath", detail: "Five seconds in through the nose, five seconds out through the mouth. No holding your breath at either end. Do this first, before you stretch anything, while your heart rate is still up — this is the part that genuinely shifts you out of training mode, and holding your breath here works against that.\n\nThis is also the same breathing you'll use in the twenty minutes before a match. Every time you do it here you're rehearsing it, so that on the day it's a habit rather than something you're trying for the first time under pressure.", videoUrl: "" },
    { id: uid(), name: "Couch Stretch (each side)", seconds: 120, type: "stretch", detail: "60 seconds per side. Rear knee down, hips squared forward, glute of the back leg engaged. The hip flexor and quad take a beating from squatting and from playing guard.", videoUrl: "" },
    { id: uid(), name: "90/90 Hip Switch Flow", seconds: 60, type: "stretch", detail: "Flow slowly side to side, feeling both hips through internal and external rotation. Internal rotation is the range most grapplers lose first and miss the most.", videoUrl: "" },
    { id: uid(), name: "Figure-4 / Pigeon Stretch (each side)", seconds: 120, type: "stretch", detail: "60 seconds per side. Sit into the hip, keep the spine tall, breathe out into the stretch rather than forcing it down.", videoUrl: "" },
    { id: uid(), name: "Deep Squat Hold", seconds: 60, type: "stretch", detail: "Heels down if possible, hands inside the knees gently pressing them out. Ankles, hips and lower back in one position — and the position you want to be comfortable in on the mat.", videoUrl: "" },
    { id: uid(), name: "Straddle Hamstring and Adductor Hold", seconds: 90, type: "stretch", detail: "Long hold. Hinge from the hips and relax a little deeper on each exhale. Adductor strain is one of the most common injuries in grappling, so this range is worth keeping.", videoUrl: "" },
    { id: uid(), name: "Open Book Thoracic Rotation (each side)", seconds: 60, type: "stretch", detail: "30 seconds per side, slow controlled rotation, follow the top hand with your eyes. Rotation you don't have in the mid-back gets taken from the lower back instead.", videoUrl: "" },
    { id: uid(), name: "Overhead Lat and Shoulder Stretch (each side)", seconds: 60, type: "stretch", detail: "30 seconds per side, hand on the rack or a bar, side-bend away to lengthen the lat.", videoUrl: "" },
    { id: uid(), name: "Wrist Flexor and Extensor Stretch (each side)", seconds: 60, type: "stretch", detail: "30 seconds per side. Palm down and fingers back for the flexors, then palm up and fingers down for the extensors. Gripping a gi, hanging, and heavy carries all load the forearms hard, and almost nobody gives them anything back.", videoUrl: "" },
    { id: uid(), name: "Neck Mobility Flow", seconds: 60, type: "stretch", detail: "Slow flexion, extension, and side to side — no forcing, stay pain-free the whole way. If anything pinches or refers down an arm, stop there.", videoUrl: "" },
    { id: uid(), name: "Closing Body Scan", seconds: 60, type: "breath", detail: "Keep the same five-in, five-out rhythm and run your attention from head to feet. Note anything that felt tight or off today — that's information worth bringing to your next check-in.", videoUrl: "" },
  ];
}

function blankProgram(name) {
  return {
    id: uid(), name: name || "Custom Program", sport: "", sessionsPerWeek: 3,
    coachNote: "", methodology: "", philosophy: "",
    conjugate: { meLowerPool: [], meUpperPool: [], wristPool: [], coreAntiPool: [], conditioningIntervalPool: [], hipPool: [], meRotationWeeks: 2 },
    warmup: defaultWarmup(),
    mobility: defaultMobility(),
    phases: [{ id: uid(), name: "Phase 1", weekStart: 1, weekEnd: 4, objective: "", intensityNote: "",
      days: [{ id: uid(), label: "1", name: "Day A", intent: "", sections: [{ id: uid(), type: "strength", name: "Main Strength", exercises: [] }] }] }],
  };
}

// Every client's own weekly training schedule, built from scratch — what days they
// do Low Intensity BJJ, High Intensity BJJ, and Strength/Conditioning, so it fits
// each client's actual week instead of any one person's. Starts blank; nothing is
// assumed.
const SCHEDULE_DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const REST_DAY = "Rest Day";
const SCHEDULE_ACTIVITIES = ["Low Intensity BJJ", "High Intensity BJJ", "Strength/Conditioning", REST_DAY];
function defaultWeeklySchedule() {
  const blank = {};
  SCHEDULE_DAYS.forEach(([key]) => { blank[key] = []; });
  return blank;
}
function WeeklyScheduleEditor({ schedule, onChange }) {
  // Rest Day is exclusive — picking it clears anything else selected that day, and
  // picking a training activity while Rest Day is set replaces it, since "rest" and
  // "train" can't both be true for the same day.
  const toggle = (dayKey, activity) => {
    onChange((prev) => {
      const current = prev[dayKey] || [];
      let next;
      if (activity === REST_DAY) {
        next = current.includes(REST_DAY) ? [] : [REST_DAY];
      } else if (current.includes(activity)) {
        next = current.filter((a) => a !== activity);
      } else {
        next = [...current.filter((a) => a !== REST_DAY), activity];
      }
      return { ...prev, [dayKey]: next };
    });
  };
  return (
    <div className="schedule-editor">
      {SCHEDULE_DAYS.map(([key, label]) => (
        <div key={key} className="schedule-edit-row">
          <div className="schedule-edit-day">{label}</div>
          <div className="schedule-edit-chips">
            {SCHEDULE_ACTIVITIES.map((activity) => {
              const active = (schedule[key] || []).includes(activity);
              return (
                <button type="button" key={activity} className={`schedule-chip ${active ? "active" : ""}`} onClick={() => toggle(key, activity)} aria-pressed={active}>
                  {activity}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
function twoDayDeloadPhase(weekNum, afterPhaseName) {
  return {
    id: uid(), name: `Deload Week (Week ${weekNum})`, weekStart: weekNum, weekEnd: weekNum,
    objective: `This week is deliberately light. The goal is simple: dissipate the fatigue built up over the last three weeks of ${afterPhaseName} so you walk into the next phase fresh, not to test anything or push a top set. Every 4th week in this program works this way.`,
    intensityNote: "No Dynamic Effort work this week at all. Max Effort days cap out at a moderate double or triple, at least 2 reps in reserve — never a true top single.",
    days: [
      { id: uid(), label: "1", name: "Max Effort Lower — Deload",
        intent: "Stay light on purpose. This is recovery, not a second max-effort day — leave real reps in the tank.",
        sections: [
          { id: uid(), type: "strength", name: "Main Strength", exercises: [ meLowerDeloadBlock() ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "4-Way Isometric Neck Holds", sets: 2, reps: "15 seconds each direction", load: "your own hand, or a folded towel against a wall, for resistance", rir: 5, rest: "45 seconds", purpose: "A deload is a deload from lifting — you are still rolling this week and still getting choked. This stays in at a maintenance dose.", quality: "Durability", videoUrl: "https://www.youtube.com/shorts/hxMolBuXmY0" }),
            ex({ name: "Moderate Farmer Carry", sets: 2, reps: "20 meters", load: "moderate", rir: 3, rest: "90 seconds", purpose: "Light grip and trunk maintenance, low fatigue cost", quality: "Grip/Trunk" }),
          ]},
        ]},
      { id: uid(), label: "2", name: "Max Effort Upper + Easy Conditioning — Deload",
        intent: "Same idea upstairs — moderate weight, clean technique, plenty of reps left in reserve, then an easy aerobic finisher so the week still touches conditioning even at deload volume.",
        sections: [
          { id: uid(), type: "strength", name: "Main Strength", exercises: [ meUpperDeloadBlock() ]},
          { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
            ex({ name: "Assault Bike or Treadmill — Easy Aerobic", sets: 1, reps: "10 to 12 minutes", load: "easy, conversational pace", rir: 7, rest: "none", purpose: "Active recovery — keep the aerobic system ticking over without adding fatigue", quality: "Conditioning" }),
          ]},
        ]},
    ],
  };
}
function twoDayPhase(nameLabel, weekStart, weekEnd, objective, intensityNote, dePercent, opts = {}) {
  const dePct = parseInt(dePercent, 10) || 50;
  const trim = !!opts.trimExtras;
  return {
    id: uid(), name: nameLabel, weekStart, weekEnd, objective, intensityNote, dePercent,
    days: [
      { id: uid(), label: "1", name: "Max Effort Lower + Dynamic Effort Upper",
        intent: "Two qualities in one session, since there's only two days a week to work with — a true max effort on the lower body lift while you're fresh, then fast speed work on the upper body press once the main lift is done.",
        sections: [
          { id: uid(), type: "agility", name: "Speed, Agility & Change of Direction", exercises: [
            ex({ name: "Single-Leg Balance Reach", sets: 1, reps: "5 reaches per leg", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Brief ankle and knee stability preparation before loading the lift", quality: "Neuromuscular" }),
            ex({ name: "Scapular Push-Up", sets: 1, reps: "10", load: "bodyweight", rir: 6, rest: "45 seconds", purpose: "Activates the serratus anterior, primes shoulder blade control before this session's Dynamic Effort press", quality: "Neuromuscular" }),
            ex({ name: "Lateral Shuffle", sets: 2, reps: "10 meters", load: "bodyweight", rir: 5, rest: "45 seconds", purpose: "Primes lateral hip stability and change-of-direction patterning relevant to scrambles", quality: "Agility", videoUrl: "https://www.youtube.com/shorts/nqLsCj7pgbw" }),
          ]},
          { id: uid(), type: "strength", name: "Main Strength", exercises: [
            meLowerBlock(),
            // Dropped in the peak block, the same way Program A drops it: a true
            // max-effort pull followed by heavy eccentric hinge work is the wrong
            // combination for the week mat intensity is highest.
            ...(trim ? [] : [ex({ name: "Barbell Romanian Deadlift", sets: 3, reps: dePct <= 50 ? "8" : "6", load: dePct <= 50 ? "moderate — leave the last rep comfortably in the tank" : "heavier than the base block — still leave reps in the tank", rir: 3, rest: "90 seconds", tempo: "3/0/1", purpose: "Eccentric-biased posterior chain strength. This program prescribes maximal sprinting every week and has no other hamstring or hip-hinge work — loading the hamstring long and slow under control is the best-evidenced protection against the strain that maximal sprinting otherwise invites.", cues: "Push the hips back, keep the bar close to the legs, and take a full three seconds to lower. Stop the rep the moment your lower back rounds — the range comes from the hips, not the spine. The lowering half is the point; don't rush it to get more reps.", quality: "Posterior Chain" })]),
          ]},
          { id: uid(), type: "power", name: trim ? "Dynamic Effort Upper" : "Dynamic Effort Upper + Rotational Power", exercises: [
            deBench(dePct),
            ...(trim ? [] : [ex({ name: "Landmine Rotational Press (each side)", sets: 3, reps: "6 per side", load: "light to moderate", rir: 1, rest: "90 seconds", purpose: "Loaded rotational power — hip-to-shoulder force transfer directly relevant to underhooks, throws, and scrambles", quality: "Rotational Power" })]),
          ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "Heavy Farmer Carry", sets: 2, reps: "25 meters", load: "heavy", rir: 1, rest: "90 seconds", purpose: "Grip and trunk bracing under load — the only carry slot in a two-day week, so it stays heavy", quality: "Grip/Trunk" }),
            ex({ name: "Cable Face Pull", sets: 2, reps: "15", load: "light to moderate", rir: 2, rest: "60 seconds", tempo: "1/1/2", purpose: "Scapular retraction and posterior shoulder health. Pressing volume only climbs from here, so this is the counterweight that keeps the shoulder centred.", cues: "Rope to the bridge of your nose, elbows high, finish with your knuckles pointing back behind you. Hold the end position for a full second.", quality: "Prehab", videoUrl: "https://www.youtube.com/watch?v=hbo-nSIEmXo" }),
            ex({ name: "4-Way Isometric Neck Holds", sets: 3, reps: "20 seconds each direction", load: "bodyweight or manual resistance", rir: 2, rest: "45 seconds", purpose: "Direct neck strength through every plane in one efficient slot — close to non-negotiable for anyone taking regular guillotine and choke pressure", quality: "Durability" }),
            ex({ name: hipPool[0].name, rotatingPool: "hipPool", sets: 2, reps: hipPool[0].reps, load: hipPool[0].load, rir: 3, rest: "60 seconds", purpose: hipPool[0].notes, quality: "Durability" }),
          ]},
          ...(trim ? [] : [{ id: uid(), type: "arms_core", name: "Core", exercises: [
            ex({ name: coreAntiPool[0].name, rotatingPool: "coreAntiPool", sets: 2, reps: "10 per side", load: "moderate", rir: 2, rest: "60 seconds", purpose: coreAntiPool[0].notes, quality: "Core" }),
          ]}]),
        ]},
      { id: uid(), label: "2", name: "Max Effort Upper + Dynamic Effort Lower + Conditioning",
        intent: "Sprints first while you're completely fresh, then max effort on the press, the week's pulling work, explosive lower body work, and the week's one conditioning session to finish. Shoulder activation and neck work stay on Day 1 to keep this day, with its long conditioning finisher, clear of the two-hour mark.",
        sections: [
          { id: uid(), type: "agility", name: "Speed & Acceleration", exercises: [
            ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 3, reps: "3 build-up runs at about 60, 80 and 90 percent over the same distance, then 1 maximal effort sprint", load: "bodyweight, full recovery between efforts", rir: 1, rest: "90 seconds", purpose: "Alactic power and acceleration — short maximal efforts directly relevant to explosive takedown entries, the one true speed-work slot in a two-day week. Placed here rather than ahead of the max-effort squat, so neither the sprint nor the lift is run on the other's fatigue.", quality: "Alactic Power", videoUrl: "https://www.youtube.com/shorts/7_-gaumnzWw" }),
          ]},
          { id: uid(), type: "strength", name: "Main Strength", exercises: [
            meUpperBlock(),
            ex({ name: "Weighted Pull-Up", sets: 3, reps: dePct <= 50 ? "5" : "4", load: "add load once bodyweight reps are easy", rir: 3, rest: "2 minutes", purpose: "The only loaded pulling in a two-day week. Both sessions press — a max effort press on this day and speed bench on the other — so without this the shoulder accumulates twelve weeks of pressing with nothing balancing it.", cues: `Full hang at the bottom, chin clearly over the bar, no kipping. If ${dePct <= 50 ? "five" : "four"} clean reps aren't there yet, use a band and keep the range honest rather than shortening it.`, quality: "Strength" }),
          ]},
          { id: uid(), type: "power", name: "Dynamic Effort Lower", exercises: [ deSquat(dePct) ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "30 to 40 seconds, shoulders active", load: "bodyweight", rir: 3, rest: "90 seconds", purpose: "Support grip, isometric strength", quality: "Grip", videoUrl: "https://www.youtube.com/shorts/XPcT3capkyk" }),
          ]},
          { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
            ex({ name: conditioningIntervalPool[0].name, rotatingPool: "conditioningIntervalPool", sets: 1, reps: conditioningIntervalPool[0].reps, load: "", rir: 7, rest: "none", purpose: "Rotates every 2 weeks through three modalities — easy aerobic base building, hard aerobic power intervals, and repeated-effort tempo work — so every energy system gets trained across the block even with just two sessions a week", quality: "Conditioning" }),
          ]},
        ]},
    ],
  };
}
function buildTwoDayHybridContent() {
  return {
    id: uid(),
    name: "Condensed Conjugate — Two-Day Program (Program C)",
    variant: "C",
    sport: "Brazilian Jiu-Jitsu / Wrestling",
    sessionsPerWeek: 2,
    coachNote:
      "Built for clients who genuinely only have two days a week for the weight room — most people training Brazilian Jiu-Jitsu or wrestling four or five times a week don't have a third lifting day in them, and a program that assumes they do just gets skipped. This borrows Program A's conjugate structure (a Max Effort lift paired with a Dynamic Effort lift in the same session, the way coaches like Josh Settlage and Phil Daru build sessions for grapplers with limited time) and Program B's efficiency mindset — nothing wasted, every slot earning its place — and compresses them into two sessions that still cover a heavy lift, a speed lift, durability work, and conditioning every single week. Before shipping this one, I had a strength and conditioning coach look specifically at the two-day-a-week question, since that's the part most templates get wrong by either doing too little or trying to cram three days into two. Their read matched what the training research consistently shows about frequency: two focused sessions a week is enough to keep building strength in an athlete who is already getting high-frequency skill practice on the mat. Which does mean each session carries more weight than it would in a three-day week — so get them both in when you can. But miss one and the week is lighter, not lost. Do it late if there's room; if there isn't, the next one is the one that counts.",
    methodology:
      "Same conjugate foundation as Program A — Max Effort and Dynamic Effort work, rotating exercise pools so nothing goes stale — restructured for two sessions instead of three: Day 1 pairs a Max Effort Lower lift with Dynamic Effort Upper speed work, Day 2 pairs Max Effort Upper with Dynamic Effort Lower and closes with that week's one conditioning session, since there's no third day to host it separately. Durability, hip, and core work is trimmed to what fits in two sessions without turning either one into a two-hour workout — less total volume than Program A, on purpose, to match the lower session count, with extras dropped even further in the final phase before a competition the same way Program A does.",
    philosophy:
      "Two days a week, every week, beats three days a week that quietly turns into one. This program exists to make the absolute most of exactly two sessions — nothing here assumes a third day shows up, and nothing gets left half-finished waiting for one.",
    conjugate: { meLowerPool, meUpperPool, wristPool, coreAntiPool, conditioningIntervalPool, hipPool, meRotationWeeks: 2 },
    warmup: defaultWarmup(),
    mobility: defaultMobility(),
    phases: [
      twoDayPhase("Conjugate Base — Work Capacity", 1, 3,
        "This phase builds your ability to safely work up to a heavy top set and builds speed on the Dynamic Effort lifts. You'll log your bodyweight and complete a daily readiness check-in so any early signs of overtraining get caught quickly.",
        "On Max Effort days, work up to a true heavy top single or triple. On Dynamic Effort days, use 50 percent of your One-Rep Max for 8 sets, moving the weight as explosively as possible.",
        "50%"),
      twoDayDeloadPhase(4, "the base phase"),
      twoDayPhase("Conjugate Intensification", 5, 7,
        "Dynamic Effort intensity goes up. With only two sessions a week, recovery is rarely the limiting factor here — push the Max Effort top sets.",
        "Max Effort days stay the same in structure — a true heavy top single or triple. Dynamic Effort moves up to 55 percent of your One-Rep Max.",
        "55%"),
      twoDayDeloadPhase(8, "the intensification phase"),
      twoDayPhase("Conjugate Peak / Compete Prep", 9, 11,
        "Extra exercises are kept to a bare minimum here, same as Program A. The priority is a heavy, fresh Max Effort top set and fast Dynamic Effort work, all while your grappling training volume stays high.",
        "Dynamic Effort moves up to 60 to 65 percent of your One-Rep Max. No new exercises are introduced this late in the program.",
        "60 to 65%", { trimExtras: true }),
      twoDayDeloadPhase(12, "the peak block"),
    ],
  };
}
// Speed is a quality that only exists when you are fresh. The main lift has to
// come first, but the accessory work does not belong between it and the speed
// work — reaching an 8x3 speed bench after 48 reps of split squats and RDLs
// means training something that is no longer speed.
//
// So: main lift, then the speed work, then the accessories. This splits the
// strength block rather than rewriting any prescription.
function sequenceForFreshness(program) {
  (program.phases || []).forEach((phase) => {
    (phase.days || []).forEach((day) => {
      const secs = day.sections || [];
      const powerIdx = secs.findIndex((s) => s.type === "power");
      if (powerIdx < 0) return;
      const strengthIdx = secs.findIndex((s) => s.type === "strength");
      if (strengthIdx < 0 || strengthIdx > powerIdx) return;
      const strength = secs[strengthIdx];
      if (!strength.exercises || strength.exercises.length < 2) return;

      const main = strength.exercises.slice(0, 1);
      const accessories = strength.exercises.slice(1);
      strength.exercises = main;
      const accessorySection = {
        id: uid(), type: "strength", name: "Accessory Strength",
        exercises: accessories,
      };
      // Drop it in immediately after the speed work.
      secs.splice(powerIdx + 1, 0, accessorySection);
    });
  });
  return program;
}


// Attaching a video to an exercise attaches it to one definition, but the same
// movement appears again in the rotating swap pools and in the other two program
// variants, and those copies went out blank — so the swap options, which is
// exactly when someone most needs to see the lift, had no demo. The fix is one
// registry harvested from all three variants: add a video anywhere and every
// copy of that movement picks it up, whichever program the athlete is on.
let VIDEO_REGISTRY = null;
let HARVESTING = false;

function eachExerciseIn(program, fn) {
  if (!program) return;
  (program.phases || []).forEach((ph) => (ph.days || []).forEach((d) => (d.sections || []).forEach((s) => (s.exercises || []).forEach(fn))));
  Object.values(program.conjugate || {}).forEach((pool) => { if (Array.isArray(pool)) pool.forEach((i) => { if (i && i.name) fn(i); }); });
  (program.warmup || []).forEach((b) => (b.items || []).forEach(fn));
  (program.mobility || []).forEach(fn);
}

const hasVideo = (u) => typeof u === "string" && u.trim().length > 0;

function harvestVideos(program, into) {
  eachExerciseIn(program, (e) => {
    if (!e || !e.name) return;
    const k = normalizeExerciseKey(e.name);
    if (!into.has(k)) into.set(k, {});
    const slot = into.get(k);
    // First one wins, so the order A, B, C is what decides ties. Every movement
    // in the program currently resolves to a single URL, so this only matters
    // if a future edit gives one movement two different demos.
    if (hasVideo(e.videoUrl) && !slot.videoUrl) slot.videoUrl = e.videoUrl.trim();
    if (hasVideo(e.videoUrl2) && !slot.videoUrl2) slot.videoUrl2 = e.videoUrl2.trim();
  });
  return into;
}

function videoRegistry() {
  if (VIDEO_REGISTRY) return VIDEO_REGISTRY;
  const reg = new Map();
  // Guarded so the builds done to harvest do not themselves try to backfill.
  HARVESTING = true;
  try {
    ["A", "B", "C"].forEach((v) => harvestVideos(buildProgramVariant(v), reg));
    // VIDEO_LIBRARY is the hand-curated list resolveExercise already falls back
    // to at runtime. Folding it in here means the stored program carries the
    // same links the screen would have shown anyway, so a swap pill and an
    // exported program agree with the session view.
    Object.entries(VIDEO_LIBRARY).forEach(([k, url]) => {
      if (!reg.has(k)) reg.set(k, {});
      if (!reg.get(k).videoUrl) reg.get(k).videoUrl = url;
    });
  } catch {
    // A failure here costs videos, never the program itself.
  } finally {
    HARVESTING = false;
  }
  VIDEO_REGISTRY = reg;
  return reg;
}

function backfillVideos(program) {
  if (!program || HARVESTING) return program;
  // A coach can attach a video to one athlete's program, so that athlete's own
  // copy is harvested first and wins over the shared registry.
  const own = harvestVideos(program, new Map());
  const shared = videoRegistry();
  eachExerciseIn(program, (e) => {
    if (!e || !e.name) return;
    const k = normalizeExerciseKey(e.name);
    const mine = own.get(k) || {};
    const theirs = shared.get(k) || {};
    const url = mine.videoUrl || theirs.videoUrl;
    const url2 = mine.videoUrl2 || theirs.videoUrl2;
    if (!hasVideo(e.videoUrl) && url) e.videoUrl = url;
    // videoUrl2 is only filled where the exercise already opted into a second
    // demo slot, so a one-video movement does not sprout an empty second field.
    if (e.videoUrl2 !== undefined && !hasVideo(e.videoUrl2) && url2) e.videoUrl2 = url2;
  });
  return program;
}

function buildProgramVariant(variant) {
  if (variant === "C") {
    return backfillVideos(sequenceForFreshness(buildTwoDayHybridContent()));
  }
  const base = JSON.parse(JSON.stringify(conjugateProgram));
  if (variant === "A") {
    base.name = "Condensed Conjugate — Twelve-Week Program (Program A)";
    base.variant = "A";
    base.phases.forEach((phase) => {
      const isDeload = phase.name.toLowerCase().includes("deload");
      if (isDeload) return; // deload weeks stay Dynamic-Effort-free, same as the rest of the program
      const dePct = parseInt(phase.dePercent, 10) || 50;
      phase.days.forEach((day) => {
        if (day.label === "1" && day.name.includes("Max Effort Lower")) {
          day.name = day.name.replace("Max Effort Lower", "Max Effort Lower + Dynamic Effort Upper");
          day.intent = "Two qualities in one session, Settlage-style — a true max effort on the lower body lift first while you're fresh, then explosive speed work on the upper body press once the main lift is done. Keep the Dynamic Effort set genuinely fast, not just lighter.";
          const strengthIdx = day.sections.findIndex((s) => s.type === "strength");
          day.sections.splice(strengthIdx + 1, 0, { id: uid(), type: "power", name: "Dynamic Effort Upper", exercises: [deBench(dePct)] });
        }
        if (day.label === "2" && day.name.includes("Max Effort Upper")) {
          day.name = day.name.replace("Max Effort Upper", "Max Effort Upper + Dynamic Effort Lower");
          day.intent = "Same idea in reverse — max effort on the press first while you're fresh, then explosive speed work on the lower body once the main lift is done. Two qualities trained per session so three days a week covers everything.";
          const strengthIdx = day.sections.findIndex((s) => s.type === "strength");
          day.sections.splice(strengthIdx + 1, 0, { id: uid(), type: "power", name: "Dynamic Effort Lower", exercises: [deSquat(dePct)] });
        }
      });
    });
    sequenceForFreshness(base);
  } else {
    base.name = "Offseason Strength Build — Twelve-Week Program (Program B)";
    base.variant = "B";
    base.objective = "Built directly from a Rate-of-Perceived-Exertion based coaching program — paired supersets, tempo-controlled reps, and RPE targets instead of percentage-of-max ramps. No competition to taper for, so nothing in the final block backs off; the last three weeks simply shift from strength-endurance work to a faster, lower-fatigue speed-strength emphasis.";
    base.coachNote = "";
    base.philosophy = "Every working set below is paired into a numbered superset (1A and 1B, done back to back before resting) and prescribed by Rate of Perceived Exertion rather than a percentage of your max — the number after each exercise is the target RPE for that set. Tempo notation like 2/1/X means 2 seconds lowering the weight, a 1 second pause, then lift as explosively as you can (X).";
    const built = buildProgramCContent();
    base.phases = built.phases;
    base.warmup = built.warmup;
  }
  return backfillVideos(base);
}

function buildClient({ id, firstName, lastName, weight, heightFeet, heightInches, useTemplate, beltLevel, programVariant, injuryNotes, injuryAreas, profilePicture, promoDiscount, weeklySchedule, waiver }) {
  const name = `${firstName} ${lastName}`.trim() || "Athlete";
  return {
    id, name, firstName, lastName, heightFeet: heightFeet || 0, heightInches: heightInches || 0,
    profilePicture: profilePicture || null,
    createdAt: todayStr(),
    program: useTemplate ? buildProgramVariant(["A", "B", "C"].includes(programVariant) ? programVariant : "B") : blankProgram(),
    logs: [], readiness: {}, prLog: [],
    bodyweightLog: weight ? [{ date: todayStr(), weight: Number(weight) }] : [],
    mobilityLogs: [], sessionsCompleted: 0, blockNumber: 1,
    hasSeenTutorial: false,
    weeklySchedule: weeklySchedule || defaultWeeklySchedule(),
    beltLevel: beltLevel || "White",
    bjjNotes: [],
    paid: false,
    promoDiscount: promoDiscount || 0,
    excludedExercises: [],
    injuryNotes: injuryNotes ? injuryNotes.trim() : "",
    maxSessionsReached: 0,
    // { at: ISO timestamp, version } — the signed record, kept with the athlete
    waiver: waiver || null,
    competitionDate: null,
    injuryAreas: Array.isArray(injuryAreas) ? injuryAreas : [],
  };
}

const BELT_LEVELS = ["White", "Grey", "Yellow", "Orange", "Green", "Blue", "Purple", "Brown", "Black"];
const PROGRAM_VARIANT_LABELS = {
  A: "Program A — Condensed Conjugate",
  B: "Program B — Offseason Strength Build",
  C: "Program C — Two-Day Hybrid",
};

// Replacing the suffering-as-virtue quotes with coaching. These are the lines
// that agree with the program underneath them.
const MENTAL_COACHING_LIBRARY = [
  { quote: "Backing off today is a training decision, not a concession. The set you don't grind is the one you don't pay for on Thursday.", author: "Your coach" },
  { quote: "Stop when the bar slows, not when the number looks right.", author: "Your coach" },
  { quote: "A deload week is supposed to feel too easy. That's the dose, not a mistake.", author: "Your coach" },
  { quote: "The neck work takes four minutes and it's the reason you're still training in five years.", author: "Your coach" },
  { quote: "Showing up on the days you don't feel like it is most of the program.", author: "Your coach" },

  // Weighted toward training and combat sport: the athlete reads one of these
  // standing in the gym deciding whether to load the bar, not at a desk.
  { quote: "The fight is won or lost far away from witnesses — behind the lines, in the gym, and out there on the road, long before I dance under those lights.", author: "Muhammad Ali" },
  { quote: "Champions aren't made in gyms. Champions are made from something they have deep inside them — a desire, a dream, a vision.", author: "Muhammad Ali" },
  { quote: "It isn't the mountains ahead to climb that wear you out; it's the pebble in your shoe.", author: "Muhammad Ali" },
  { quote: "Don't count the days. Make the days count.", author: "Muhammad Ali" },
  { quote: "Everybody has a plan until they get punched in the mouth.", author: "Mike Tyson" },
  { quote: "I fear not the man who has practiced 10,000 kicks once, but I fear the man who has practiced one kick 10,000 times.", author: "Bruce Lee" },
  { quote: "Do not pray for an easy life; pray for the strength to endure a difficult one.", author: "Bruce Lee" },
  { quote: "Always assume that your opponent is going to be bigger, stronger and faster than you, so that you learn to rely on technique, timing and leverage rather than brute strength.", author: "Helio Gracie" },
  { quote: "Once you've wrestled, everything else in life is easy.", author: "Dan Gable" },
  { quote: "Gold medals aren't really made of gold. They're made of sweat, determination, and a hard-to-find alloy called guts.", author: "Dan Gable" },
  { quote: "The Iron never lies to you.", author: "Henry Rollins" },
  { quote: "Discipline equals freedom.", author: "Jocko Willink" },
  { quote: "It's not whether you get knocked down, it's whether you get up.", author: "Vince Lombardi" },
  { quote: "If you train hard, you'll not only be hard, you'll be hard to beat.", author: "Herschel Walker" },
  { quote: "No one has ever drowned in sweat.", author: "Lou Holtz" },
  { quote: "Motivation is what gets you started. Habit is what keeps you going.", author: "Jim Ryun" },
  { quote: "I've missed more than 9,000 shots in my career. I've lost almost 300 games. Twenty-six times I've been trusted to take the game-winning shot and missed. I've failed over and over and over again in my life. And that is why I succeed.", author: "Michael Jordan" },
  { quote: "Champions keep playing until they get it right.", author: "Billie Jean King" },
  { quote: "I really think a champion is defined not by their wins but by how they can recover when they fall.", author: "Serena Williams" },
  { quote: "Do not let what you cannot do interfere with what you can do.", author: "John Wooden" },
  { quote: "A black belt is a white belt who never quit.", author: "Martial Arts Proverb" },
  { quote: "The more you sweat in training, the less you bleed in combat.", author: "Military Proverb" },
  { quote: "Flow with the go.", author: "Rickson Gracie" },
  { quote: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca" },
  { quote: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { quote: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { quote: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { quote: "It's not what happens to you, but how you react to it that matters.", author: "Epictetus" },
  { quote: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { quote: "You must do the thing you think you cannot do.", author: "Eleanor Roosevelt" },
  { quote: "Nothing in the world is worth having or worth doing unless it means effort, pain, difficulty.", author: "Theodore Roosevelt" },
  { quote: "Never give in, never give in, never, never, never, never — in nothing, great or small, large or petty — never give in.", author: "Winston Churchill" },
  { quote: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { quote: "You may encounter many defeats, but you must not be defeated.", author: "Maya Angelou" },
  { quote: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { quote: "Fall seven times, stand up eight.", author: "Japanese Proverb" },
  { quote: "Smooth seas do not make skillful sailors.", author: "African Proverb" },
];

function mentalTipForDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  return MENTAL_COACHING_LIBRARY[hash % MENTAL_COACHING_LIBRARY.length];
}

/* ============================== READINESS ============================== */

// Every read of READINESS_COPY goes through here. A check-in saved before the
// colour field existed would otherwise take down the Progress tab and the coach
// dashboard on an undefined lookup.
function readinessCopyFor(entry) {
  const key = entry && entry.color;
  return READINESS_COPY[key] || READINESS_COPY[classifyReadiness(entry || {})] || READINESS_COPY.YELLOW;
}

function classifyReadiness(r) {
  // Check-ins saved before this changed carry energy and soreness instead of a
  // readiness score. They are scored the way they were scored on the day, so a
  // past session's colour never changes underneath the athlete.
  if (r.readiness == null && r.soreness != null) {
    const legacy = (Number(r.sleep) + Number(r.energy || 0)) / 2 - Number(r.soreness);
    if (legacy <= -1.5) return "RED";
    if (legacy >= 1.5) return "GREEN";
    return "YELLOW";
  }
  // Both rows now count for the athlete rather than against, so the score is a
  // straight average on the same 0 to 5 scale the sliders use.
  const score = (Number(r.sleep) + Number(r.readiness)) / 2;
  // A normal day has to mean "train the session as written". At a 3.5 cut-off
  // the default 3/3 and the "Normal" quick-pick both came back yellow, so the
  // majority of sessions were quietly backed off and the athlete was told daily
  // that they were below par.
  if (score <= 1.5) return "RED";
  if (score >= 3) return "GREEN";
  return "YELLOW";
}
const READINESS_COPY = {
  GREEN: { detail: "Good to go — today's session runs exactly as written.", color: "var(--green)", textColor: "var(--bg)" },
  YELLOW: { detail: "You flagged a rough night, so today runs a notch back: a little lighter, one more rep left in the tank, less arm and core filler. Your neck and adductor work stays in. This is the session doing its job, not you failing a test.", color: "var(--amber)", textColor: "var(--bg)" },
  RED: { detail: "You said you're wrecked, so today is half the sets, no singles and no hard conditioning. The warm-up and the neck and adductor work stay — they cost you nothing and you're still training tonight. Come back to the heavy stuff when you're fresh.", color: "var(--red)", textColor: "#ffffff" },
};









// Things that have to be looked at by somebody who can actually examine you.
// These are written as coaching guidance rather than diagnosis, and they exist
// because this program loads the cervical spine and is delivered through a
// phone to someone training on their own.
const SAFETY_SCREEN_TITLE = "Before you start";
const SAFETY_SCREEN_SECTIONS = [
  {
    heading: "Medical clearance before the neck work",
    body: "This program trains the neck deliberately. Grappling applies repeated load to the cervical spine through chokes, stacks and scrambles, and a conditioned neck tolerates that load considerably better than an unconditioned one. A neck with an existing problem, however, requires assessment by a qualified clinician rather than a training program. Please consult a physician or physiotherapist before beginning the neck work if any of the following apply: numbness, tingling or weakness in an arm or hand, currently or within the last three months; previous cervical fracture, fusion or neck surgery; a diagnosed disc herniation or spinal stenosis; dizziness, visual disturbance or nausea on neck extension; headaches that began following a neck injury, or neck pain that wakes you at night; rheumatoid arthritis. The remainder of the program remains appropriate to train in the meantime.",
  },
  {
    heading: "Head impacts and concussion",
    body: "A suspected concussion means no lifting, no neck work and no conditioning until you have been cleared by a clinician. Not a reduced session — no session. This is the single rule in the program with no autoregulated alternative, and a low readiness score is not a substitute for it.",
  },
  {
    heading: "Pain is not the same as fatigue",
    body: "The daily check-in is designed to manage fatigue. It is not designed to manage pain. New or worsening pain, anything sharp, anything that radiates down a limb, or anything that is worse the following morning warrants a conversation rather than a lighter session. If you have an area you need to train around, set it in Settings so the program adjusts around it, and tell your coach.",
  },
  {
    heading: "Scope of this program",
    body: "This is a strength and conditioning program. It is not medical care, and it does not diagnose, treat or rehabilitate injury. It cannot observe you, assess your technique, or account for anything it has not been told. Where a problem requires diagnosis, the appropriate step is a referral to a qualified clinician, not an adjustment to your programming.",
  },
];

function SafetyScreenModal({ onClose }) {
  return (
    <ModalShell onClose={onClose} title={SAFETY_SCREEN_TITLE}>
      <p className="muted" style={{ marginBottom: 16 }}>
        Please read this before your first session. Most of it will not apply to you. Where it does apply, it matters more than anything else in the program.
      </p>
      {SAFETY_SCREEN_SECTIONS.map((s) => (
        <div key={s.heading} style={{ marginBottom: 16 }}>
          <h3 className="log-exercise-name" style={{ marginBottom: 5 }}>{s.heading}</h3>
          <p className="muted" style={{ marginBottom: 0, lineHeight: 1.55 }}>{s.body}</p>
        </div>
      ))}
      <button className="btn-primary wide" style={{ marginTop: 6 }} onClick={onClose}>I've read this</button>
    </ModalShell>
  );
}

// Three numbers on a lift, in seconds: down, pause, up. Nobody is born knowing
// that, and reading it backwards turns the RDL's protective slow lowering into
// a fast one.
const TEMPO_LEGEND = "Tempo is three numbers — for example 3/0/1. The first is how many seconds to lower the weight, the second is how long to pause at the bottom, the third is how many seconds to lift it. An X means lift it as fast as you can. So 3/0/1 is a slow three-second lowering, no pause, then up in one. The lowering half is usually the part doing the work.";

/* ============================== COMPETITION PREP ============================== */
// A phase called "Compete Prep" that prescribes true max singles in its final
// week isn't competition prep. With a date set, the last ten days taper; without
// one, the written rule below is what the athlete gets.

const TAPER_DAYS = 10;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + "T00:00:00");
  const now = new Date(todayStr() + "T00:00:00");
  return Math.round((then - now) / 86400000);
}

// Applied on top of the readiness adjustment, so a taper and a rough day stack
// rather than one overwriting the other.
function applyTaper(sections, daysOut) {
  if (daysOut == null || daysOut < 0 || daysOut > TAPER_DAYS) return { sections, taperNote: null };
  const adjusted = sections.map((sec) => {
    if (sec.type === "conditioning" && daysOut <= 5) {
      return { ...sec, exercises: (sec.exercises || []).map((e) => ({ ...e, reps: "15 minutes easy — conversational", cues: "No hard conditioning inside five days of competing. Easy movement only; the fitness is already banked and anything hard now just costs you." })) };
    }
    if (sec.type === "strength") {
      return { ...sec, exercises: (sec.exercises || []).map((e) => {
        const isRamp = /down to 1|top single|working sets/i.test(String(e.reps));
        return {
        ...e,
        sets: isRamp ? 1 : Math.max(1, Math.round((e.sets || 3) * 0.5)),
        reps: isRamp ? "one crisp set of 2 to 3 at around 90 percent — an opener, not a max" : e.reps,
        rir: Math.max(e.rir || 0, 2),
        cues: `${e.cues || ""} Taper: half the sets, and nothing that leaves a mark. You are sharpening, not building — there is no session between now and the mat that can make you stronger, and plenty that can make you slower.`.trim(),
        };
      }) };
    }
    if (sec.type === "power") {
      return { ...sec, exercises: (sec.exercises || []).map((e) => ({ ...e, sets: Math.max(1, Math.round((e.sets || 6) * 0.5), 2), cues: `${e.cues || ""} Keep these — speed work is what keeps you sharp through a taper. Just fewer of them.`.trim() })) };
    }
    if (sec.type === "durability") {
      return { ...sec, exercises: (sec.exercises || []).map((e) => ({ ...e, sets: Math.max(1, Math.round((e.sets || 2) * 0.5)) })) };
    }
    return sec;
  });
  const note = daysOut === 0
    ? "Competition day. Nothing in the gym today helps you — warm up, breathe, and go compete."
    : `${daysOut} day${daysOut === 1 ? "" : "s"} out. Tapering: half the sets, no maximal lifting, speed work kept short and sharp.`;
  return { sections: adjusted, taperNote: note };
}

const WEIGHT_CUT_GUIDANCE = {
  heading: "Making weight",
  body: "This program does not prescribe a weight cut and your coach is not going to write you one. But you will probably think about it, so here is the thing most people do not know: IBJJF uses a same-day weigh-in. They weigh you on the day, in your gi, minutes before your first match. There is no overnight rehydration window the way there is in wrestling or MMA. That single rule makes an aggressive cut a fundamentally worse idea in this sport than in almost any other.\n\nWhat that means practically: compete at or very near your walking weight. If you are trimming at all in the final week, keep it to a couple of percent of bodyweight and do it through fibre, salt and water timing — not through sweating it off. No sauna suits, no active dehydration, no diuretics, ever. And know that grip strength and reaction time are among the first things dehydration takes from you, which in a gi is close to the worst possible trade.\n\nIf the gap between you and the division is bigger than that, move up a division for this one and have a conversation with your coach about the next twelve weeks. That is a programming problem, not a water problem.",
};

/* ============================== TRAINING AROUND AN INJURY ============================== */
// The app collected an injury note and the program did nothing with it, so a
// client who wrote "groin pull from July" was prescribed a near-failure
// Copenhagen in week one. These are the five or six complaints that actually
// arrive, and what each one changes.
//
// This is coaching guidance, not treatment. Anything acute, anything with pain
// at rest or at night, anything already under a clinician's care — that is a
// conversation with the coach before week one, not a substitution.

const INJURY_AREAS = [
  {
    key: "shoulder", label: "Shoulder",
    note: "Overhead and barbell pressing swap to neutral-grip and landmine work, which most cranky shoulders tolerate. Pulling moves to a supported row. Face pulls stay — they are part of the fix.",
    rules: [
      { match: /overhead press|incline (barbell )?press|bench press|close.?grip bench|spoto press|weighted push|dip\b/i,
        to: "Neutral-Grip Dumbbell Floor Press",
        why: "Pressing swapped for a neutral-grip floor press — the floor limits the range at exactly the point an irritated shoulder complains, and the neutral grip keeps the joint centred.",
        cues: "Elbows tucked to about 45 degrees, upper arms stopping on the floor each rep. If any range of this hurts, shorten it rather than pushing through." },
      { match: /weighted pull-?up|pull-?up(?! bar dead)/i,
        to: "Chest-Supported Dumbbell Row",
        why: "Vertical pulling swapped for a supported row while the shoulder settles.",
        cues: "Chest stays on the pad. Pull to the bottom of the ribs and stop the set well short of anything that pinches." },
      { match: /landmine rotational press/i, drop: true, why: "Overhead rotational pressing is out while the shoulder is irritated." },
    ],
  },
  {
    key: "lowBack", label: "Low back",
    note: "Spinal loading comes down: axial squatting and pulling swap to supported variations, and loaded spinal flexion is replaced with bracing work.",
    rules: [
      { match: /box squat|back squat|zercher|front squat|good morning|anderson squat/i,
        to: "Leg Press (pain-free range)",
        why: "Loaded squatting swapped for a leg press while the back settles — same quad and glute work, no bar on your spine.",
        cues: "Set the range so you never feel your pelvis tuck under at the bottom. Stop short of that point every rep." },
      { match: /romanian deadlift/i,
        to: "Supine Hamstring Curl (bodyweight, heels on a slider)",
        why: "Hamstring work kept, hip hinge removed while the back settles.",
        cues: "Hips up, heels sliding out slowly. Stop the set the moment your lower back wants to arch." },
      { match: /jump squat|box jump|depth jump|pogo/i, drop: true,
        why: "Jumping and landing is out while the back is sore — the landing is the highest spinal load in the program, and it arrives faster than you can brace for it." },
      { match: /deadlift|trap bar(?! static)/i,
        to: "Trap Bar Deadlift from blocks (shortened range)",
        why: "Pulling from blocks rather than the floor, so the range starts above where a sore back usually complains.",
        cues: "Set the bar at about mid-shin or higher. Reset your brace on the blocks between every rep." },
      { match: /toes to bar|ab roll ?out|hanging leg raise/i,
        to: "Dead Bug",
        why: "Loaded spinal flexion swapped for anti-extension bracing, which is what the trunk actually does in grappling anyway.",
        cues: "Lower back stays flat on the floor the entire set. The moment it lifts, that rep was the last one." },
      { match: /farmer carry|suitcase carry/i, lighter: true,
        why: "Carries kept but lighter and shorter — they are good for a back, right up until they are not." },
    ],
  },
  {
    key: "knee", label: "Knee",
    note: "Deep knee flexion and hard landings come out. Single-leg work continues in a range that does not hurt, because strength is most of what protects the joint.",
    rules: [
      { match: /bulgarian split squat|split squat|lunge/i,
        to: "Step-Down to a Low Box",
        why: "Split squats swapped for a step-down, where you control the depth exactly.",
        cues: "Start with a low box — six inches is plenty. Lower under control, tap the heel, come back up. Never into a range that hurts." },
      { match: /jump squat|pogo|box jump|depth jump/i, drop: true,
        why: "Jumping and landing is out while the knee is sore. It is the highest-force thing in the program and the first thing to go." },
      { match: /acceleration sprint|shuttle|5-?10-?5/i, drop: true,
        why: "Sprinting and cutting are out while the knee is sore." },
      { match: /box squat|back squat|front squat|zercher/i, lighter: true,
        why: "Squatting kept, but lighter and only through a range that is completely pain-free." },
    ],
  },
  {
    key: "elbowWrist", label: "Elbow or wrist",
    note: "Grip and hanging load comes down, because the elbow is almost always a grip-volume problem. Direct forearm work stays, light and slow — that is the part that actually fixes it.",
    rules: [
      { match: /weighted pull-?up|pull-?up(?! bar dead)/i,
        to: "Chest-Supported Dumbbell Row",
        why: "Hanging swapped for a supported row while the elbow settles.",
        cues: "Chest on the pad, neutral grip if you have the option." },
      { match: /dead hang|towel hang/i, drop: true,
        why: "Hanging is out — it is sustained load on exactly the tissue that is irritated, on top of gripping a gi three times a week." },
      { match: /farmer carry|suitcase carry|kettlebell hold|landmine.*hold/i, lighter: true,
        why: "Carries and holds kept but lighter — grip volume is usually the cause here." },
      { match: /wrist curl/i, lighter: true,
        why: "Wrist work stays and gets slower. Light, controlled, three seconds down is the loading that helps a cranky elbow rather than aggravating it." },
    ],
  },
  {
    key: "groin", label: "Groin or adductor",
    note: "Adductor work stays — it is the thing that rebuilds the tissue — but at a short lever and well away from failure until it is pain-free for two clear weeks.",
    rules: [
      { match: /copenhagen/i,
        to: "Copenhagen Plank — short lever (knee on the bench)",
        why: "Kept, but at the short lever. A healing adductor taken near failure at full lever is how a strain becomes a re-tear.",
        cues: "Top leg bent, knee resting on the bench, bottom leg on the floor. Hold comfortably and stop well before shaking. Only lengthen the lever once it has been completely pain-free for two weeks." },
      { match: /hip adduction machine/i, lighter: true,
        why: "Kept at a moderate load, well short of failure." },
      { match: /lateral shuffle|shuttle|5-?10-?5/i, drop: true,
        why: "Hard lateral cutting is out while the adductor is healing." },
    ],
  },
  {
    key: "neck", label: "Neck",
    note: "Bridging comes out entirely and the isometrics drop to an easy dose. Please get a neck looked at rather than training around it.",
    rules: [
      { match: /neck bridge/i, drop: true,
        why: "No bridging on an irritated neck, at any dose. This is the one area where training around it is the wrong instinct — get it looked at." },
      { match: /4-way isometric neck/i, lighter: true,
        why: "Isometrics kept at an easy, pain-free pressure only. Any pinching or anything travelling down an arm means stop and see someone." },
      { match: /neck curl|neck extension/i,
        to: "Isometric Neck Holds — manual resistance, easy pressure",
        why: "Loaded neck curls and extensions swapped for gentle isometric holds. Holding a position is far easier on an irritated neck than moving it under a plate.",
        cues: "Hand on your own head, press just hard enough to feel the muscle work, and hold. No movement at all. Anything sharp, or anything travelling down an arm, means stop and get it looked at." },
    ],
  },
  {
    key: "hamstring", label: "Hamstring",
    note: "Sprinting comes out — it is where hamstrings tear. The slow eccentric work stays, because that is the best-evidenced thing you can do for one.",
    rules: [
      { match: /acceleration sprint/i, drop: true,
        why: "Maximal sprinting is out until this is fully settled. If you have a sled, push or drag it instead — same repeat-effort quality, none of the tearing risk." },
      { match: /romanian deadlift/i, lighter: true,
        why: "Kept and lightened deliberately. Slow, long-range eccentric loading is the best-evidenced protection for a hamstring — this is the exercise that fixes it, so it stays." },
    ],
  },
];

function applyInjurySubstitutions(exercises, areas) {
  if (!areas || !areas.length) return exercises;
  const active = INJURY_AREAS.filter((a) => areas.includes(a.key));
  if (!active.length) return exercises;
  const out = [];
  for (const e of exercises) {
    let current = e;
    let dropped = false;
    for (const area of active) {
      let swappedHere = false;
      for (const rule of area.rules) {
        if (swappedHere) break;
        // Always test the ORIGINAL name, so one rule's replacement can never be
        // caught and re-swapped by the next rule in the same list.
        if (!rule.match.test(e.name)) continue;
        if (rule.drop) { dropped = true; break; }
        if (rule.to) {
          swappedHere = true;
          current = { ...current, name: rule.to, substitutedFor: e.name, injuryNote: rule.why,
            cues: rule.cues || current.cues, videoUrl: "", videoUrl2: "" };
        } else if (rule.lighter) {
          current = { ...current, rir: Math.max(Number(current.rir) || 0, 4), injuryNote: rule.why,
            sets: Math.max(1, Math.round((Number(current.sets) || 2) * 0.7)) };
        }
      }
      if (dropped) break;
    }
    if (!dropped) out.push(current);
  }
  return out;
}

// The picker. Free text told the coach; this tells the program.
function InjuryAreaPicker({ value, onChange, compact }) {
  const selected = value || [];
  const toggle = (key) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    onChange(next);
  };
  return (
    <>
      <div className="injury-chips">
        {INJURY_AREAS.map((a) => {
          const on = selected.includes(a.key);
          return (
            <button key={a.key} type="button" className={`injury-chip ${on ? "on" : ""}`}
              aria-pressed={on} onClick={() => toggle(a.key)}>
              {a.label}
            </button>
          );
        })}
      </div>
      {selected.length > 0 && !compact && (
        <div style={{ marginTop: 10 }}>
          {INJURY_AREAS.filter((a) => selected.includes(a.key)).map((a) => (
            <div key={a.key} className="intent-box" style={{ marginBottom: 8 }}>
              <strong>{a.label}.</strong> {a.note}
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12.5 }}>
            These swaps happen automatically from your next session. Anything acute, anything that hurts at rest or wakes you at night, or anything you're already seeing someone about — message your coach rather than training around it.
          </p>
        </div>
      )}
    </>
  );
}

/* ============================== CONDITIONING DISPLAY ============================== */
// Conditioning was rendering through the same "Set / Weight / Reps" grid as a
// barbell lift, so "4 rounds of 2 to 3 minutes at 88 to 92 percent of your max
// heart rate, equal time easy between each round" arrived as one long sentence
// above an empty weight box. These helpers turn that sentence back into the
// structure it is describing, so the shape of the session is visible at a glance
// and the prose is there for whoever wants it rather than in the way.

function parseConditioning(repsText) {
  const t = String(repsText || "");
  // "4 rounds of 2 to 3 minutes ..." / "12 rounds of 15 seconds hard effort ..."
  const m = t.match(/(\d+)\s*rounds?\s+of\s+(\d+)(?:\s*to\s*(\d+))?\s*(minutes?|seconds?)/i);
  if (m) {
    const isMin = /^m/i.test(m[4]);
    const unit = isMin ? "min" : "sec";
    const work = m[3] ? `${m[2]}\u2013${m[3]} ${unit}` : `${m[2]} ${unit}`;
    // Seconds are kept alongside the label so the bar below can be drawn to the
    // real work-to-rest ratio. 15 on / 45 off should not look like 50/50.
    const workSecs = (Number(m[3] || m[2]) || 0) * (isMin ? 60 : 1);
    let recovery = "", restSecs = 0;
    if (/equal time/i.test(t)) { recovery = work; restSecs = workSecs; }
    else {
      const r = t.match(/(\d+)\s*(minutes?|seconds?)\s*(?:easy\s*)?recovery/i);
      if (r) { recovery = `${r[1]} ${/^m/i.test(r[2]) ? "min" : "sec"}`; restSecs = Number(r[1]) * (/^m/i.test(r[2]) ? 60 : 1); }
    }
    const rounds = Number(m[1]);
    return { kind: "intervals", rounds, work, recovery, workSecs, restSecs,
      totalMins: Math.round((rounds * (workSecs + restSecs)) / 60) };
  }
  // "30 to 40 minutes, continuous, easy pace" / "10 to 12 minutes"
  const d = t.match(/(\d+)(?:\s*to\s*(\d+))?\s*minutes?/i);
  if (d) return { kind: "continuous", duration: d[2] ? `${d[1]}–${d[2]} min` : `${d[1]} min` };
  return null;
}

// The effort target, stated once and plainly, with the check that does not need
// a heart rate monitor — most athletes training in a normal gym do not have one.
function conditioningEffort(target) {
  const s = `${target.load || ""} ${target.reps || ""}`.toLowerCase();
  if (/88 to 92|90 percent|max heart rate/.test(s))
    return { label: "88–92% of max heart rate", tone: "hard", test: "Three or four words at a time, not a full sentence." };
  if (/hard but controlled|hard effort|hard but repeatable/.test(s))
    return { label: "Hard but controlled", tone: "medium", test: "Well past comfortable, short of an all-out sprint." };
  if (/easy|conversational|130 to 150/.test(s))
    return { label: "Easy and conversational", tone: "easy", test: "You could hold a full conversation the whole way through." };
  return null;
}

// One sentence on what the session is for. The long coaching rationale still
// exists on the exercise — this is the version you can read between rounds.
function conditioningBrief(name) {
  const n = (name || "").toLowerCase();
  if (/power interval/.test(n))
    return "Raises the ceiling on your aerobic system — how hard you can work before you are gassed. The work-to-rest pattern copies a real exchange on the mat.";
  if (/repeated-effort tempo/.test(n))
    return "Trains firing off another scramble before you have fully recovered. That gap between exchanges is the thing most conditioning skips.";
  if (/aerobic base|zone 2|easy aerobic|aerobic maintenance/.test(n))
    return "Builds the engine you recover with — between rounds, between scrambles, between sets. It is meant to feel almost boring.";
  return null;
}

function ConditioningPlan({ target, name }) {
  const [showPacing, setShowPacing] = useState(false);
  const plan = parseConditioning(target.reps);
  const effort = conditioningEffort(target);
  const brief = conditioningBrief(name);
  const drawn = plan && plan.kind === "intervals" ? Math.min(plan.rounds, 12) : 0;
  return (
    <div className="cond-card">
      {brief && <p className="cond-why">{brief}</p>}

      {plan && plan.kind === "intervals" ? (
        <>
          <div className="cond-stats">
            <div className="cond-stat"><span className="cond-stat-v">{plan.rounds}</span><span className="cond-stat-l">rounds</span></div>
            <div className="cond-stat"><span className="cond-stat-v">{plan.work}</span><span className="cond-stat-l">hard</span></div>
            {plan.recovery && (
              <div className="cond-stat"><span className="cond-stat-v">{plan.recovery}</span><span className="cond-stat-l">easy between</span></div>
            )}
          </div>
          <div className="cond-bars" aria-hidden="true">
            {Array.from({ length: drawn }, (_, i) => (
              <span key={i} className="cond-round">
                <span className="cond-work" style={{ flexGrow: plan.workSecs || 1 }} />
                {plan.recovery ? <span className="cond-rest" style={{ flexGrow: plan.restSecs || 1 }} /> : null}
              </span>
            ))}
          </div>
          <div className="cond-bars-key" aria-hidden="true">
            <span><span className="cond-key-dot work" />hard</span>
            <span><span className="cond-key-dot rest" />easy</span>
            {plan.rounds > drawn && <span className="muted">+{plan.rounds - drawn} more rounds</span>}
          </div>
        </>
      ) : plan && plan.kind === "continuous" ? (
        <div className="cond-stats">
          <div className="cond-stat wide"><span className="cond-stat-v">{plan.duration}</span><span className="cond-stat-l">continuous — no intervals, no stopping</span></div>
        </div>
      ) : (
        <div className="cond-stats"><div className="cond-stat wide"><span className="cond-stat-v small">{target.reps}</span></div></div>
      )}

      {effort && (
        <div className={`cond-effort tone-${effort.tone}`}>
          <span className="cond-effort-label">{effort.label}</span>
          <span className="cond-effort-test">{effort.test}</span>
        </div>
      )}

      {target.cues && (
        <>
          <button type="button" className="cond-pacing-toggle" onClick={() => setShowPacing((s) => !s)} aria-expanded={showPacing}>
            <span>How to pace it</span>
            <ChevronRight size={14} className={showPacing ? "chev-open" : ""} />
          </button>
          {showPacing && <div className="log-exercise-cue" style={{ marginTop: 2 }}>{target.cues}</div>}
        </>
      )}
    </div>
  );
}

/* ============================== APP SHELL ============================== */

const TABS = [
  { id: "today", label: "Today", icon: Home },
  { id: "program", label: "Program", icon: CalendarDays },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "bjj", label: "BJJ Notes", icon: BookOpen },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "prs", label: "Records", icon: Trophy },
];

// A render error used to unmount the whole app and leave a blank screen, which
// is a miserable thing to happen to someone mid-session. This catches it and
// offers a way out without losing anything already saved.
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { try { console.error("Strength Matrix error:", error); } catch {} }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-shell" data-theme="dark">
        <div className="pad" style={{ paddingTop: 60 }}>
          <Card title="Something went wrong">
            <p className="muted" style={{ marginBottom: 14 }}>
              The app hit an unexpected error and stopped. Everything you'd already saved is safe — your logs, records and check-ins live on the server, not in this screen. Reloading almost always fixes it.
            </p>
            <button className="btn-primary wide" onClick={() => window.location.reload()}>Reload the app</button>
          </Card>
        </div>
        <GlobalStyle />
      </div>
    );
  }
}

// Shown when a read failed rather than came back empty. The distinction is the
// whole point: this screen exists so that a dropped connection can never be
// mistaken for a new account.
function ConnectionErrorScreen({ onRetry, onSignOut }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="pad" style={{ paddingTop: 60, maxWidth: 420, margin: "0 auto" }}>
      <h1 className="program-title">Can't reach the server</h1>
      <p className="muted" style={{ marginBottom: 6 }}>
        Your training is safe. Every workout, record and check-in lives on the server, not on this phone — this screen just couldn't load it.
      </p>
      <p className="muted" style={{ marginBottom: 18 }}>
        This is almost always a patchy connection. Try again in a moment.
      </p>
      <button className="btn-primary wide" disabled={busy}
        onClick={async () => { setBusy(true); await onRetry(); setBusy(false); }}>
        {busy ? "Trying…" : "Try again"}
      </button>
      <button className="btn-ghost wide" style={{ marginTop: 10 }} onClick={onSignOut}>Sign out</button>
    </div>
  );
}

function MainApp({ userId, onSignOut }) {
  const isCoach = !!COACH_USER_ID && userId === COACH_USER_ID;
  const [clients, setClients] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [client, setClientState] = useState(null);
  const [tab, setTab] = useState("today");
  const [showClients, setShowClients] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showCoachDashboard, setShowCoachDashboard] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [logging, setLogging] = useState(null);
  const [showMobility, setShowMobility] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [clientLoadError, setClientLoadError] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [newSignupCount, setNewSignupCount] = useState(0);

  // Anyone who registers their own account is auto-linked to the coach at
  // sign-up. Any link the coach hasn't marked reviewed is a new athlete still
  // waiting on a paid-or-grandfathered decision.
  const refreshNewSignups = useCallback(async () => {
    if (!isCoach || !supabase || !userId) { setNewSignupCount(0); return; }
    try {
      const { data: links } = await supabase.from("client_links").select("client_user_id").eq("coach_user_id", userId);
      const reviewed = (await kvGet(userId, REVIEWED_SIGNUPS_KEY)) || [];
      setNewSignupCount((links || []).filter((l) => !reviewed.includes(l.client_user_id)).length);
    } catch {
      setNewSignupCount(0);
    }
  }, [isCoach, userId]);

  useEffect(() => { refreshNewSignups(); }, [refreshNewSignups]);

  // Signup-time linking fails whenever email confirmation is on, because there
  // is no session yet for row-level security to check. Re-asserting it here, on
  // every authenticated load, means a client who slipped through still lands in
  // the coach's dashboard the first time they actually sign in.
  useEffect(() => {
    if (!supabase || !userId || !COACH_USER_ID || userId === COACH_USER_ID) return;
    (async () => {
      const { error } = await supabase.from("client_links")
        .upsert({ client_user_id: userId, coach_user_id: COACH_USER_ID }, { onConflict: "client_user_id" });
      if (error) console.warn("coach link:", error.message);
    })();
  }, [userId]);

  const loadClientList = useCallback(async () => {
    setLoadError(false);
    const list = await getClientList(userId);
    const settings = await getSettings(userId);
    setTheme(settings.theme || "dark");
    // A failed read stops here. Falling through would show an existing athlete
    // the onboarding screen and let them overwrite their own client list.
    if (list === LOAD_FAILED) { setLoadError(true); setLoaded(true); return; }
    setClients(list || []);
    if (list && list.length) setActiveId(list[0].id);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { loadClientList(); }, [loadClientList]);

  const loadActiveClient = useCallback(async () => {
    if (!activeId) return;
    setClientLoadError(false);
    {
      const c = await getClient(userId, activeId);
      if (c === LOAD_FAILED) { setClientLoadError(true); return; }
      let healedReadiness = false;
      if (c) {
        if (!c.bodyweightLog) c.bodyweightLog = [];
        if (!c.mobilityLogs) c.mobilityLogs = [];
        if (!c.prLog) c.prLog = [];
        if (!c.blockNumber) c.blockNumber = 1;
        if (c.hasSeenTutorial === undefined) c.hasSeenTutorial = false;
        if (!c.excludedExercises) c.excludedExercises = [];
        if (c.injuryNotes === undefined) c.injuryNotes = "";
    if (c.maxSessionsReached === undefined) c.maxSessionsReached = c.sessionsCompleted || 0;
    if (c.waiver === undefined) c.waiver = null;
    if (c.hasSeenSafety === undefined) c.hasSeenSafety = false;
    if (c.competitionDate === undefined) c.competitionDate = null;
    if (!c.injuryAreas) c.injuryAreas = [];
    if (!c.logs) c.logs = [];
    if (!c.readiness) c.readiness = {};
        if (!c.weeklySchedule) c.weeklySchedule = defaultWeeklySchedule();
        if (!c.beltLevel) c.beltLevel = "White";
        if (!c.bjjNotes) c.bjjNotes = [];
        if (c.paid === undefined) c.paid = true;
        if (!c.program) {
          // Nothing sensible to render without a program, and silently throwing
          // here used to leave the app on a spinner with no way out.
          setClientLoadError(true);
          return;
        }
        if (!c.program.mobility) c.program.mobility = defaultMobility();
        // Swap-pool and cross-variant copies of an exercise were saved without
        // the video attached to the original, so an existing athlete is swept
        // on load rather than having to rebuild their program.
        backfillVideos(c.program);

        // Check-ins saved before the colour field existed are scored once and
        // written back, so every screen that reads a colour finds one.
        Object.entries(c.readiness || {}).forEach(([day, entry]) => {
          if (entry && !entry.color) {
            entry.color = classifyReadiness(entry);
            if (!entry.date) entry.date = day;
            healedReadiness = true;
          }
        });

        // Self-heal: older versions of this app briefly saved rotating Max Effort
        // exercises with a blank name, which then got frozen into this client's
        // stored data forever. Repair any of those on load, and any pool entries
        // that are missing a name, using the current default pools as reference.
        let healed = healedReadiness;
        // Weekly schedule used to be free-typed text per day; it's now a set of
        // fixed activity chips per day (an array). A schedule saved in the old
        // text format can't be mapped onto the new chips automatically, so it
        // resets to blank once, to be re-picked with the new selector.
        if (c.weeklySchedule && SCHEDULE_DAYS.some(([key]) => c.weeklySchedule[key] !== undefined && !Array.isArray(c.weeklySchedule[key]))) {
          c.weeklySchedule = defaultWeeklySchedule();
          healed = true;
        }
        if (c.program?.conjugate) {
          ["meLowerPool", "meUpperPool", "wristPool", "coreAntiPool", "conditioningIntervalPool"].forEach((key) => {
            const defaults = conjugateProgram.conjugate[key];
            if (!Array.isArray(c.program.conjugate[key]) || c.program.conjugate[key].length === 0) {
              c.program.conjugate[key] = JSON.parse(JSON.stringify(defaults));
              healed = true;
            } else {
              c.program.conjugate[key] = c.program.conjugate[key].map((item, i) => {
                if (!item.name) { healed = true; return { ...item, name: defaults[i % defaults.length]?.name || `Exercise ${i + 1}` }; }
                return item;
              });
            }
          });
          (c.program.phases || []).forEach((phase) => (phase.days || []).forEach((day) => (day.sections || []).forEach((sec) => (sec.exercises || []).forEach((e) => {
            if (e.rotatingPool && !e.name) {
              const pool = c.program.conjugate[e.rotatingPool];
              if (pool && pool[0]) { e.name = pool[0].name; healed = true; }
            }
          }))));
        }
        if (healed) await setClient(userId, c.id, c);
      }
      setClientState(c);
    }
  }, [activeId, userId]);

  useEffect(() => { loadActiveClient(); }, [loadActiveClient]);

  const persistClient = useCallback(async (updated) => { setClientState(updated); return setClient(userId, updated.id, updated); }, [userId]);

  useEffect(() => { if (client && !client.hasSeenTutorial) setShowTutorial(true); }, [client?.id]); // eslint-disable-line
  // Shown once, after the tutorial, before anyone trains. Re-readable any time
  // from Settings.
  useEffect(() => {
    if (client && client.hasSeenTutorial && !client.hasSeenSafety) setShowSafety(true);
  }, [client?.id, client?.hasSeenTutorial, client?.hasSeenSafety]); // eslint-disable-line
  const changeTheme = async (t) => { setTheme(t); await setSettings(userId, { theme: t }); };

  const completeOnboarding = async (profile) => {
    const id = uid();
    let promoDiscount = 0;
    try {
      const { data } = await supabase.auth.getUser();
      const code = (data?.user?.user_metadata?.promoCode || "").trim().toUpperCase();
      promoDiscount = PROMO_CODES[code] || 0;
    } catch {}
    const c = buildClient({ id, ...profile, useTemplate: true, promoDiscount });
    const saved = await setClient(userId, id, c);
    if (!saved || saved.ok === false) return;
    // Append. Replacing the list wholesale is how a client whose list failed to
    // load once could lose every record they already had.
    const list = [...clients, { id, name: c.name }];
    setClients(list);
    await setClientList(userId, list);
    setActiveId(id);
  };
  const addClient = async (profile, useTemplate) => {
    const id = uid();
    const c = buildClient({ id, ...profile, useTemplate });
    await setClient(userId, id, c);
    const list = [...clients, { id, name: c.name }];
    setClients(list);
    await setClientList(userId, list);
    setActiveId(id);
    setShowClients(false);
  };
  const deleteClient = async (id) => {
    const list = clients.filter((c) => c.id !== id);
    setClients(list);
    await setClientList(userId, list);
    if (activeId === id && list.length) setActiveId(list[0].id);
  };
  const resetAppData = async () => {
    for (const c of clients) await deleteClientStorage(userId, c.id);
    await setClientList(userId, []);
    setClients([]);
    setActiveId(null);
    setClientState(null);
    setShowSettings(false);
  };
  const refreshProgramTemplate = async (variantOverride) => {
    if (!client) return;
    const variant = variantOverride || client.program?.variant || "B";
    const updated = { ...client, program: buildProgramVariant(variant) };
    await persistClient(updated);
  };

  if (!loaded) return <div className="app-shell" data-theme={theme}><LoadingState /><ToastHost /><GlobalStyle /></div>;
  if (loadError) return (
    <div className="app-shell" data-theme={theme}>
      <ConnectionErrorScreen onRetry={loadClientList} onSignOut={onSignOut} />
      <ToastHost /><GlobalStyle />
    </div>
  );
  if (clients.length === 0) return <div className="app-shell" data-theme={theme}><OnboardingScreen onSubmit={completeOnboarding} /><ToastHost /><GlobalStyle /></div>;
  if (clientLoadError) return (
    <div className="app-shell" data-theme={theme}>
      <ConnectionErrorScreen onRetry={loadActiveClient} onSignOut={onSignOut} />
      <ToastHost /><GlobalStyle />
    </div>
  );
  if (!client) return <div className="app-shell" data-theme={theme}><LoadingState /><ToastHost /><GlobalStyle /></div>;

  // Athletes whose profile predates the waiver reach this and go no further.
  // There is no way past it except signing, and no way around it except signing
  // out — the whole point is that nobody trains on an unsigned account.
  //
  // The coach is exempt, and has to be. He switches between the client records
  // he keeps on their behalf, and gating those would both trap him behind a
  // record he can't leave and ask him to sign in someone else's name. Athletes
  // who signed up themselves own their own account and are gated normally.
  if (!isCoach && !client.waiver) {
    return (
      <div className="app-shell" data-theme={theme}>
        <WaiverModal
          dismissible={false}
          defaultName={client.name && client.name !== "Athlete" ? client.name : [client.firstName, client.lastName].filter(Boolean).join(" ")}
          onAccept={async ({ signature }) => {
            // A signed release that only exists in local state is not a record.
            // If the write fails the gate stays shut and the modal stays open.
            const signed = { ...client, waiver: { at: new Date().toISOString(), version: WAIVER_VERSION, signature, name: client.name || "" } };
            const saved = await setClient(userId, signed.id, signed);
            if (!saved || saved.ok === false) {
              emitToast({ kind: "error", message: "Couldn't save your signature — check your connection and try again.", autoDismissMs: 7000 });
              return false;
            }
            setClientState(signed);
            return true;
          }}
          onClose={undefined}
          intro={(
            <div className="intent-box" style={{ marginBottom: 14 }}>
              Your program is waiting. Before you train again, read this and sign it — it is a one-time thing and it does not change anything about your training.
            </div>
          )}
          footer={(
            <button className="btn-ghost wide" style={{ marginTop: 12 }} onClick={onSignOut}>Sign out instead</button>
          )} />
        <ToastHost />
        <GlobalStyle />
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={theme} style={{ "--belt-glow": BELT_COLORS[client.beltLevel] || BELT_COLORS.White }}>
      <TopBar client={client} isCoach={isCoach} newSignupCount={newSignupCount} onOpenClients={() => setShowClients(true)} onOpenSettings={() => setShowSettings(true)} onOpenPayment={() => setShowPayment(true)} onOpenCalculator={() => setShowCalculator(true)} onOpenDashboard={() => setShowDashboard(true)} onOpenHelp={() => setShowTutorial(true)} onOpenCoachDashboard={() => setShowCoachDashboard(true)} onOpenShare={() => setShowShare(true)} />
      <div className="scroll-area">
        {tab === "today" && (
          <TodayTab client={client} onPersist={persistClient}
            onStartLog={(phaseId, dayId) => setLogging({ phaseId, dayId })}
            onStartMobility={() => setShowMobility(true)} />
        )}
        {tab === "program" && <ProgramTab client={client} onPersist={persistClient} />}
        {tab === "history" && <HistoryTab client={client} onPersist={persistClient} />}
        {tab === "bjj" && <BJJNotesTab client={client} onPersist={persistClient} />}
        {tab === "progress" && <ProgressTab client={client} />}
        {tab === "prs" && <PRsTab client={client} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
      <ToastHost />
      {showClients && (
        <ClientsModal clients={clients} activeId={activeId}
          onSelect={(id) => { setActiveId(id); setShowClients(false); }}
          onAdd={addClient} onDelete={deleteClient} onClose={() => setShowClients(false)} />
      )}
      {showSettings && <SettingsModal client={client} isCoach={isCoach} onPersist={persistClient} theme={theme} onChangeTheme={changeTheme} onClose={() => setShowSettings(false)} onResetApp={resetAppData} onRefreshProgram={refreshProgramTemplate} onOpenCoachDashboard={() => { setShowSettings(false); setShowCoachDashboard(true); }} onOpenTerms={() => { setShowSettings(false); setShowTerms(true); }} onSignOut={onSignOut} />}
      {showCoachDashboard && isCoach && <CoachDashboard userId={userId} isCoach={isCoach} clients={clients} activeId={activeId} onPersistActive={persistClient} onSignupsReviewed={refreshNewSignups} onClose={() => setShowCoachDashboard(false)} />}
      {showPayment && <PaymentModal onClose={() => setShowPayment(false)} />}
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
      {showSafety && (
        <SafetyScreenModal onClose={async () => {
          setShowSafety(false);
          if (client && !client.hasSeenSafety) await persistClient({ ...client, hasSeenSafety: true });
        }} />
      )}
      {showTutorial && (
        <TutorialModal onClose={async () => {
          setShowTutorial(false);
          if (!client.hasSeenTutorial) await persistClient({ ...client, hasSeenTutorial: true });
        }} />
      )}
      {showCalculator && <OneRepMaxCalculator onClose={() => setShowCalculator(false)} />}
      {showShare && <ShareModal onClose={() => setShowShare(false)} />}
      {showDashboard && <ClientDashboard client={client} onClose={() => setShowDashboard(false)} />}
      {logging && (
        <DaySessionScreen client={client} isCoach={isCoach} phaseId={logging.phaseId} dayId={logging.dayId} onClose={() => setLogging(null)}
          onStartMobility={() => setShowMobility(true)}
          onUpdateProgram={(newProgram) => persistClient({ ...client, program: newProgram })}
          onSave={async (session) => {
            // Local state updates before the write lands, so a save that failed
            // and is then retried arrives here with a session already in logs.
            // Match on id so the retry re-sends rather than logging it twice.
            if (client.logs.some((l) => l.id === session.id)) {
              const merged = { ...client, logs: client.logs.map((l) => (l.id === session.id ? session : l)) };
              return persistClient(merged);
            }
            const nextCompleted = (client.sessionsCompleted || 0) + 1;
            const updated = { ...client, logs: [...client.logs, session], sessionsCompleted: nextCompleted,
              maxSessionsReached: Math.max(client.maxSessionsReached || 0, nextCompleted) };
            return persistClient(updated);
          }}
          onRecordPR={async (entry) => {
            const newRecord = { id: uid(), date: todayStr(), ...entry };
            const updated = { ...client, prLog: [...(client.prLog || []), newRecord] };
            await persistClient(updated);
            return newRecord;
          }}
          onRemovePR={async (recordId) => {
            const updated = { ...client, prLog: (client.prLog || []).filter((p) => p.id !== recordId) };
            await persistClient(updated);
          }}
          onRestartProgram={async () => {
            const updated = { ...client, sessionsCompleted: 0, blockNumber: (client.blockNumber || 1) + 1 };
            await persistClient(updated);
          }} />
      )}
      {showMobility && (
        <MobilitySession client={client} isCoach={isCoach} onClose={() => setShowMobility(false)}
          onUpdateProgram={(newProgram) => persistClient({ ...client, program: newProgram })}
          onSave={async (entry) => {
            const updated = { ...client, mobilityLogs: [...(client.mobilityLogs || []), entry] };
            await persistClient(updated);
          }} />
      )}
      <GlobalStyle />
    </div>
  );
}

/* ============================== ONBOARDING ============================== */

function OnboardingScreen({ onSubmit }) {
  const [showWaiver, setShowWaiver] = useState(false);
  const [waiver, setWaiver] = useState(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [weight, setWeight] = useState("");
  const [heightFeet, setHeightFeet] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [beltLevel, setBeltLevel] = useState("White");
  const [schedule, setSchedule] = useState(defaultWeeklySchedule());
  const [programVariant, setProgramVariant] = useState("B");
  const [injuryNotes, setInjuryNotes] = useState("");
  const [injuryAreas, setInjuryAreas] = useState([]);
  const [logoImageOk, setLogoImageOk] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [picError, setPicError] = useState("");
  const canSubmit = firstName.trim() && lastName.trim() && weight;
  const handlePictureUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPicError("");
    setUploadingPic(true);
    processProfilePictureFile(file)
      .then((dataUrl) => { setProfilePicture(dataUrl); setUploadingPic(false); })
      .catch((err) => { setPicError(err.message); setUploadingPic(false); });
  };

  return (
    <div className="pad" style={{ paddingTop: 40, maxWidth: 420, margin: "0 auto" }}>
      <div className="logo-block">
        {logoImageOk && <img src="/kc-logo.png" alt="" className="logo-image" onError={() => setLogoImageOk(false)} />}
        <BrandLockup />
      </div>
      <div className="program-title" style={{ fontSize: 20, marginBottom: 4 }}>Welcome to Strength Matrix</div>
      <p className="muted" style={{ marginBottom: 8 }}>A strength and conditioning system built specifically for Brazilian Jiu-Jitsu and wrestling — every phase, lift, and rep scheme mapped out in advance so there's no guesswork about what to do or why. Strategically built around what a grappler actually needs: real strength, explosive power, durability that holds up under bad positions, and conditioning that doesn't gas out in a hard round.</p>
      <p className="muted" style={{ marginBottom: 20, fontSize: 12.5 }}>Set up your profile below to get started.</p>
      <h3 className="log-exercise-name" style={{ marginBottom: 6 }}>Profile Picture</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div className="settings-avatar-preview">
          {profilePicture ? <img src={profilePicture} alt="" /> : <span>{(firstName || "?").trim().charAt(0).toUpperCase()}</span>}
        </div>
        <div style={{ flex: 1 }}>
          <label className="btn-ghost" style={{ display: "inline-block", cursor: "pointer" }}>
            {uploadingPic ? "Uploading…" : profilePicture ? "Change Picture" : "Upload Picture"}
            <input type="file" accept="image/*" onChange={handlePictureUpload} style={{ display: "none" }} disabled={uploadingPic} />
          </label>
          {profilePicture && <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setProfilePicture(null)}>Remove</button>}
          {picError && <p className="muted" style={{ color: "var(--accent)", fontSize: 12, marginTop: 6 }}>{picError}</p>}
        </div>
      </div>
      <LabeledInput label="First name" value={firstName} onChange={setFirstName} />
      <LabeledInput label="Last name" value={lastName} onChange={setLastName} />
      <LabeledInput label="Bodyweight (pounds)" type="number" step="0.1" inputMode="decimal" min="1" max="600" value={weight} onChange={setWeight} />
      <div className="edit-ex-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <LabeledInput label="Height — feet" type="number" min="0" max="8" value={heightFeet} onChange={setHeightFeet} />
        <LabeledInput label="Height — inches" type="number" min="0" max="11" value={heightInches} onChange={setHeightInches} />
      </div>
      <label className="labeled-input">
        <span>Brazilian Jiu-Jitsu belt level</span>
        <select className="select-input" value={beltLevel} onChange={(e) => setBeltLevel(e.target.value)}>
          {BELT_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <h3 className="log-exercise-name" style={{ marginTop: 18, marginBottom: 4 }}>Your Weekly Training Schedule</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Tap what you do on each day — Low Intensity BJJ, High Intensity BJJ, Strength/Conditioning, any combination, or leave a day blank. You can change this any time in Settings.</p>
      <WeeklyScheduleEditor schedule={schedule} onChange={setSchedule} />
      <h3 className="log-exercise-name" style={{ marginTop: 18, marginBottom: 4 }}>One thing before you start</h3>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        The speed-work sets are prescribed as a percentage of your one-rep max on the bench press and the trap bar deadlift. You do not need to go test either one — take your best recent heavy set of three to five reps and add about fifteen percent, and that is close enough to start. Week 8 is a good point to re-estimate, because by then the original number will be stale and the speed work will have drifted light.
      </p>

      <h3 className="log-exercise-name" style={{ marginTop: 18, marginBottom: 4 }}>Choose Your Program</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Not sure? Pick either — you can switch anytime in Settings.</p>
      <div role="radiogroup" aria-label="Choose Your Program">
      <div className={`program-choice-card ${programVariant === "A" ? "active" : ""}`} onClick={() => setProgramVariant("A")} role="radio" aria-checked={programVariant === "A"} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProgramVariant("A"); } }}>
        <div className="program-choice-title">Program A — Condensed Conjugate</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>3 days a week. Every session pairs a true Max Effort lift with a fast Dynamic Effort lift, so a full week of strength and speed work fits in three sessions. Includes a real taper into a fresh, heavy peak the final three weeks. Best if you're actively competing or training grappling 3 to 5 times a week.</p>
      </div>
      <div className={`program-choice-card ${programVariant === "B" ? "active" : ""}`} onClick={() => setProgramVariant("B")} role="radio" aria-checked={programVariant === "B"} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProgramVariant("B"); } }}>
        <div className="program-choice-title">Program B — Offseason Strength Build</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>3 days a week, built on Rate of Perceived Exertion and tempo-controlled supersets instead of a fixed percentage of your max. Every phase just keeps building — nothing tapers off. Best for stretches with no competition on the calendar, when getting as strong as possible is the only goal.</p>
      </div>
      <div className={`program-choice-card ${programVariant === "C" ? "active" : ""}`} onClick={() => setProgramVariant("C")} role="radio" aria-checked={programVariant === "C"} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProgramVariant("C"); } }}>
        <div className="program-choice-title">Program C — Two-Day Hybrid</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>2 days a week — built for a packed mat schedule with no room for a 3rd lifting day. Each session pairs a Max Effort lift with a Dynamic Effort lift like Program A, with slightly more work per session to make up for it. Best if you're training grappling 4 or more times a week.</p>
      </div>
      </div>
      <h3 className="log-exercise-name" style={{ marginTop: 18, marginBottom: 4 }}>Anything We Should Work Around?</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Optional — a bad shoulder, a cranky knee, anything recent. Not a medical form, just context your coach can see and you can update anytime in Settings.</p>
      <textarea className="notes-box" rows={2} style={{ fontSize: 13, marginBottom: 14 }} value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} placeholder="For example: left shoulder is a little cranky overhead right now" />
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>If any of these are sore right now, tap them — the program will swap the exercises that aggravate them. You can change this any time in Settings.</p>
      <InjuryAreaPicker value={injuryAreas} onChange={setInjuryAreas} />
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 14, fontStyle: "italic" }}>Substitutions are a way to keep training around a sore area, not treatment. Anything sharp, swollen, or not improving belongs with a clinician first.</p>
      <h3 className="log-exercise-name" style={{ marginTop: 18, marginBottom: 4 }}>Before You Start</h3>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        This program includes heavy, near-maximal lifting done on your own. You have to read and accept the
        assumption of risk and release of liability before a program can be created for you.
      </p>
      {waiver ? (
        <div className="intent-box" style={{ marginBottom: 10 }}>
          Signed by {waiver.signature} on {fmtDateTime(waiver.at)}.{" "}
          <button type="button" className="link-btn" onClick={() => setShowWaiver(true)}>Read it again</button>
        </div>
      ) : (
        <button type="button" className="btn-ghost wide" style={{ marginBottom: 10 }} onClick={() => setShowWaiver(true)}>
          Read and accept the liability waiver
        </button>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        By creating this profile you also agree to our <button type="button" className="link-btn" onClick={() => setShowTerms(true)}>Terms &amp; Privacy</button>.
      </p>
      <button className="btn-primary wide" style={{ marginTop: 10 }} disabled={!canSubmit || !waiver}
        onClick={() => onSubmit({ firstName: firstName.trim(), lastName: lastName.trim(), weight: Number(weight) || 0, heightFeet: Number(heightFeet) || 0, heightInches: Number(heightInches) || 0, beltLevel, programVariant, injuryNotes, injuryAreas, profilePicture, weeklySchedule: schedule, waiver })}>
        Get started
      </button>
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
      {showWaiver && (
        <WaiverModal
          onClose={() => setShowWaiver(false)}
          accepted={waiver}
          defaultName={`${firstName.trim()} ${lastName.trim()}`.trim()}
          onAccept={({ signature }) => { setWaiver({ at: new Date().toISOString(), version: WAIVER_VERSION, signature, name: `${firstName.trim()} ${lastName.trim()}`.trim() }); setShowWaiver(false); }}
        />
      )}
    </div>
  );
}

function PaymentModal({ onClose }) {
  const [qrOk, setQrOk] = useState(true);
  const hasAnything = coachVenmo || coachCashApp || coachPaymentLink || qrOk;
  return (
    <ModalShell onClose={onClose} title="Payment">
      {hasAnything ? (
        <Card title="Pay your coach">
          <div style={{ textAlign: "center" }}>
            {qrOk && (
              coachPaymentLink ? (
                <a href={coachPaymentLink} target="_blank" rel="noopener noreferrer">
                  <img src="/payment-qr.png" alt="Payment QR code — tap to pay" style={{ width: 200, height: 200, objectFit: "contain", margin: "0 auto 12px", display: "block", borderRadius: 8, background: "#fff" }} onError={() => setQrOk(false)} />
                </a>
              ) : (
                <img src="/payment-qr.png" alt="Payment QR code" style={{ width: 200, height: 200, objectFit: "contain", margin: "0 auto 12px", display: "block", borderRadius: 8, background: "#fff" }} onError={() => setQrOk(false)} />
              )
            )}
            {coachVenmo && <div style={{ fontSize: 14.5, marginBottom: 6 }}>Venmo: <strong>{coachVenmo}</strong></div>}
            {coachCashApp && <div style={{ fontSize: 14.5, marginBottom: coachPaymentLink ? 12 : 0 }}>Cash App: <strong>{coachCashApp}</strong></div>}
            {coachPaymentLink && <a className="btn-primary wide" style={{ textDecoration: "none", display: "block" }} href={coachPaymentLink} target="_blank" rel="noopener noreferrer">Open Payment Link</a>}
          </div>
        </Card>
      ) : (
        <EmptyState text="No payment details are set up yet — ask your coach how they'd like to be paid." />
      )}
      <p className="muted" style={{ fontSize: 12.5 }}>
        Payment is handled directly between you and your coach through Venmo or Cash App. This app never sees, processes or stores a card or bank account number.
      </p>
    </ModalShell>
  );
}

// A plain barbell glyph — a generic strength symbol drawn from scratch, so the
// header reads as a brand mark without borrowing anyone else's.
// The wordmark, centred, for the sign-in and profile-setup screens. The header
// lays the same pieces out inline instead, because it sits on one line.
function BrandLockup() {
  return (
    <div className="brand-lockup">
      <div className="brand-lockup-word">Strength</div>
      <div className="brand-lockup-rule"><span className="brand-rule-line" /><span className="brand-sub">Matrix</span><span className="brand-rule-line" /></div>
    </div>
  );
}

function TopBar({ client, isCoach, newSignupCount = 0, onOpenClients, onOpenSettings, onOpenPayment, onOpenCalculator, onOpenDashboard, onOpenHelp, onOpenCoachDashboard, onOpenShare }) {
  return (
    <div className="topbar">
      <div className="brand-block">
        <div className="brand-stack">
          <div className="brand-word">Strength</div>
          <div className="brand-rule"><span className="brand-rule-line" /><span className="brand-sub">Matrix</span><span className="brand-rule-line" /></div>
        </div>
      </div>
      <button className="topbar-avatar-btn" onClick={onOpenSettings} aria-label="Edit profile picture">
        {client.profilePicture ? (
          <img src={client.profilePicture} alt="" className="topbar-avatar-img" />
        ) : (
          <span className="topbar-avatar-fallback">{(client.name || "?").trim().charAt(0).toUpperCase()}</span>
        )}
      </button>
      <div className="topbar-icons">
        <div style={{ display: "flex", gap: 6 }}>
          <button className="icon-btn" onClick={onOpenShare} aria-label="Share Strength Matrix with a friend"><Share2 size={20} /></button>
          {isCoach && (
            <button className="icon-btn icon-btn-badged" onClick={onOpenCoachDashboard}
              aria-label={newSignupCount > 0 ? `Coach Dashboard — ${newSignupCount} new sign-up${newSignupCount === 1 ? "" : "s"} to review` : "Coach Dashboard"}>
              <LayoutDashboard size={20} />
              {newSignupCount > 0 && <span className="icon-badge">{newSignupCount > 9 ? "9+" : newSignupCount}</span>}
            </button>
          )}
          <button className="icon-btn" onClick={onOpenHelp} aria-label="Help and glossary"><HelpCircle size={20} /></button>
          <button className="icon-btn" onClick={onOpenCalculator} aria-label="One-Rep Max and Rate of Perceived Exertion calculator"><Calculator size={20} /></button>
        </div>
        <div style={{ width: 1, background: "var(--border)", margin: "6px 2px" }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="icon-btn" onClick={onOpenPayment} aria-label="Payment information"><DollarSign size={20} /></button>
          <button className="icon-btn" onClick={onOpenSettings} aria-label="Settings"><SettingsIcon size={20} /></button>
          <button className="icon-btn" onClick={onOpenClients} aria-label="Switch client"><Users size={20} /></button>
        </div>
      </div>
    </div>
  );
}

const TUTORIAL_PAGES = [
  { title: "Welcome", body: "This app runs a twelve-week conjugate strength program built specifically for grapplers. A handful of terms show up throughout it — here's what they actually mean, in plain language, before you dive in." },
  { title: "Max Effort", body: "A day where you build up to the heaviest weight you can honestly lift for a single rep or a few reps, that day. It isn't a fixed number written in advance — you find it based on how you feel." },
  { title: "Dynamic Effort", body: "Using a lighter weight and moving it as explosively as possible. This is about building speed and power, not raw strength — the weight is intentionally light so you can move it fast." },
  { title: "Reps in Reserve", body: "How many more reps you could have done before failing. Zero reps in reserve means you truly couldn't have done another rep — that's a genuine maximum effort. Two or three reps in reserve is a comfortably hard set." },
  { title: "Rate of Perceived Exertion", body: "A one-to-ten scale for how hard a set felt, with ten being an all-out maximum. This app calculates it automatically from your reps in reserve, so you never have to think about the two separately." },
  { title: "One-Rep Max Calculator", body: "Tap the calculator icon next to the help button at the top of the screen any time. Enter a weight you lifted, how many reps you got with it, and your reps in reserve, and it estimates your true one-rep max and shows you exact weights for every percentage of it — handy for planning a lift without doing the math yourself." },
  { title: "Deload Week", body: "Every fourth week, the program automatically gets lighter on purpose — lower volume, no true max attempts. It's built-in recovery, not a step backward, and it happens whether you ask for it or not." },
  { title: "Daily Readiness Check-In", body: "Two quick questions each day: how you slept, and how ready you feel to train. Based on your answers, the app automatically adjusts that day's workout — trimming volume or dropping entire sections when you actually need it." },
  { title: "Put It On Your Home Screen", body: "Do this once and the app sits on your home screen with its own icon, opening full screen with no browser bar — the same as any app you'd download. On iPhone, open this page in Safari, tap the Share button at the bottom, scroll down and tap Add to Home Screen. On Android, tap the three dots at the top right of Chrome and tap Add to Home screen. Step-by-step instructions for every phone are in Settings under Put This App On Your Home Screen." },
];

/* ============================== LIABILITY WAIVER ============================== */
// Versioned on purpose: the stored record says which wording someone agreed to,
// so editing the text later cannot quietly rewrite what past clients signed.
const WAIVER_VERSION = "2026-09-24";
const WAIVER_TITLE = "Assumption of Risk and Release of Liability";
const WAIVER_SECTIONS = [
  { heading: "What you are agreeing to",
    body: "Read this before you set up your profile. It is a legal agreement between you and your coach. If you do not agree to it, do not use this app." },
  { heading: "Strength training carries real risk",
    body: "This program prescribes heavy resistance training, including near-maximal single-rep lifts, jumping and landing, maximal sprinting, loaded carries, neck training, and conditioning work. Activities like these carry a risk of injury that cannot be designed away. That includes muscle strains, joint and ligament damage, broken bones, concussion and other head or spinal injury, heart attack or stroke, permanent disability, and death. You may also be training for a contact sport, which carries its own separate risks that this agreement does not cover." },
  { heading: "You are choosing to take that risk",
    body: "You are taking part voluntarily. You confirm that you are medically able to train, that you have had any condition or injury checked by a physician if there is any doubt, and that you will stop immediately and seek medical attention if anything hurts, feels wrong, or does not settle. You understand and knowingly accept all risks of taking part, both the ones described above and the ones that cannot be foreseen." },
  { heading: "You are training on your own, unsupervised",
    body: "This app gives you a written program. It cannot see you, it cannot watch your technique, and it knows nothing about you that you have not typed into it. It is not a substitute for in-person coaching, and it is not medical, physiotherapy, or diagnostic advice. You are responsible for your own equipment, your own training environment, how much weight you choose to use, and whether a given session is right for you on the day." },
  { heading: "Release",
    body: "To the fullest extent the law allows, you release your coach from any claim, demand, or cause of action for injury, illness, disability, death, or property loss arising out of your use of this app or your participation in the training it prescribes, including claims based on ordinary negligence. You agree not to bring such a claim, and you accept responsibility for your own losses. This release does not cover gross negligence, recklessness, or intentional misconduct, and it does not waive any right that cannot lawfully be waived." },
  { heading: "If part of this does not hold",
    body: "If a court finds any part of this agreement unenforceable, the rest of it stays in force. This agreement is governed by the laws of the State of Washington and binds your heirs and anyone acting on your behalf." },
  { heading: "Signing it",
    body: "Typing your full legal name in the signature field below is your signature on this agreement, and you intend it to have the same effect as signing it by hand. By signing, you confirm that you are at least 18 years old, that you have read and understood this agreement, that nobody pressured you into it, and that you are knowingly giving up substantial legal rights. Your signature, the date and time you sign, and the version of this wording are recorded against your profile, and your coach keeps a copy of that record." },
];

// The signature block. Typing your own name into it is the act of signing — so it
// is rendered in a hand it would be signed in, over a rule, with the date beside
// it, the way it would look on paper.
function SignatureBlock({ value, onChange, dated }) {
  return (
    <div className="sig-block">
      <label className="sig-label" htmlFor="waiver-signature">Sign your full legal name</label>
      <input
        id="waiver-signature"
        className="sig-input"
        type="text"
        autoComplete="name"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your full name"
        aria-describedby="waiver-signature-help" />
      <div className="sig-rule" />
      <div className="sig-foot">
        <span id="waiver-signature-help">Electronic signature</span>
        <span>{dated}</span>
      </div>
    </div>
  );
}

function WaiverModal({ onClose, onAccept, accepted, defaultName = "", dismissible = true, intro = null, footer = null }) {
  const [ticked, setTicked] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState(defaultName);
  const signedName = signature.trim();
  // Two words, or one long enough to be a name. Enough to stop an empty stroke
  // or a stray keypress counting as a signature, without turning away anyone
  // whose legal name is short or spelled a way we did not anticipate.
  const signatureOk = signedName.length >= 3 && /[a-z]/i.test(signedName);
  const today = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
  return (
    <ModalShell onClose={onClose} title={WAIVER_TITLE} dismissOnEscape={dismissible} hideClose={!dismissible}>
      {intro}
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>Version {WAIVER_VERSION}</p>
      {WAIVER_SECTIONS.map((s) => (
        <div key={s.heading} style={{ marginBottom: 16 }}>
          <h3 className="log-exercise-name" style={{ marginBottom: 5 }}>{s.heading}</h3>
          <p className="muted" style={{ marginBottom: 0, lineHeight: 1.55 }}>{s.body}</p>
        </div>
      ))}
      {accepted && accepted.at ? (
        <div className="sig-block signed">
          <div className="sig-label">Signed</div>
          <div className="sig-signed">{accepted.signature || accepted.name || "Signed electronically"}</div>
          <div className="sig-rule" />
          <div className="sig-foot">
            <span>Electronic signature</span>
            <span>{fmtDateTime(accepted.at)}</span>
          </div>
          {accepted.version && accepted.version !== WAIVER_VERSION && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>Signed against version {accepted.version}.</p>
          )}
        </div>
      ) : onAccept ? (
        <>
          <label className="bjj-toggle" style={{ marginTop: 6, alignItems: "flex-start" }}>
            <input type="checkbox" checked={ticked} onChange={() => setTicked((v) => !v)} />
            <span>I am 18 or older. I have read and understood this agreement, I accept the risks, and I agree to the release above.</span>
          </label>
          <SignatureBlock value={signature} onChange={setSignature} dated={today} />
          <button className="btn-primary wide" style={{ marginTop: 14 }} disabled={!ticked || !signatureOk || signing}
            onClick={async () => {
              setSigning(true);
              const ok = await onAccept({ signature: signedName });
              // `false` means the write failed — stay on this screen so the
              // athlete can retry rather than believing they've signed.
              if (ok === false) setSigning(false);
            }}>
            {signing ? "Saving…" : "Sign and continue"}
          </button>
          {!signatureOk && ticked && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: "center" }}>Type your full name above to sign.</p>
          )}
          {footer}
        </>
      ) : null}
    </ModalShell>
  );
}


const TERMS_SECTIONS = [
  { heading: "What this app is", body: "Strength Matrix is a personal strength and conditioning coaching tool operated by Kyle Cox for his own training clients. It isn't a general-purpose fitness product offered to the public at large." },
  { heading: "Your data", body: "The app stores what it needs to run your program: your name, your bodyweight entries, your workout logs, your daily readiness check-ins, your personal records, the profile picture you upload, the class notes you write, and anything you choose to type into the injury notes box. It's used only to run and personalize your training — it's never sold, and it isn't shared with anyone outside your coach without your permission." },
  { heading: "Payment", body: "The fee is a one-time payment, due once you have finished your first week of sessions. There is no subscription and no recurring charge — you are not billed again, on this twelve-week block or any future one. Payment goes directly to your coach; this app does not process, transmit, or store card or bank account numbers, and it cannot charge you. Because the whole program is yours as soon as it unlocks, the fee is not automatically refundable — but if something is wrong, tell your coach and he will sort it out with you. There is nothing to cancel: if you stop training, nothing further is charged, and everything you have logged stays in your account." },
  { heading: "Not medical advice", body: "This program is coaching, not medical care. It can't account for an injury, a medical condition, or anything else your coach doesn't know about, so tell your coach about anything relevant and check with a physician before starting if you have any doubt at all. If something hurts during a session, stop — the app adjusts for how you feel, but it can't see you. Heavy resistance training, including the near-maximal single-rep lifts this program prescribes, carries a real risk of injury. By using this app you confirm you are medically cleared to train and you accept that risk as your own." },
  { heading: "Your data, your call", body: "You can download everything you have logged at any time from Settings — it is a plain file that is yours to keep. To have your account and its data permanently deleted, ask your coach and it will be done." },
  { heading: "Changes", body: "These terms may be updated from time to time as the app changes. The current version is always available here in Settings." },
];

function TermsModal({ onClose }) {
  return (
    <ModalShell onClose={onClose} title="Terms & Privacy">
      <p className="muted" style={{ marginBottom: 16 }}>A short, plain-language summary — not a substitute for a lawyer's advice, just an honest explanation of how this app handles your information.</p>
      {TERMS_SECTIONS.map((s) => (
        <div key={s.heading} className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>{s.heading}</div>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 0 }}>{s.body}</p>
        </div>
      ))}
      <button className="btn-primary wide" style={{ marginTop: 4 }} onClick={onClose}>Close</button>
    </ModalShell>
  );
}

function smsHref(text) {
  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent || "");
  const encoded = encodeURIComponent(text);
  return isIOS ? `sms:&body=${encoded}` : `sms:?body=${encoded}`;
}
function ShareModal({ onClose }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? window.location.origin : "";
  const shareText = "Strength Matrix is a strength and conditioning program built for BJJ and wrestling. Get started here:";
  const fullMessage = `${shareText} ${shareUrl}`;
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: "Strength Matrix", text: shareText, url: shareUrl });
    } catch (err) {
      // The person canceled the share sheet or it failed silently — nothing to surface here.
    }
  };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopied(true);
      emitToast({ message: "Link copied", autoDismissMs: 2500 });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      emitToast({ kind: "error", message: "Couldn't copy the link — try selecting it manually.", autoDismissMs: 4000 });
    }
  };

  return (
    <ModalShell onClose={onClose} title="Share Strength Matrix">
      <p className="muted" style={{ marginBottom: 16 }}>Invite a friend to train with you — they'll get their own account and can pick their own program.</p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Your invite link</div>
        <p className="muted" style={{ fontSize: 13.5, wordBreak: "break-all", marginBottom: 0 }}>{shareUrl}</p>
      </div>
      {canNativeShare && (
        <button className="btn-primary wide" style={{ marginBottom: 10 }} onClick={handleNativeShare}>Share</button>
      )}
      <a className="btn-ghost wide" style={{ marginTop: 0, marginBottom: 10, justifyContent: "center", textDecoration: "none" }} href={smsHref(fullMessage)}>Text a Friend</a>
      <button className="btn-ghost wide" style={{ marginTop: 0 }} onClick={handleCopy}>{copied ? "Copied!" : "Copy Link"}</button>
    </ModalShell>
  );
}
function TutorialModal({ onClose }) {
  const [page, setPage] = useState(0);
  const isLast = page === TUTORIAL_PAGES.length - 1;
  const current = TUTORIAL_PAGES[page];
  return (
    <ModalShell onClose={onClose} title="Quick Start Guide">
      <div className="card" style={{ textAlign: "center", padding: 28 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>{current.title}</div>
        <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6 }}>{current.body}</p>
      </div>
      <div className="muted" style={{ textAlign: "center", marginBottom: 14, fontSize: 12 }}>{page + 1} of {TUTORIAL_PAGES.length} — reopen this any time from the help button</div>
      <div style={{ display: "flex", gap: 8 }}>
        {page > 0 && <button className="btn-ghost" style={{ flex: 1, marginTop: 0, justifyContent: "center" }} onClick={() => setPage((p) => p - 1)}>Back</button>}
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => (isLast ? onClose() : setPage((p) => p + 1))}>{isLast ? "Let's Start Training" : "Next"}</button>
      </div>
    </ModalShell>
  );
}

/* ============================== METRIC VISUALS ============================== */
// A ring gauge. The track is a dim step of the fill's own hue so the unfilled
// portion still reads as part of the same scale rather than as empty chrome.
function MetricRing({ value, max = 100, label, sublabel, color = "var(--accent)", size = 92, display }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${label}: ${display !== undefined ? display : Math.round(pct * 100) + "%"}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} opacity="0.16" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" className="ring-value" textAnchor="middle" dominantBaseline="central">
          {display !== undefined ? display : `${Math.round(pct * 100)}%`}
        </text>
      </svg>
      <div className="ring-label">{label}</div>
      {sublabel ? <div className="ring-sub">{sublabel}</div> : null}
    </div>
  );
}

// A flat metric tile. The colour rides a bar beside the number, never the text
// itself — a light hue is illegible as type on this surface.
function MetricTile({ label, value, sub, color = "var(--accent)" }) {
  return (
    <div className="metric-tile">
      <span className="metric-tile-bar" style={{ background: color }} />
      <div className="metric-tile-body">
        <div className="metric-tile-label">{label}</div>
        <div className="metric-tile-value">{value}</div>
        {sub ? <div className="metric-tile-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

// Wearable-shaped strip. Today it carries the daily check-in; when a ring is
// connected the same component takes that source's numbers instead, so adding
// one later is a data swap rather than a layout change.
function WearableStrip({ source, dateLabel, metrics }) {
  if (!metrics || !metrics.length) return null;
  return (
    <div className="wearable-strip">
      <div className="wearable-head">
        <span className="wearable-source">{source}</span>
        <span className="wearable-date">{dateLabel}</span>
      </div>
      <div className="wearable-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="wearable-metric">
            <div className="wearable-metric-label">{m.label}</div>
            <div className="wearable-metric-value">{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// One series, so no legend: the card title says what is plotted. Hairline axis,
// no gridlines, a 10% wash under a 2px line, and only the last point labelled.
function TrendArea({ data, dataKey, color = "var(--accent)", height = 170, domain = ["auto", "auto"], valueFormat = (v) => v, unit = "" }) {
  const gid = `grad-${dataKey}-${String(color).replace(/[^a-z0-9]/gi, "")}`;
  const last = data.length ? data[data.length - 1] : null;
  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" stroke="var(--border)" tick={{ fill: "var(--text-dim)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} tickFormatter={fmtChartDate} />
            <YAxis stroke="var(--border)" tick={{ fill: "var(--text-dim)", fontSize: 11 }} tickLine={false} axisLine={false} domain={domain} width={44} />
            <Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 13 }}
              labelStyle={{ color: "var(--text-dim)" }}
              labelFormatter={fmtChartDate}
              formatter={(v) => [`${valueFormat(v)}${unit}`, ""]} />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${gid})`}
              dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {last ? (
        <div className="chart-endlabel">
          <span className="chart-endlabel-dot" style={{ background: color }} />
          Latest: <strong>{valueFormat(last[dataKey])}{unit}</strong> on {fmtChartDate(last.date)}
        </div>
      ) : null}
    </>
  );
}

// Magnitude over a calendar, so one hue stepping light to dark. Deliberately not
// the green/amber/red set: those three sit close enough under red-green colour
// blindness that a grid of them is guesswork.
function TrainingHeatmap({ logs, weeks = 16 }) {
  const byDate = {};
  (logs || []).forEach((l) => { byDate[l.date] = (byDate[l.date] || 0) + (l.totalVolume || 0); });
  const values = Object.values(byDate).filter((v) => v > 0);
  const peak = values.length ? Math.max(...values) : 0;
  const today = new Date(todayStr() + "T00:00:00");
  const end = new Date(today);
  end.setDate(end.getDate() + ((7 - ((end.getDay() === 0 ? 7 : end.getDay()))) % 7));
  const cells = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(end);
      day.setDate(day.getDate() - (w * 7) - (6 - d));
      const key = toLocalDateStr(day);
      const vol = byDate[key] || 0;
      const intensity = peak > 0 && vol > 0 ? 0.25 + 0.75 * (vol / peak) : 0;
      col.push({ key, vol, intensity, future: day > today });
    }
    cells.push(col);
  }
  const dayNames = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="heatmap">
      <div className="heatmap-grid">
        <div className="heatmap-days">
          {dayNames.map((d, i) => <span key={i} className="heatmap-dayname">{i % 2 === 0 ? d : ""}</span>)}
        </div>
        {cells.map((col, ci) => (
          <div key={ci} className="heatmap-col">
            {col.map((cell) => (
              <span key={cell.key}
                title={cell.vol ? `${cell.key}: ${Math.round(cell.vol).toLocaleString()} lb` : `${cell.key}: rest`}
                className={`heatmap-cell ${cell.intensity ? "" : "is-rest"}`}
                style={{ background: cell.intensity ? `color-mix(in srgb, var(--accent) ${Math.round(cell.intensity * 100)}%, var(--card))` : "var(--card)",
                         opacity: cell.future ? 0.3 : 1 }} />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Rest</span>
        <span className="heatmap-cell is-rest" />
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} className="heatmap-cell" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, var(--card))` }} />
        ))}
        <span>Heaviest</span>
      </div>
    </div>
  );
}

function DashStat({ label, value, wide }) {
  return (
    <div className={`dash-stat ${wide ? "wide" : ""}`}>
      <div className="dash-stat-value">{value}</div>
      <div className="dash-stat-label">{label}</div>
    </div>
  );
}

function ClientDashboard({ client, onClose }) {
  const perWeek = client.program.sessionsPerWeek || 3;
  const totalWeeks = Math.max(...client.program.phases.map((p) => p.weekEnd));
  const totalSessions = totalWeeks * perWeek;
  const pos = positionAtIndex(client.program, client.sessionsCompleted || 0);
  const completionPct = Math.min(100, Math.round(((client.sessionsCompleted || 0) / totalSessions) * 100));
  const totalWorkouts = client.logs.length;

  // Consecutive training WEEKS, not days. Every program here is two or three
  // sessions a week with rest days between, so a consecutive-day streak was
  // structurally impossible and sat at 1 forever — including for someone who
  // last trained in January.
  const mondayOf = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDay();
    d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
    return toLocalDateStr(d);
  };
  const logDates = Array.from(new Set(client.logs.map((l) => l.date))).sort().reverse();
  let streak = 0;
  if (logDates.length) {
    const weeks = Array.from(new Set(logDates.map(mondayOf))).sort().reverse();
    const thisWeek = mondayOf(todayStr());
    const lastWeekDate = new Date(thisWeek + "T00:00:00");
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeek = toLocalDateStr(lastWeekDate);
    // A streak stays alive through the current week until it's actually missed.
    if (weeks[0] === thisWeek || weeks[0] === lastWeek) {
      streak = 1;
      let cursor = new Date(weeks[0] + "T00:00:00");
      for (let i = 1; i < weeks.length; i++) {
        cursor.setDate(cursor.getDate() - 7);
        if (weeks[i] === toLocalDateStr(cursor)) streak++; else break;
      }
    }
  }

  const lastLog = client.logs.length ? client.logs[client.logs.length - 1] : null;
  const recentPRs = [...(client.prLog || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);

  return (
    <ModalShell onClose={onClose} title={client.name}>
      <div className="dash-grid">
        <DashStat label="Current Program" value={client.program.name} wide />
        <DashStat label="Training Phase" value={pos.phase.name} wide />
        <DashStat label="Program Start Date" value={fmtDate(client.createdAt)} />
        <DashStat label="Current Week" value={`Week ${pos.weekNumber} of ${totalWeeks}`} />
        <DashStat label="Block" value={`${client.blockNumber || 1}`} />
        <DashStat label="Total Workouts Completed" value={`${totalWorkouts}`} />
        <DashStat label="Workout Completion" value={`${completionPct} percent`} />
        <DashStat label="Training Streak" value={streak === 0 ? "—" : `${streak} week${streak === 1 ? "" : "s"}`} />
        <DashStat label="Last Workout" value={lastLog ? `${fmtDate(lastLog.date)} — Day ${lastLog.dayLabel}` : "None yet"} wide />
      </div>
      <div className="card">
        <h3 className="log-exercise-name" style={{ marginBottom: 8 }}>Overall Progress</h3>
        <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${completionPct}%` }} /></div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>{client.sessionsCompleted || 0} of {totalSessions} sessions completed this block.</p>
      </div>
      <div className="card">
        <h3 className="log-exercise-name" style={{ marginBottom: 8 }}>Personal Records</h3>
        {recentPRs.length === 0 ? <p className="muted">No Personal Records flagged yet — check the Personal Record box next to a set on the workout screen to start tracking them here.</p> : recentPRs.map((p) => (
          <div key={p.id} className="pr-history-row"><span>{p.exerciseName}</span><span>{p.weight ? `${p.weight} pounds × ` : ""}{p.reps} {exerciseUnit(p.exerciseName)} — {fmtDate(p.date)}</span></div>
        ))}
      </div>
    </ModalShell>
  );
}

function OneRepMaxCalculator({ onClose }) {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rir, setRir] = useState("");
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  const estMax = w && r ? est1RM(w, r) : null;
  const rpe = rir !== "" ? rpeFromRir(rir) : null;

  const percentRows = estMax ? [95, 90, 85, 80, 75, 70, 65, 60].map((pct) => ({ pct, weight: Math.round((estMax * pct) / 100) })) : [];

  return (
    <ModalShell onClose={onClose} title="One-Rep Max Calculator">
      <p className="muted" style={{ marginBottom: 14 }}>Enter a weight and how many reps you performed with it to estimate your One-Rep Max. Add how many more reps you had left in the tank (reps in reserve) to see the matching Rate of Perceived Exertion.</p>
      <LabeledInput label="Weight lifted (pounds)" type="number" step="0.1" inputMode="decimal" min="0" max="2000" value={weight} onChange={setWeight} />
      <LabeledInput label="Reps performed" type="number" min="0" max="100" value={reps} onChange={setReps} />
      <LabeledInput label="Reps in reserve (how many more reps you could have done)" type="number" min="0" max="10" value={rir} onChange={setRir} />

      {estMax !== null && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="finish-stat" style={{ padding: 14 }}>
            <div className="finish-stat-value">{estMax} pounds</div>
            <div className="finish-stat-label">Estimated One-Rep Max</div>
          </div>
          {rpe !== null && (
            <div className="muted" style={{ textAlign: "center", marginTop: 10 }}>
              At {rir} reps in reserve, that set was roughly a Rate of Perceived Exertion of <b style={{ color: "var(--accent)" }}>{rpe}</b> out of 10 (10 being an all-out maximum effort).
            </div>
          )}
        </div>
      )}

      {percentRows.length > 0 && (
        <div className="card">
          <h3 className="log-exercise-name" style={{ marginBottom: 8 }}>Suggested Training Weights</h3>
          {percentRows.map((row) => (
            <div key={row.pct} className="pr-history-row"><span>{row.pct} percent of your One-Rep Max</span><span>{row.weight} pounds</span></div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function BottomNav({ tab, setTab }) {
  return (
    <div className="bottom-nav">
      {TABS.map((t) => {
        const Icon = t.icon; const active = tab === t.id;
        return (
          <button key={t.id} className={`nav-btn ${active ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <Icon size={17} strokeWidth={active ? 2.4 : 1.8} /><span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Reads an uploaded image file, center-crops it to a 300x300 square, and resolves to a JPEG
// data URL. Shared by Settings (changing an existing client's picture) and onboarding (setting
// one before the client even exists yet, so there's no client to persist it to).
function processProfilePictureFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("No file selected.")); return; }
    if (!file.type.startsWith("image/")) { reject(new Error("Please choose an image file.")); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const size = 300;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("Couldn't read that image — try a different file."));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
// Clients are far more likely to actually train if the app is one tap away on
// the home screen rather than a bookmark they have to go looking for. The app
// already ships a web manifest and icons, so once added it opens full screen
// with no browser chrome, exactly like a downloaded app.
function InstallGuide() {
  const step = (n, text) => (
    <div key={n} style={{ display: "flex", gap: 10, marginBottom: 6 }}>
      <span style={{ color: "var(--accent)", fontWeight: 800, flexShrink: 0 }}>{n}</span>
      <span>{text}</span>
    </div>
  );
  return (
    <>
      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Put This App On Your Home Screen</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        Takes about fifteen seconds and you only do it once. Afterwards the app has its own icon on your home screen and opens full screen with no browser bar — the same as any app you would download from a store. Nothing to install, and it takes no real space on your phone.
      </p>

      <div className="adjust-box" style={{ borderColor: "var(--accent)", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>iPhone and iPad</div>
        {step(1, <>Open this page in <strong>Safari</strong>. This part matters — adding it from Chrome on an iPhone does not work the same way.</>)}
        {step(2, <>Tap the <strong>Share</strong> button at the bottom of the screen — the square with an arrow pointing up out of it.</>)}
        {step(3, <>Scroll down the list of options and tap <strong>Add to Home Screen</strong>.</>)}
        {step(4, <>Tap <strong>Add</strong> in the top right corner. The icon appears on your home screen.</>)}
      </div>

      <div className="adjust-box" style={{ borderColor: "var(--accent)", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Google Pixel and most Android phones (Chrome)</div>
        {step(1, <>Open this page in <strong>Chrome</strong>.</>)}
        {step(2, <>Tap the <strong>three dots</strong> in the top right corner.</>)}
        {step(3, <>Tap <strong>Add to Home screen</strong>. On some phones this says <strong>Install app</strong> instead — either one is correct.</>)}
        {step(4, <>Tap <strong>Install</strong> or <strong>Add</strong> to confirm.</>)}
      </div>

      <div className="adjust-box" style={{ borderColor: "var(--accent)", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Samsung phones (Samsung Internet)</div>
        {step(1, <>Open this page in <strong>Samsung Internet</strong>.</>)}
        {step(2, <>Tap the <strong>three lines</strong> at the bottom right corner.</>)}
        {step(3, <>Tap <strong>Add page to</strong>, then choose <strong>Home screen</strong>.</>)}
        {step(4, <>Tap <strong>Add</strong> to confirm.</>)}
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Samsung phones usually have both Chrome and Samsung Internet installed. Either browser works — use whichever you normally browse with, and follow that section.
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5 }}>
        Signed in already? Staying signed in is the whole point — once it is on your home screen you open it straight to today's session without logging in again.
      </p>
    </>
  );
}

// Shown only where the connection is actually available. An athlete whose coach
// has not set this up sees nothing at all, rather than a button that fails.


function SettingsModal({ client, isCoach, onPersist, theme, onChangeTheme, onClose, onResetApp, onRefreshProgram, onOpenCoachDashboard, onOpenTerms, onSignOut }) {
  const [confirmingAppReset, setConfirmingAppReset] = useState(false);
  const [showWaiverCopy, setShowWaiverCopy] = useState(false);
  const [showWeightCut, setShowWeightCut] = useState(false);
  const [showSafetyCopy, setShowSafetyCopy] = useState(false);
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [schedule, setSchedule] = useState(client?.weeklySchedule || defaultWeeklySchedule());
  const [savedSchedule, setSavedSchedule] = useState(false);
  const [belt, setBelt] = useState(client?.beltLevel || "White");
  const [savedBelt, setSavedBelt] = useState(false);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [picError, setPicError] = useState("");
  const [injuryNotes, setInjuryNotes] = useState(client?.injuryNotes || "");
  const [savedInjuryNotes, setSavedInjuryNotes] = useState(false);
  const [injuryAreas, setInjuryAreas] = useState(client?.injuryAreas || []);
  const [savedInjuryAreas, setSavedInjuryAreas] = useState(false);
  const [excluded, setExcluded] = useState(client?.excludedExercises || []);
  const [savedExcluded, setSavedExcluded] = useState(false);
  const substitutionPool = useMemo(() => {
    const names = new Set();
    (client?.program?.conjugate?.meLowerPool || []).forEach((it) => it.name && names.add(it.name));
    (client?.program?.conjugate?.meUpperPool || []).forEach((it) => it.name && names.add(it.name));
    return Array.from(names).sort();
  }, [client?.program?.conjugate]);

  const handlePictureUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPicError("");
    setUploadingPic(true);
    processProfilePictureFile(file)
      .then(async (dataUrl) => { await onPersist({ ...client, profilePicture: dataUrl }); setUploadingPic(false); })
      .catch((err) => { setPicError(err.message); setUploadingPic(false); });
  };
  const removePicture = async () => { await onPersist({ ...client, profilePicture: null }); };
  const lastSynced = useLastSynced();

  const saveSchedule = async () => {
    await onPersist({ ...client, weeklySchedule: schedule });
    setSavedSchedule(true);
    setTimeout(() => setSavedSchedule(false), 2000);
  };
  const saveBelt = async () => {
    await onPersist({ ...client, beltLevel: belt });
    setSavedBelt(true);
    setTimeout(() => setSavedBelt(false), 2000);
  };
  const saveInjuryNotes = async () => {
    await onPersist({ ...client, injuryNotes: injuryNotes.trim() });
    setSavedInjuryNotes(true);
    setTimeout(() => setSavedInjuryNotes(false), 2000);
  };
  // Saved on its own so choosing an area takes effect on the next session
  // without also having to remember to save the free-text note.
  const saveInjuryAreas = async (next) => {
    setInjuryAreas(next);
    await onPersist({ ...client, injuryAreas: next });
    setSavedInjuryAreas(true);
    setTimeout(() => setSavedInjuryAreas(false), 2000);
  };
  const toggleExcluded = (name) => {
    setExcluded((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };
  const saveExcluded = async () => {
    await onPersist({ ...client, excludedExercises: excluded });
    setSavedExcluded(true);
    setTimeout(() => setSavedExcluded(false), 2000);
  };

  return (
    <ModalShell onClose={onClose} title="Settings">
      <h3 className="log-exercise-name" style={{ marginBottom: 6 }}>Profile Picture</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div className="settings-avatar-preview">
          {client?.profilePicture ? <img src={client.profilePicture} alt="" /> : <span>{(client?.name || "?").trim().charAt(0).toUpperCase()}</span>}
        </div>
        <div style={{ flex: 1 }}>
          <label className="btn-ghost" style={{ display: "inline-block", cursor: "pointer" }}>
            {uploadingPic ? "Uploading…" : client?.profilePicture ? "Change Picture" : "Upload Picture"}
            <input type="file" accept="image/*" onChange={handlePictureUpload} style={{ display: "none" }} disabled={uploadingPic} />
          </label>
          {client?.profilePicture && <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={removePicture}>Remove</button>}
          {picError && <p className="muted" style={{ color: "var(--accent)", fontSize: 12, marginTop: 6 }}>{picError}</p>}
        </div>
      </div>
      <h3 className="log-exercise-name" style={{ marginBottom: 6 }}>Brazilian Jiu-Jitsu Belt Level</h3>
      <select className="select-input" style={{ width: "100%", marginBottom: 10 }} value={belt} onChange={(e) => setBelt(e.target.value)}>
        {BELT_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <button className="btn-primary wide" onClick={saveBelt}>{savedBelt ? "Saved" : "Save Belt Level"}</button>

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Anything to Work Around</h3>
      <p className="muted" style={{ marginBottom: 10 }}>Optional context for you and your coach — a bad shoulder, a cranky knee, anything recent. Not a medical form.</p>
      <textarea className="notes-box" rows={2} style={{ fontSize: 13, marginBottom: 10 }} value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} placeholder="For example: left shoulder is a little cranky overhead right now" />
      <button className="btn-primary wide" onClick={saveInjuryNotes}>{savedInjuryNotes ? "Saved" : "Save Note"}</button>

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Sore Areas — Adjust My Program</h3>
      <p className="muted" style={{ marginBottom: 10 }}>Tap anything that is sore right now and your program swaps the exercises that aggravate it, starting with your next session. Tap it again once it settles.</p>
      <InjuryAreaPicker value={injuryAreas} onChange={saveInjuryAreas} />
      {savedInjuryAreas && <div className="success-box" role="status" style={{ marginTop: 10 }}>Saved — your next session is adjusted.</div>}
      <p className="muted" style={{ marginTop: 6, marginBottom: 10, fontSize: 12, fontStyle: "italic" }}>These swaps are a way to keep training around a sore area, not treatment. Anything sharp, swollen, or not improving belongs with a clinician first.</p>

      {substitutionPool.length > 0 && (
        <>
          <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Exercise Substitutions</h3>
          <p className="muted" style={{ marginBottom: 10 }}>Check anything you need to avoid right now. Your Max Effort rotation will skip these and pick the next exercise in the pool instead — no code, no waiting on your coach.</p>
          {substitutionPool.map((name) => (
            <label key={name} className="bjj-toggle">
              <input type="checkbox" checked={excluded.includes(name)} onChange={() => toggleExcluded(name)} />
              <span>Avoid {name}</span>
            </label>
          ))}
          <button className="btn-primary wide" onClick={saveExcluded}>{savedExcluded ? "Saved" : "Save Substitutions"}</button>
        </>
      )}

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Data &amp; Sync</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        {lastSynced ? `Everything is saved to your account. Last synced ${lastSynced.toLocaleString()}.` : "Everything you log saves to your account automatically. If a save ever fails, you'll see a banner at the bottom of the screen with a Retry button — nothing is lost silently."}
      </p>

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>My Weekly Training Schedule</h3>
      <p className="muted" style={{ marginBottom: 10 }}>Tap what you do on each day — Low Intensity BJJ, High Intensity BJJ, Strength/Conditioning, any combination, or leave a day blank. This shows up on the History tab so you always know what's coming this week.</p>
      <WeeklyScheduleEditor schedule={schedule} onChange={setSchedule} />
      <button className="btn-primary wide" onClick={saveSchedule}>{savedSchedule ? "Saved" : "Save Schedule"}</button>

      {isCoach && (
        <>
          <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Coach Dashboard</h3>
          <p className="muted" style={{ marginBottom: 10 }}>See every athlete on your account at a glance — payment status, most recent PR, bodyweight, and readiness check-in. No code needed, it's also one tap away from the icon at the top of the app.</p>
          <button className="btn-ghost wide" onClick={onOpenCoachDashboard}>Open Coach Dashboard</button>

          <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Payment</h3>
          <p className="muted" style={{ marginBottom: 10 }}>
            {client?.paid
              ? "This athlete is marked as paid — they have full access to the program going forward, with no more payment prompts."
              : "The first week is free. Starting in Week 2, this athlete will be shown your payment info and won't be able to start that session until you mark them as paid here."}
          </p>
          {client?.paid ? (
            <button className="btn-ghost wide" onClick={() => onPersist({ ...client, paid: false })}>Mark as Unpaid</button>
          ) : (
            <button className="btn-primary wide" onClick={() => onPersist({ ...client, paid: true })}>Mark as Paid</button>
          )}
        </>
      )}

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Competing?</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        Set a date and the last ten days before it taper automatically — half the sets, no maximal lifting, speed work kept short. Leave it blank and the program runs as normal.
      </p>
      <label className="labeled-input">
        <span>Competition date (optional)</span>
        <input type="date" value={client.competitionDate || ""} min={todayStr()}
          onChange={async (e) => { await onPersist({ ...client, competitionDate: e.target.value || null }); }} />
      </label>
      {client.competitionDate && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            {(() => { const d = daysUntil(client.competitionDate); return d == null ? "" : d < 0 ? "That date has passed — clear it or set a new one." : d === 0 ? "That's today. Go compete." : `${d} day${d === 1 ? "" : "s"} out.`; })()}
          </p>
          <button className="btn-ghost wide" onClick={() => setShowWeightCut(true)}>Read: making weight</button>
        </>
      )}
      {showWeightCut && (
        <ModalShell onClose={() => setShowWeightCut(false)} title={WEIGHT_CUT_GUIDANCE.heading}>
          {WEIGHT_CUT_GUIDANCE.body.split("\n\n").map((para, i) => (
            <p key={i} className="muted" style={{ marginBottom: 12, lineHeight: 1.55 }}>{para}</p>
          ))}
          <button className="btn-primary wide" onClick={() => setShowWeightCut(false)}>Got it</button>
        </ModalShell>
      )}

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Terms &amp; Privacy</h3>
      <p className="muted" style={{ marginBottom: 10 }}>How this app handles your information, and the terms of using it.</p>
      <button className="btn-ghost wide" onClick={onOpenTerms}>View Terms &amp; Privacy</button>
      <button className="btn-ghost wide" onClick={() => setShowSafetyCopy(true)}>Read the safety notes again</button>
      {showSafetyCopy && <SafetyScreenModal onClose={() => setShowSafetyCopy(false)} />}
      <button className="btn-ghost wide" onClick={() => setShowWaiverCopy(true)}>View Liability Waiver</button>
      {client?.waiver?.at && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Signed {client.waiver.signature ? `as ${client.waiver.signature} ` : ""}on {fmtDateTime(client.waiver.at)}.
        </p>
      )}
      {showWaiverCopy && <WaiverModal accepted={client?.waiver || null} onClose={() => setShowWaiverCopy(false)} onAccept={() => setShowWaiverCopy(false)} />}

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Update Your Program</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        Your program was saved when you set up your profile, so improvements your coach makes afterward don't reach you automatically. Use this any time to pull your saved profile up to the newest version of the program — every workout, check-in, and Personal Record you've logged stays exactly as it is. This only replaces the program itself, so any exercises, warm-up items, or video links you've manually edited in the Program tab will be overwritten back to the current default.
      </p>
      {refreshed ? (
        <div className="adjust-box" style={{ borderColor: "var(--green)" }}>Your program has been updated to the latest version.</div>
      ) : !confirmingRefresh ? (
        <button className="btn-primary wide" onClick={() => setConfirmingRefresh(true)}>Update Program to Latest Version</button>
      ) : (
        <div className="adjust-box">
          This replaces your program's exercises with the current default. Your logs, check-ins, and Personal Records are never touched. Continue?
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn-primary" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} onClick={async () => { await onRefreshProgram(); setConfirmingRefresh(false); setRefreshed(true); }}>Yes, update it</button>
            <button className="btn-ghost" style={{ flex: 1, marginTop: 0, justifyContent: "center" }} onClick={() => setConfirmingRefresh(false)}>Cancel</button>
          </div>
        </div>
      )}

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Switch Program</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        Currently on <strong>{PROGRAM_VARIANT_LABELS[client?.program?.variant] || PROGRAM_VARIANT_LABELS.B}</strong>. Switching rebuilds your exercises for the new program — your logs, check-ins, and records are untouched.
      </p>
      {["A", "B", "C"].filter((v) => v !== (client?.program?.variant || "B")).map((v) => (
        <button key={v} className="btn-ghost wide" onClick={async () => { await onRefreshProgram(v); setRefreshed(true); }}>
          Switch to {PROGRAM_VARIANT_LABELS[v]}
        </button>
      ))}

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Veteran Athlete Mode</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        {(client?.sessionsCompleted || 0)} sessions logged since {client?.createdAt ? fmtDate(client.createdAt) : "you started"}
        {client?.createdAt ? (() => {
          const months = Math.round((Date.now() - new Date(client.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30));
          return months >= 1 ? ` (roughly ${months} month${months === 1 ? "" : "s"})` : "";
        })() : ""}.
        {" "}After several months of accumulated training, a deeper deload tends to pay off more than the standard one. Turning this on doesn't change your everyday lifting — only deload weeks, which go a further 10 percent lighter with an extra rep in reserve on every set.
      </p>
      <button className="btn-ghost wide" onClick={async () => { await onPersist({ ...client, veteranMode: !client?.veteranMode }); }}>
        {client?.veteranMode ? "Turn Off Veteran Deload" : "Turn On Veteran Deload"}
      </button>
      {client?.veteranMode && <div className="adjust-box" style={{ marginTop: 8, borderColor: "var(--green)" }}>Veteran Deload is on — your next deload week will be deeper than standard.</div>}

      <InstallGuide />

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Export Your Data</h3>
      <p className="muted" style={{ marginBottom: 10 }}>Download every workout, bodyweight entry, readiness check-in, and Personal Record you've ever logged as a single file — a personal backup that's yours to keep, independent of this app.</p>
      <button className="btn-ghost wide" onClick={() => {
        const exportData = {
          exportedAt: new Date().toISOString(),
          name: client.name,
          programName: client.program?.name,
          sessionsCompleted: client.sessionsCompleted,
          logs: client.logs,
          bodyweightLog: client.bodyweightLog,
          readiness: client.readiness,
          prLog: client.prLog,
          mobilityLogs: client.mobilityLogs,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(client.name || "athlete").replace(/\s+/g, "-").toLowerCase()}-training-data-${todayStr()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }}>
        <Download size={14} /> Download My Training Data
      </button>

      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 10 }}>Appearance</h3>
      <div className="radio-group">
        <label className={`radio-pill ${theme === "dark" ? "active" : ""}`} onClick={() => onChangeTheme("dark")}>
          <input type="radio" checked={theme === "dark"} onChange={() => onChangeTheme("dark")} />
          <Moon size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Dark
        </label>
        <label className={`radio-pill ${theme === "light" ? "active" : ""}`} onClick={() => onChangeTheme("light")}>
          <input type="radio" checked={theme === "light"} onChange={() => onChangeTheme("light")} />
          <Sun size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Light
        </label>
      </div>

      {isCoach && (<>
      <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Start Over From the Welcome Screen</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        Use this to preview the exact first-time experience a new client sees when they open this app — the welcome screen where they enter their name, bodyweight, and height. This permanently deletes every athlete profile, workout, check-in, and Personal Record currently saved here, so only use it for testing before you send this app to your clients — each of them gets their own fresh welcome screen automatically the first time they open it themselves.
      </p>
      {!confirmingAppReset ? (
        <button className="btn-ghost wide" style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => setConfirmingAppReset(true)}>Reset App & Return to Welcome Screen</button>
      ) : (
        <div className="adjust-box">
          This deletes everything currently saved in this app. Are you sure?
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn-primary" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} onClick={onResetApp}>Yes, delete everything</button>
            <button className="btn-ghost" style={{ flex: 1, marginTop: 0, justifyContent: "center" }} onClick={() => setConfirmingAppReset(false)}>Cancel</button>
          </div>
        </div>
      )}
      </>)}

      {onSignOut && (
        <>
          <h3 className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Account</h3>
          <button className="btn-ghost wide" onClick={onSignOut}><LogOut size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Sign Out</button>
        </>
      )}
    </ModalShell>
  );
}

/* ============================== COACH DASHBOARD ============================== */

// The record Kyle keeps: who signed, exactly when, and which wording. Generated
// from the stored acceptances rather than typed up, so it cannot drift from what
// the athletes actually agreed to.
function downloadWaiverRecord(records) {
  const generated = new Date();
  const signed = records.filter((r) => r.full && r.full.waiver && r.full.waiver.at);
  const unsigned = records.filter((r) => !(r.full && r.full.waiver && r.full.waiver.at));
  const lines = [];
  lines.push("STRENGTH MATRIX — LIABILITY WAIVER RECORD");
  lines.push("Generated " + generated.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }));
  lines.push("");
  lines.push("Athletes who have accepted: " + signed.length + " of " + records.length);
  lines.push("");
  lines.push("ACCEPTED");
  lines.push("-".repeat(60));
  if (!signed.length) lines.push("(none yet)");
  signed
    .sort((a, b) => (a.full.waiver.at < b.full.waiver.at ? -1 : 1))
    .forEach((r) => {
      lines.push(r.name);
      lines.push("  Signed:    " + (r.full.waiver.signature || "(no signature on file)"));
      lines.push("  Dated:     " + new Date(r.full.waiver.at).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }));
      lines.push("  Timestamp: " + r.full.waiver.at);
      lines.push("  Version:   " + (r.full.waiver.version || "unversioned"));
      if (r.full.waiver.signature && r.full.waiver.name && r.full.waiver.signature.trim().toLowerCase() !== r.full.waiver.name.trim().toLowerCase()) {
        lines.push("  Note:      signed as \"" + r.full.waiver.signature + "\" against the profile name \"" + r.full.waiver.name + "\"");
      }
      lines.push("");
    });
  if (unsigned.length) {
    lines.push("NOT YET ACCEPTED");
    lines.push("-".repeat(60));
    unsigned.forEach((r) => lines.push(r.name + (r.pending ? "  (signed up, profile not set up)" : "")));
    lines.push("");
  }
  lines.push("");
  lines.push("WORDING IN FORCE AT GENERATION — VERSION " + WAIVER_VERSION);
  lines.push("=".repeat(60));
  lines.push(WAIVER_TITLE);
  lines.push("");
  WAIVER_SECTIONS.forEach((s) => {
    lines.push(s.heading.toUpperCase());
    lines.push(s.body);
    lines.push("");
  });
  lines.push("Each signature above was typed by the athlete into the signature field of");
  lines.push("this agreement, on the date and time recorded beside it, from their own");
  lines.push("account. An athlete's stored version identifies the wording they signed.");
  lines.push("Where that differs from the version printed here, the stored version governs.");

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "waiver-record-" + toLocalDateStr(generated) + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CoachDashboard({ userId, clients, activeId, onPersistActive, onSignupsReviewed, onClose }) {
  const [records, setRecords] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [reviewed, setReviewed] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ownList = await Promise.all(clients.map(async (c) => ({ id: c.id, name: c.name, full: await getClient(userId, c.id), ownerId: userId })));
      let linkedList = [];
      // If this is the coach's own account, also pull in every client who signed up
      // for their own account and got auto-linked to this coach — those clients' data
      // lives under their own separate accounts, so it has to be fetched separately.
      if (userId === COACH_USER_ID && supabase) {
        try {
          const { data: links } = await supabase.from("client_links").select("client_user_id, client_email").eq("coach_user_id", userId);
          for (const link of links || []) {
            const clientProfiles = await getClientList(link.client_user_id);
            if (!clientProfiles || clientProfiles.length === 0) {
              linkedList.push({ id: null, name: link.client_email || "New client", full: null, ownerId: link.client_user_id, pending: true });
              continue;
            }
            for (const c of clientProfiles) {
              const full = await getClient(link.client_user_id, c.id);
              linkedList.push({ id: c.id, name: c.name || link.client_email, full, ownerId: link.client_user_id });
            }
          }
        } catch {}
      }
      const rev = (await kvGet(userId, REVIEWED_SIGNUPS_KEY)) || [];
      if (!cancelled) { setRecords([...ownList, ...linkedList]); setReviewed(rev); }
    })();
    return () => { cancelled = true; };
  }, [clients, userId]);

  // Marking a sign-up reviewed is what clears it off the badge. Deciding on
  // payment counts as reviewing them, so that happens automatically below.
  const markReviewed = async (ownerId) => {
    if (!ownerId || ownerId === userId) return;
    const next = Array.from(new Set([...(reviewed || []), ownerId]));
    setReviewed(next);
    await kvSet(userId, REVIEWED_SIGNUPS_KEY, next);
    if (onSignupsReviewed) onSignupsReviewed();
  };

  const togglePaid = async (id, full, ownerId) => {
    if (!full) return;
    setBusyId(id);
    // Re-read first. `full` was fetched when this dashboard opened, and every
    // write here replaces the whole client record — so writing it back would
    // delete any session, PR or check-in the athlete logged in the meantime.
    const fresh = await getClient(ownerId, id);
    if (fresh === LOAD_FAILED || !fresh) {
      emitToast({ kind: "error", message: "Couldn't reach that athlete's record — try again.", autoDismissMs: 6000 });
      setBusyId(null);
      return;
    }
    full = fresh;
    const updated = { ...full, paid: !full.paid };
    if (id === activeId && ownerId === userId) {
      await onPersistActive(updated);
    } else {
      await setClient(ownerId, id, updated);
    }
    setRecords((prev) => prev.map((r) => (r.id === id && r.ownerId === ownerId ? { ...r, full: updated } : r)));
    await markReviewed(ownerId);
    setBusyId(null);
  };

  const paidCount = records ? records.filter((r) => r.full?.paid).length : 0;
  // Only self-registered athletes are sign-ups; profiles the coach made
  // themselves were never waiting on a decision.
  const newSignups = (records && reviewed)
    ? records.filter((r) => r.ownerId !== userId && !reviewed.includes(r.ownerId))
    : [];

  return (
    <ModalShell onClose={onClose} title="Coach Dashboard">
      {!records ? (
        <LoadingState />
      ) : records.length === 0 ? (
        <EmptyState text="No athletes yet — add one from the Athletes/Clients screen." />
      ) : (
        <>
          {newSignups.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="log-exercise-name" style={{ marginBottom: 6 }}>
                New — needs review ({newSignups.length})
              </div>
              <p className="muted" style={{ marginBottom: 10 }}>
                {newSignups.length === 1 ? "This athlete has" : "These athletes have"} signed up since you last checked. Marking someone paid grandfathers them in for good — they never see a payment prompt again. Either choice clears them off this list.
              </p>
              {newSignups.map((r) => (
                <div key={`${r.ownerId}-${r.id || "pending"}`} className="signup-review-card">
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                    {r.full
                      ? `Signed up — currently marked ${r.full.paid ? "paid" : "unpaid"}`
                      : "Signed up but hasn't finished setting up their profile yet"}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {r.full && !r.full.paid && (
                      <button className="btn-primary" style={{ flex: "1 1 160px", padding: "8px 12px", fontSize: 13 }}
                        disabled={busyId === r.id}
                        onClick={() => togglePaid(r.id, r.full, r.ownerId)}>
                        {busyId === r.id ? "Saving…" : "Mark paid — grandfather in"}
                      </button>
                    )}
                    <button className="btn-ghost" style={{ flex: "1 1 160px", marginTop: 0, justifyContent: "center" }}
                      onClick={() => markReviewed(r.ownerId)}>
                      {r.full && r.full.paid ? "Got it" : "Leave unpaid for now"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button className="btn-ghost wide" style={{ marginBottom: 14 }} onClick={() => downloadWaiverRecord(records)}>
            <Download size={14} /> Download waiver record ({records.filter((r) => r.full?.waiver?.at).length} signed)
          </button>
          <p className="muted" style={{ marginBottom: 14 }}>{paidCount} of {records.length} athlete{records.length === 1 ? "" : "s"} marked paid and grandfathered in for good.</p>
          {records.map((r) => {
            const full = r.full;
            const perWeek = full?.program?.sessionsPerWeek || 3;
            const weekNumber = full ? Math.max(1, Math.floor((full.sessionsCompleted || 0) / perWeek) + 1) : null;
            const recentPR = full?.prLog?.length ? [...full.prLog].sort((a, b) => (a.date < b.date ? 1 : -1))[0] : null;
            const recentBW = full?.bodyweightLog?.length ? full.bodyweightLog[full.bodyweightLog.length - 1] : null;
            const recentReadiness = full ? Object.values(full.readiness || {}).sort((a, b) => (a.date < b.date ? 1 : -1))[0] : null;
            return (
              <div key={`${r.ownerId}:${r.id || "pending"}`} className="card">
                <div className="payment-row">
                  <div>
                    <div className="card-title" style={{ marginBottom: 2 }}>{r.name}{r.ownerId !== userId && <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}> · self sign-up</span>}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>{r.pending ? "Signed up — hasn't started their program yet" : full ? `Week ${weekNumber} — Block ${full.blockNumber || 1}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                    <span className={`pill ${full?.paid ? "pill-paid" : "pill-unpaid"}`}>{full?.paid ? "Paid" : "Unpaid"}</span>
                    <span className={`pill ${full?.waiver?.at ? "pill-paid" : "pill-alert"}`}>{full?.waiver?.at ? "Waiver signed" : "No waiver"}</span>
                  </div>
                </div>
                {full?.waiver?.at && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    Signed <strong style={{ color: "var(--text)", fontWeight: 600 }}>{full.waiver.signature || full.waiver.name || "electronically"}</strong> · {fmtDateTime(full.waiver.at)} · version {full.waiver.version || "unversioned"}
                  </div>
                )}
                {full?.injuryAreas?.length > 0 && (
                  <div className="adjust-box" style={{ marginTop: 10 }}>
                    <strong>Program adjusting around:</strong> {INJURY_AREAS.filter((a) => full.injuryAreas.includes(a.key)).map((a) => a.label).join(", ")}
                  </div>
                )}
                {full?.injuryNotes && (
                  <div className="adjust-box" style={{ marginTop: 10 }}>Their note: {full.injuryNotes}</div>
                )}
                <div className="dash-grid" style={{ marginTop: 10 }}>
                  <DashStat label="Recent PR" value={recentPR ? `${recentPR.exerciseName} — ${recentPR.weight ? `${recentPR.weight} lb × ` : ""}${recentPR.reps} ${exerciseUnit(recentPR.exerciseName)}` : "None yet"} wide />
                  <DashStat label="Bodyweight" value={recentBW ? `${recentBW.weight} lb — ${fmtDate(recentBW.date)}` : "None yet"} wide />
                  <DashStat
                    label="Readiness"
                    value={recentReadiness ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="hero-dot" style={{ background: readinessCopyFor(recentReadiness).color }} />
                        {recentReadiness.color} — {fmtDate(recentReadiness.date)}
                      </span>
                    ) : "None yet"}
                    wide
                  />
                </div>
                <button
                  className={full?.paid ? "btn-ghost wide" : "btn-primary wide"}
                  style={{ marginTop: 10 }}
                  disabled={busyId === r.id || !full}
                  onClick={() => togglePaid(r.id, full, r.ownerId)}
                >
                  {busyId === r.id ? "Updating…" : full?.paid ? "Mark as Unpaid" : "Mark as Paid — Grandfather In"}
                </button>
              </div>
            );
          })}
        </>
      )}
    </ModalShell>
  );
}

/* ============================== TODAY TAB ============================== */

const SECTION_LABELS = { agility: "Neuromuscular & Agility", strength: "Main Strength", power: "Dynamic Effort & Power", durability: "Durability & Tendon Health", conditioning: "Grappling Conditioning", arms_core: "Arms & Core Isolation" };

function lastSessionFor(client, exerciseName) {
  for (let i = client.logs.length - 1; i >= 0; i--) {
    const log = client.logs[i];
    const en = log.exercises.find((e) => e.name === exerciseName);
    if (en) { const best = bestSetOf(en.sets); return { date: log.date, best }; }
  }
  return null;
}
function lastWeekBest(client, exerciseName, currentWeekNumber) {
  let best = null;
  for (const log of client.logs) {
    if (log.weekNumber !== currentWeekNumber - 1) continue;
    const en = log.exercises.find((e) => e.name === exerciseName);
    if (!en) continue;
    const b = bestSetOf(en.sets);
    if (b && (!best || b.e1rm > best.e1rm)) best = b;
  }
  return best;
}

function TodayTab({ client, onPersist, onStartLog, onStartMobility }) {
  const totalSessions = totalSessionsIn(client.program);
  const actualComplete = (client.sessionsCompleted || 0) >= totalSessions;
  const [viewIndex, setViewIndex] = useState(client.sessionsCompleted || 0);
  const [showPreview, setShowPreview] = useState(false);
  const [showJumpPicker, setShowJumpPicker] = useState(false);
  const [showMentalLibrary, setShowMentalLibrary] = useState(false);
  const todaysMentalTip = useMemo(() => mentalTipForDate(todayStr()), []);
  useEffect(() => { setViewIndex(client.sessionsCompleted || 0); }, [client.sessionsCompleted, client.id]);

  const today = todayStr();
  const readinessToday = client.readiness[today];
  const [showReadiness, setShowReadiness] = useState(false);
  const recentPR = useMemo(() => findRecentPR(client), [client]);
  const { total: totalLifted, achievedDates } = useMemo(() => milestoneProgress(client), [client]);
  const nextMilestoneIdx = LIFT_MILESTONES.findIndex((m, idx) => achievedDates[idx] === undefined);
  const [showAccomplishments, setShowAccomplishments] = useState(false);
  const latestBW = client.bodyweightLog?.length ? client.bodyweightLog[client.bodyweightLog.length - 1] : null;
  const mobilityMinutes = Math.round((client.program.mobility || []).reduce((s, seg) => s + seg.seconds, 0) / 60);
  const hasEverTrained = (client.logs?.length || 0) > 0 || (client.mobilityLogs?.length || 0) > 0;
  const daysInactive = useMemo(() => daysSinceLastActivity(client), [client]);
  const nudgeMessage = hasEverTrained ? reengagementMessage(daysInactive) : null;

  // These must stay above the completion branch below: hook order and count
  // have to be identical on every render of this component.
  const pos = positionAtIndex(client.program, viewIndex);
  const isCurrent = viewIndex === (client.sessionsCompleted || 0);
  const mainLift = primaryLiftName(pos.day, pos.weekNumber, client.program, pos.phase, resolveOptsFor(client));
  const resolvedRaw = useMemo(() => resolveDaySections(pos.day, pos.weekNumber, client.program, pos.phase, false, resolveOptsFor(client)), [pos.day, pos.weekNumber, client.program, pos.phase, client.blockNumber, client.excludedExercises, client.injuryAreas]);
  const adjustment = useMemo(() => (isCurrent ? adjustSectionsForReadiness(resolvedRaw, readinessToday) : { sections: resolvedRaw, adjustedNote: null }), [resolvedRaw, readinessToday, isCurrent]);
  // A taper and a rough day stack rather than one overriding the other.
  const daysToComp = isCurrent ? daysUntil(client.competitionDate) : null;
  const tapered = useMemo(() => applyTaper(adjustment.sections, daysToComp), [adjustment.sections, daysToComp]);

  if (actualComplete) {
    return (
      <div className="pad">
        <Card title="Twelve-Week Block Complete">
          <p className="muted" style={{ marginBottom: 14 }}>
            You've finished Block {client.blockNumber || 1} of "{client.program.name}". Every workout, check-in, and Personal Record you logged is saved permanently — review Progress and Records, then start the next block whenever you're ready. Nothing gets deleted.
          </p>
          <p className="muted" style={{ marginBottom: 14 }}>
            Block {(client.blockNumber || 1) + 1} keeps the same structure but moves your Max Effort rotation forward, so Week 1 won't repeat the exact same exercises as this block's Week 1 did.
          </p>
          <button className="btn-primary wide" onClick={async () => { await onPersist({ ...client, sessionsCompleted: 0, blockNumber: (client.blockNumber || 1) + 1 }); }}>
            Start New Twelve-Week Block
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="pad">
      <button className="quote-hero" onClick={() => setShowMentalLibrary(true)} aria-label="Browse all quotes">
        <p className="quote-hero-text">{todaysMentalTip.quote}</p>
        <span className="quote-hero-attr"><span className="quote-hero-dash" />{todaysMentalTip.author}</span>
      </button>

      {isCurrent && nudgeMessage && (
        <div className="nudge-card">
          <div className="nudge-card-title">Welcome back</div>
          <p className="muted" style={{ marginBottom: 0 }}>{nudgeMessage}</p>
        </div>
      )}
      <div className="stat-row">
        <StatChip label="Block" value={`${client.blockNumber || 1}`} />
        <StatChip label="Week" value={`${pos.weekNumber}`} />
        <StatChip label="Bodyweight" value={latestBW ? `${latestBW.weight}` : "—"} />
        <StatChip label="Total Lifted" value={totalLifted ? formatWeight(totalLifted) : "—"} />
      </div>

      <Card title="Lifting Milestones" subtitle={formatWeight(totalLifted) + " lifted since you started"}>
        {nextMilestoneIdx >= 0 ? (
          <>
            <p className="muted" style={{ marginBottom: 10 }}>Next up: the weight of {LIFT_MILESTONES[nextMilestoneIdx].emoji} {LIFT_MILESTONES[nextMilestoneIdx].name} ({formatWeight(LIFT_MILESTONES[nextMilestoneIdx].weight)}).</p>
            <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${Math.min(100, Math.round((totalLifted / LIFT_MILESTONES[nextMilestoneIdx].weight) * 100))}%` }} /></div>
          </>
        ) : (
          <p className="muted" style={{ marginBottom: 10 }}>You've hit every milestone there is. Incredible.</p>
        )}
        <button className="btn-ghost wide" style={{ marginTop: 12 }} onClick={() => setShowAccomplishments(true)}>View All Accomplishments</button>
      </Card>

      <Card title="Readiness & Bodyweight" right={readinessToday ? <span className="pill" style={{ background: readinessCopyFor(readinessToday).color, color: readinessCopyFor(readinessToday).textColor }}>{readinessToday.color}</span> : null}>
        {readinessToday ? (
          <div><p className="muted" style={{ marginBottom: 10 }}>{readinessCopyFor(readinessToday).detail}</p><button className="btn-ghost" onClick={() => setShowReadiness(true)}>Update today's check-in</button></div>
        ) : (
          <div><p className="muted" style={{ marginBottom: 10 }}>Quick check-in before today's session — how you slept, how ready you feel to train, your bodyweight, and whether grappling has been rough lately. The workout adjusts itself based on your answers.</p><button className="btn-primary" onClick={() => setShowReadiness(true)}>Check in</button></div>
        )}
      </Card>

      {recentPR && (
        <Card title="Most Recent Personal Record"><div className="pr-line"><Trophy size={16} color="var(--accent)" /><span><b>{recentPR.name}</b> — {recentPR.weight ? `${recentPR.weight} pounds × ` : ""}{recentPR.reps} {exerciseUnit(recentPR.name)} ({fmtDate(recentPR.date)})</span></div></Card>
      )}

      <WearableStrip
        source={"Today's check-in"}
        dateLabel={fmtDate(todayStr())}
        metrics={readinessToday ? [
          { label: "Sleep", value: `${readinessToday.sleep}/5` },
          { label: "Readiness", value: readinessToday.readiness != null ? `${readinessToday.readiness}/5` : `${readinessToday.energy ?? "—"}/5` },
        ] : [
          { label: "Sleep", value: "—" },
          { label: "Readiness", value: "—" },
          { label: "Soreness", value: "—" },
        ]}
      />

      <div className="hero-card">
        <div className="hero-top-row">
          <button className="hero-nav-btn" disabled={viewIndex <= 0} onClick={() => setViewIndex((i) => Math.max(0, i - 1))}><ChevronLeft size={16} /></button>
          <div className="hero-eyebrow" style={{ marginBottom: 0 }}>Week {pos.weekNumber} · Day {pos.day.label}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="hero-nav-btn" onClick={() => setShowJumpPicker((s) => !s)} title="Preview or skip ahead to a different day"><CalendarDays size={14} /></button>
            <button className="hero-nav-btn" disabled={viewIndex >= totalSessions - 1} onClick={() => setViewIndex((i) => Math.min(totalSessions - 1, i + 1))}><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="hero-select-row">
          <select className="hero-select" value={pos.phase.id} disabled><option>{pos.phase.name}</option></select>
          <select className="hero-select" value={pos.day.id} disabled><option>Day {pos.day.label} — {pos.day.name}</option></select>
        </div>

        <div className="hero-title">{mainLift}</div>
        <div className="hero-duration">{pos.day.name} · Estimated {30 + (pos.day.sections?.length || 0) * 5} minutes</div>

        {isCurrent && (
          readinessToday ? (
            <div className="hero-readiness-badge">
              <span className="hero-dot" style={{ background: readinessCopyFor(readinessToday).color }} />
              {readinessToday.color === "GREEN" ? "Good to go — full session today" : readinessToday.color === "YELLOW" ? "Rough night — session a notch back" : "Rough day — session eased right back"}
            </div>
          ) : (
            <>
              <div className="mood-row-label">How do you feel today?</div>
              <div className="mood-row">
                {[{ key: "fresh", label: "Good", entry: { sleep: 5, readiness: 5 } }, { key: "normal", label: "Normal", entry: { sleep: 4, readiness: 4 } }, { key: "beat", label: "Rough", entry: { sleep: 1, readiness: 1 } }].map((m) => (
                  <button key={m.key} className="mood-pill" onClick={async () => {
                    const color = classifyReadiness(m.entry);
                    await onPersist({ ...client, readiness: { ...client.readiness, [today]: { ...m.entry, bjjHard: false, color, date: today } } });
                  }}>{m.label}</button>
                ))}
              </div>
            </>
          )
        )}
        <button className="hero-full-checkin" onClick={() => setShowReadiness(true)}>{readinessToday ? "Edit full check-in (bodyweight, sleep, readiness)" : "Or do a full check-in instead"}</button>

        {!isCurrent && (
          <div className="adjust-box">
            Previewing Week {pos.weekNumber}, Day {pos.day.label} — this is not today's actual session.
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="link-btn" onClick={() => setViewIndex(client.sessionsCompleted || 0)}>Jump back to today</button>
              <button className="link-btn" onClick={async () => {
                const goingBack = viewIndex < (client.sessionsCompleted || 0);
                // Moving the cursor backwards rewinds progress and, because the
                // payment gate reads the current week, silently reopens it.
                if (goingBack && !window.confirm("This moves you back to this day. Sessions you've already finished stay in your history, but your progress marker goes back to here. Continue?")) return;
                await onPersist({ ...client, sessionsCompleted: viewIndex, maxSessionsReached: Math.max(client.maxSessionsReached || 0, client.sessionsCompleted || 0) });
                setShowJumpPicker(false);
              }}>{viewIndex < (client.sessionsCompleted || 0) ? "Go back to this day" : "Skip ahead — make this my current day"}</button>
            </div>
          </div>
        )}

        {showJumpPicker && (
          <div className="jump-picker">
            {Array.from({ length: Math.ceil(totalSessions / (client.program.sessionsPerWeek || 3)) }, (_, i) => i + 1).map((w) => {
              const perWeek = client.program.sessionsPerWeek || 3;
              return (
                <div key={w} className="jump-week-row">
                  <span className="jump-week-label">Week {w}</span>
                  <div className="jump-day-row">
                    {Array.from({ length: perWeek }, (_, di) => di + 1).map((d) => {
                      const idx = (w - 1) * perWeek + (d - 1);
                      const isCurrentIdx = idx === (client.sessionsCompleted || 0);
                      return (
                        <button key={d} className={`jump-day-btn ${idx === viewIndex ? "active" : ""} ${isCurrentIdx ? "is-today" : ""}`} onClick={() => { setViewIndex(idx); setShowJumpPicker(false); }}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {pos.day.intent && <div className="intent-box">{pos.day.intent}</div>}
        {tapered.taperNote && <div className="intent-box">{tapered.taperNote}</div>}
        {adjustment.adjustedNote && <div className="adjust-box">{adjustment.adjustedNote}</div>}

        <button className="preview-toggle" onClick={() => setShowPreview((s) => !s)}>
          <span>Preview today's workout</span>
          <ChevronRight size={16} className={showPreview ? "chev-open" : ""} />
        </button>
        {showPreview && (
          <div className="section-preview-list">
            {tapered.sections.filter((sec) => sec.exercises.length > 0).map((sec) => (
              <div key={sec.id}>
                <div className="section-subheading" style={{ margin: "10px 0 4px" }}>{sec.name || SECTION_LABELS[sec.type]}{sec.skipped ? " (skipped today)" : ""}</div>
                {sec.exercises.map((e, i) => (
                  <div key={e.id || i} className="section-preview-ex-row">{e.name}</div>
                ))}
              </div>
            ))}
          </div>
        )}
        {isCurrent ? (
          Math.floor(Math.max(client.sessionsCompleted || 0, client.maxSessionsReached || 0) / (client.program.sessionsPerWeek || 3)) + 1 >= 2 && !client.paid ? (
            <div className="adjust-box" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Week 1 is complete — payment required to continue</div>
              <p className="muted" style={{ marginBottom: 10 }}>{`Send $${PROGRAM_PRICE - (client.promoDiscount || 0)} to unlock the rest of your program. Your coach will confirm it on their end — this screen updates automatically once they do, no need to do anything else here.`}</p>
              {(coachVenmo || coachCashApp || coachPaymentLink) ? (
                <div style={{ textAlign: "center" }}>
                  {coachVenmo && <div style={{ fontSize: 13.5, marginBottom: 4 }}>Venmo: <strong>{coachVenmo}</strong></div>}
                  {coachCashApp && <div style={{ fontSize: 13.5, marginBottom: coachPaymentLink ? 10 : 0 }}>Cash App: <strong>{coachCashApp}</strong></div>}
                  {coachPaymentLink && <a className="btn-primary wide" style={{ textDecoration: "none", display: "block", marginTop: 8 }} href={coachPaymentLink} target="_blank" rel="noopener noreferrer">Open Payment Link</a>}
                </div>
              ) : (
                <p className="muted" style={{ marginBottom: 0 }}>Contact your coach for payment instructions.</p>
              )}
            </div>
          ) : (
            <>
              <button className="hero-start-btn" style={{ marginTop: 14 }} onClick={() => onStartLog(pos.phase.id, pos.day.id)}>Start Workout</button>
              <div className="hero-secondary-row">
                <button className="hero-secondary-btn" onClick={onStartMobility}>Start Recovery</button>
                <button className="hero-secondary-btn" onClick={() => setShowPreview(true)}>See Full Plan</button>
              </div>
            </>
          )
        ) : (
          <div className="muted" style={{ marginTop: 14, fontSize: 12.5, fontStyle: "italic" }}>Preview only. Return to today's session to log a workout.</div>
        )}
      </div>

      <Card title="Recovery & Mobility" subtitle={`${mobilityMinutes} minutes — slow breathing first, then range-of-motion work`}>
        <p className="muted" style={{ marginBottom: 10 }}>Also available any time on its own, not just after training.</p>
        <button className="btn-ghost wide" onClick={onStartMobility}>Start recovery session</button>
      </Card>

      <Card title="Phase Notes">
        <p className="muted" style={{ marginBottom: 6 }}>{pos.phase.objective}</p>
        <p className="muted" style={{ fontSize: 13 }}>{pos.phase.intensityNote}</p>
      </Card>

      {showReadiness && (
        <ReadinessModal existing={readinessToday} existingWeight={latestBW && latestBW.date === today ? latestBW.weight : ""} onClose={() => setShowReadiness(false)}
          onSave={async ({ weight, ...entry }) => {
            const color = classifyReadiness(entry);
            const updated = { ...client, readiness: { ...client.readiness, [today]: { ...entry, color, date: today } }, bodyweightLog: Number.isFinite(Number(weight)) && Number(weight) > 0 ? upsertBodyweight(client.bodyweightLog, today, Number(weight)) : client.bodyweightLog };
            await onPersist(updated);
            setShowReadiness(false);
          }} />
      )}
      {showAccomplishments && <AccomplishmentsPage client={client} onClose={() => setShowAccomplishments(false)} />}
      {showMentalLibrary && (
        <ModalShell onClose={() => setShowMentalLibrary(false)} title="Motivational Quotes">
          <p className="muted" style={{ marginBottom: 14 }}>Every quote in the rotation — today's is highlighted.</p>
          {MENTAL_COACHING_LIBRARY.map((tip) => (
            <div key={tip.quote} className="card" style={{ marginBottom: 10, borderColor: tip.quote === todaysMentalTip.quote ? "var(--accent)" : "var(--border)" }}>
              <p style={{ fontSize: 14, fontStyle: "italic", marginBottom: 6 }}>"{tip.quote}"</p>
              <p className="muted" style={{ marginBottom: 0 }}>— {tip.author}</p>
            </div>
          ))}
        </ModalShell>
      )}
    </div>
  );
}
function findRecentPR(client) {
  if (client.logs.length === 0) return null;
  const lastLog = client.logs[client.logs.length - 1];
  let top = null;
  for (const e of lastLog.exercises) { const b = bestSetOf(e.sets); if (b && (!top || b.e1rm > top.e1rm)) top = { ...b, name: e.name, date: lastLog.date }; }
  return top;
}

function AccomplishmentsPage({ client, onClose }) {
  const { total, achievedDates } = useMemo(() => milestoneProgress(client), [client]);
  const volumeSeries = useMemo(() => weeklyVolumeSeries(client), [client]);
  // Sessions and weeks, not tonnage. Neck holds, carries, sprints and every
  // second of conditioning produce almost no tonnage, and an honestly reported
  // rough week visibly slows a tonnage bar — so tonnage alone was quietly
  // rewarding the wrong behaviour.
  const sessionCount = (client.logs || []).length + (client.mobilityLogs || []).length;
  const weeksTrained = useMemo(() => {
    const weeks = new Set();
    [...(client.logs || []), ...(client.mobilityLogs || [])].forEach((l) => {
      if (!l.date) return;
      const d = new Date(l.date + "T00:00:00");
      const wd = d.getDay();
      d.setDate(d.getDate() + ((wd === 0 ? -6 : 1) - wd));
      weeks.add(toLocalDateStr(d));
    });
    return weeks.size;
  }, [client.logs, client.mobilityLogs]);
  const comebacks = useMemo(() => {
    const dates = [...(client.logs || []), ...(client.mobilityLogs || [])]
      .map((l) => l.date).filter(Boolean).sort();
    let n = 0;
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i] + "T00:00:00") - new Date(dates[i - 1] + "T00:00:00")) / 86400000;
      if (gap > 14) n++;
    }
    return n;
  }, [client.logs, client.mobilityLogs]);
  return (
    <ModalShell onClose={onClose} title="Lifting Milestones">
      <div className="metric-row" style={{ marginBottom: 14 }}>
        <MetricTile label="Sessions" value={sessionCount} sub="Completed, all time" color="var(--accent)" />
        <MetricTile label="Weeks trained" value={weeksTrained} sub="Never resets" color="var(--green)" />
      </div>
      {comebacks > 0 && (
        <div className="intent-box">
          <strong>You came back{comebacks > 1 ? ` ${comebacks} times` : ""}.</strong> After a break of two weeks or more, you started again. That is the hardest thing anyone does in this sport and almost nothing tracks it, so it is tracked here.
        </div>
      )}
      <div className="card" style={{ textAlign: "center", padding: 24 }}>
        <div className="finish-stat-value" style={{ fontSize: 26 }}>{formatWeight(total)}</div>
        <div className="muted">Total weight lifted since you started</div>
      </div>
      {volumeSeries.length > 0 && (
        <Card title="Volume Over Time" subtitle="Total weight lifted, by week">
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeSeries}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={10} />
                <YAxis stroke="var(--text-dim)" fontSize={10} tickFormatter={(v) => formatWeight(v)} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} formatter={(v) => formatWeight(v)} />
                <Bar dataKey="volume" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>These are fun, rounded real-world comparisons — not scientific measurements — just a way to see how much work you've actually put in.</p>
      {LIFT_MILESTONES.map((m, idx) => {
        const achieved = achievedDates[idx] !== undefined;
        const prevWeight = idx === 0 ? 0 : LIFT_MILESTONES[idx - 1].weight;
        const pct = achieved ? 100 : Math.max(0, Math.min(100, Math.round(((total - prevWeight) / (m.weight - prevWeight)) * 100)));
        return (
          <div key={m.name} className={`milestone-row ${achieved ? "achieved" : ""}`}>
            <div className="milestone-emoji">{m.emoji}</div>
            <div style={{ flex: 1 }}>
              <div className="milestone-name">{achieved ? "Lifted the weight of " : "Lift the weight of "}{m.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{formatWeight(m.weight)}{achieved ? ` — reached ${fmtDate(achievedDates[idx])}` : ""}</div>
              {!achieved && <div className="progress-bar-track" style={{ marginTop: 6, height: 6 }}><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>}
            </div>
            {achieved && <Check size={18} color="var(--green)" />}
          </div>
        );
      })}
    </ModalShell>
  );
}

/* ============================== READINESS MODAL ============================== */

function ReadinessModal({ existing, existingWeight, onClose, onSave }) {
  const [v, setV] = useState(existing || { sleep: 3, readiness: 3, bjjHard: false });
  const [weight, setWeight] = useState(existingWeight || "");
  const fields = [
    // Both rows run the same direction — higher is better on each — so a slider
    // pushed right never means something bad on one row and good on the next.
    { key: "sleep", label: "Sleep quality", hint: "0 = terrible, 5 = great", max: 5 },
    { key: "readiness", label: "How does your body feel today?", hint: "0 = wrecked, 5 = good. This is your body, not your mood — not feeling like training on a normal body is still a training day.", max: 5 },
  ];
  return (
    <ModalShell onClose={onClose} title="Daily Check-In">
      <button className="btn-primary wide" style={{ marginBottom: 16 }} onClick={() => onSave({ ...v, weight })}>Save check-in</button>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        New or worsening pain isn't a rough day — that's worth a message to your coach rather than a lighter session.
      </p>
      {fields.map((f) => <SliderRow key={f.key} label={f.label} hint={f.hint} value={v[f.key]} max={f.max} onChange={(n) => setV({ ...v, [f.key]: n })} />)}
      <div className="bw-row"><Scale size={16} color="var(--accent)" /><span>Bodyweight (optional)</span><input type="number" step="0.1" inputMode="decimal" min="1" max="600" className="bw-input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="for example, 178.5" aria-label="Bodyweight in pounds" /></div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
        Weekly is plenty. Day to day this tells you more about hydration than about you.
      </p>
      <label className="bjj-toggle">
        <input type="checkbox" checked={!!v.bjjHard} onChange={(e) => setV({ ...v, bjjHard: e.target.checked })} />
        <span>Hard Brazilian Jiu-Jitsu training recently?</span>
      </label>
      <button className="btn-primary wide" style={{ marginTop: 16 }} onClick={() => onSave({ ...v, weight })}>Save check-in</button>
    </ModalShell>
  );
}
function SliderRow({ label, hint, value, max, onChange }) {
  return <div className="slider-row"><div className="slider-label"><span>{label}{hint ? <span className="slider-hint"> {hint}</span> : null}</span><span className="slider-value">{value}</span></div><input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}

/* ============================== SHARED SESSION UI ============================== */

function SectionHeader({ title, subtitle, complete, onToggleComplete, expanded, onToggleExpand }) {
  return (
    <div className="section-header-row">
      <button type="button" className={`section-check ${complete ? "checked" : ""}`} onClick={onToggleComplete}
        aria-pressed={complete} aria-label={complete ? `Mark ${title} as not complete` : `Mark ${title} complete`}>
        <span className="section-check-box">{complete && <Check size={14} />}</span>
      </button>
      <button type="button" className="section-header" onClick={onToggleExpand} aria-expanded={expanded}>
        <div style={{ textAlign: "left" }}><h3 className="log-exercise-name">{title}</h3>{subtitle && <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>}</div>
        <ChevronRight size={16} className={expanded ? "chev-open" : ""} />
      </button>
    </div>
  );
}
function VideoLinkBlock({ url, onSave, onDelete, label, canEdit = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url || "");
  if (editing) {
    return (
      <div className="video-edit-row" onClick={(e) => e.stopPropagation()}>
        {label && <span className="muted" style={{ fontSize: 11, marginRight: 2 }}>{label}</span>}
        <input className="edit-input" style={{ flex: 1 }} placeholder="Paste a video link" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn-ghost" style={{ marginTop: 0 }} onClick={() => { onSave(draft.trim()); setEditing(false); }}>Save</button>
        <button className="icon-btn small" onClick={() => setEditing(false)} aria-label="Cancel editing"><X size={13} /></button>
      </div>
    );
  }
  if (url) {
    return (
      <div className="ex-links-row" onClick={(e) => e.stopPropagation()}>
        {label && <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>{label}</span>}
        <a className="video-link" href={url} target="_blank" rel="noopener noreferrer">Watch video</a>
        {canEdit && <button className="link-x-btn" onClick={onDelete} title="Remove this link"><X size={12} /></button>}
        {canEdit && <button className="link-edit-btn" onClick={() => { setDraft(url); setEditing(true); }}>Edit</button>}
      </div>
    );
  }
  return (
    <div className="ex-links-row" onClick={(e) => e.stopPropagation()}>
      {label && <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>{label}</span>}
      <button className="add-link-btn" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>+ Add a video link</button>
    </div>
  );
}
function ProgressBadge({ percent }) {
  const pct = Math.round(percent);
  let cls = "red";
  if (pct >= 100) cls = "neon"; else if (pct >= 66) cls = "green"; else if (pct >= 33) cls = "amber";
  const r = 16, c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  return (
    <div className={`progress-circle ${cls}`}>
      <svg width="42" height="42" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 20 20)" className="progress-circle-arc" />
      </svg>
      <span className="progress-circle-pct">{pct}%</span>
    </div>
  );
}

/* ============================== IN-PROGRESS SESSION DRAFTS ============================== */
// A session runs 60 to 90 minutes and only reaches the server when the athlete
// taps Finish. Without a local draft, a refresh, a crash, or iOS evicting the
// app from memory between sets loses the whole thing — and the first-set banner
// promises the opposite. Drafts live in this browser only and never sync; they
// exist purely so an interrupted session can be picked back up.
const DRAFT_PREFIX = "sc-app:draft:";
function readDraft(key) {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeDraft(key, value) {
  try { window.localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value)); } catch { /* private mode, blocked storage, or quota — the session still works */ }
}
function clearDraft(key) {
  try { window.localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* nothing to clean up */ }
}
// Only the athlete's own typing is restored, matched by exercise id. The
// prescription itself always comes from the program, so a draft can never
// resurrect an old target after the program is updated.
function mergeDraftEntries(fresh, draftEntries) {
  if (!draftEntries) return fresh;
  const out = {};
  Object.keys(fresh).forEach((secId) => {
    const saved = Array.isArray(draftEntries[secId]) ? draftEntries[secId] : [];
    out[secId] = fresh[secId].map((en) => {
      const d = saved.find((x) => x && x.exerciseId === en.exerciseId);
      if (!d || !Array.isArray(d.sets)) return en;
      return { ...en, sets: en.sets.map((s, i) => (d.sets[i] ? { ...s, ...d.sets[i] } : s)) };
    });
  });
  return out;
}

/* ============================== FULL-DAY SESSION SCREEN ============================== */

function DaySessionScreen({ client, isCoach, phaseId, dayId, onClose, onSave, onStartMobility, onUpdateProgram, onRestartProgram, onRecordPR, onRemovePR }) {
  const phase = client.program.phases.find((p) => p.id === phaseId);
  const day = phase.days.find((d) => d.id === dayId);
  const totalSessions = totalSessionsIn(client.program);
  const perWeek = client.program.sessionsPerWeek || 3;
  const weekNumber = Math.min(Math.ceil(((client.sessionsCompleted || 0) + 1) / perWeek), Math.max(...client.program.phases.map((p) => p.weekEnd)));
  const readinessToday = client.readiness[todayStr()];
  const [exCollapseOverride, setExCollapseOverride] = useState({});
  const toggleExerciseOpen = (exerciseId, currentlyOpen) =>
    setExCollapseOverride((prev) => ({ ...prev, [exerciseId]: !currentlyOpen }));

  const rawResolvedSections = useMemo(() => resolveDaySections(day, weekNumber, client.program, phase, false, resolveOptsFor(client)), [day, weekNumber, client.program, phase, client.blockNumber, client.excludedExercises, client.injuryAreas]);
  const { sections: resolvedSections, adjustedNote } = useMemo(() => adjustSectionsForReadiness(rawResolvedSections, readinessToday), [rawResolvedSections, readinessToday]);
  const mainLift = primaryLiftName(day, weekNumber, client.program, phase, resolveOptsFor(client));

  const buildFreshEntries = useCallback(() => {
    const map = {};
    resolvedSections.forEach((sec) => {
      map[sec.id] = sec.exercises.map((e) => ({ exerciseId: e.id, name: e.name, target: e, sets: Array.from({ length: e.sets || 3 }).map((_, setIdx) => ({ weight: "", reps: defaultRepsFor(e, setIdx), rir: defaultRirFor(e, setIdx), done: false })) }));
    });
    return map;
  }, [resolvedSections]);

  // Frozen when the session starts. Deriving this from today's date meant that
  // at midnight the key changed underneath a lifter still training, and a
  // refresh could no longer find their draft.
  const draftKeyRef = useRef(`${client.id}:${phaseId}:${dayId}:${todayStr()}`);
  const draftKey = draftKeyRef.current;
  const restored = useMemo(() => readDraft(draftKey), [draftKey]);

  const [warmupChecked, setWarmupChecked] = useState(() => (restored && restored.warmupChecked) || {});
  // Collapsed by default: it is the same list every session, and expanded it
  // pushed the first working set most of a screen down.
  const [expanded, setExpanded] = useState({});
  const [complete, setComplete] = useState(() => (restored && restored.complete) || {});
  const [manualPRs, setManualPRs] = useState(() => (restored && restored.manualPRs) || {});
  const [entriesBySection, setEntriesBySection] = useState(() => mergeDraftEntries(buildFreshEntries(), restored && restored.entries));
  const [notes, setNotes] = useState(() => (restored && restored.notes) || "");
  const [rpe, setRpe] = useState(() => (restored && typeof restored.rpe === "number" ? restored.rpe : 7));
  const [restoredNotice, setRestoredNotice] = useState(!!restored);
  // One id per open session, so tapping Finish again after a failed save
  // updates that session rather than appending a second copy of it.
  const sessionIdRef = useRef((restored && restored.sessionId) || uid());
  const [finished, setFinished] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [summary, setSummary] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [prHint, setPrHint] = useState(null);
  const [showFirstSetHelp, setShowFirstSetHelp] = useState(client.logs.length === 0);
  const [editingName, setEditingName] = useState(null);
  const [nameDraft, setNameDraft] = useState("");

  // Debounced so typing stays smooth; 400ms is well inside the gap between sets.
  useEffect(() => {
    if (finished) return undefined;
    const t = setTimeout(() => {
      const entries = {};
      let hasAnything = false;
      Object.keys(entriesBySection).forEach((secId) => {
        entries[secId] = (entriesBySection[secId] || []).map((en) => ({
          exerciseId: en.exerciseId,
          sets: (en.sets || []).map((s) => {
            if (String(s.weight || "").trim() || s.done) hasAnything = true;
            return { weight: s.weight, reps: s.reps, rir: s.rir, done: s.done };
          }),
        }));
      });
      if (!hasAnything && !notes.trim() && !Object.keys(warmupChecked).length) return;
      writeDraft(draftKey, { v: 1, savedAt: Date.now(), sessionId: sessionIdRef.current, entries, warmupChecked, complete, manualPRs, notes, rpe });
    }, 400);
    return () => clearTimeout(t);
  }, [entriesBySection, warmupChecked, complete, manualPRs, notes, rpe, finished, draftKey]);

  const resetAllInputs = () => {
    clearDraft(draftKey);
    setRestoredNotice(false);
    setWarmupChecked({});
    setComplete({});
    setManualPRs({});
    setEntriesBySection(buildFreshEntries());
    setNotes("");
    setRpe(7);
    setConfirmingReset(false);
  };

  const warmupItems = client.program.warmup || [];
  const totalWarmupItems = warmupItems.reduce((n, b) => n + b.items.length, 0);
  const warmupCheckedCount = Object.values(warmupChecked).filter(Boolean).length;
  const toggleWarmupItem = (id) => setWarmupChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleExpand = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleComplete = (key) => setComplete((prev) => ({ ...prev, [key]: !prev[key] }));

  const totalSections = 2 + resolvedSections.length;
  const completedCount = Object.values(complete).filter(Boolean).length;
  const percent = totalSections ? (completedCount / totalSections) * 100 : 0;

  const updateSet = (sectionId, exIdx, setIdx, field, value) => setEntriesBySection((prev) => {
    const list = [...prev[sectionId]];
    const sets = [...list[exIdx].sets];
    sets[setIdx] = { ...sets[setIdx], [field]: value };
    list[exIdx] = { ...list[exIdx], sets };
    return { ...prev, [sectionId]: list };
  });
  const substituteExercise = (sectionId, exIdx, newName) => {
    setEntriesBySection((prev) => {
      const list = [...prev[sectionId]];
      const poolKey = list[exIdx].target.rotatingPool || (day.label === "1" ? "meLowerPool" : day.label === "2" ? "meUpperPool" : null);
      const poolArr = client.program.conjugate?.[poolKey] || [];
      const chosen = poolArr.find((p) => p.name === newName);
      if (!chosen) return prev;
      list[exIdx] = { ...list[exIdx], name: chosen.name, target: { ...list[exIdx].target, name: chosen.name, rotatingPool: poolKey, purpose: chosen.notes, videoUrl: chosen.videoUrl || lookupVideo(chosen.name) || "" } };
      return { ...prev, [sectionId]: list };
    });
  };
  const togglePRFlag = async (sectionId, exIdx, setIdx) => {
    const en = entriesBySection[sectionId][exIdx];
    const s = en.sets[setIdx];
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    if (!r || (needsWeight(en.name) && !w)) return;
    const key = `${en.exerciseId}:${setIdx}`;
    if (manualPRs[key]) {
      const recordId = manualPRs[key].recordId;
      setManualPRs((prev) => { const next = { ...prev }; delete next[key]; return next; });
      if (recordId) await onRemovePR(recordId);
    } else {
      const newRecord = await onRecordPR({ exerciseName: en.name, weight: w, reps: r });
      setManualPRs((prev) => ({ ...prev, [key]: { exerciseName: en.name, weight: w, reps: r, recordId: newRecord?.id } }));
    }
  };

  const renameExercise = (sectionId, exIdx, newName) => {
    if (!newName.trim()) return;
    const en = entriesBySection[sectionId][exIdx];
    const trimmed = newName.trim();
    setEntriesBySection((prev) => {
      const list = [...prev[sectionId]];
      list[exIdx] = { ...list[exIdx], name: trimmed, target: { ...list[exIdx].target, name: trimmed } };
      return { ...prev, [sectionId]: list };
    });
    const newProgram = JSON.parse(JSON.stringify(client.program));
    if (en.target.rotatingPool) {
      const pool = newProgram.conjugate[en.target.rotatingPool];
      const item = pool.find((p) => p.name === en.name);
      if (item) item.name = trimmed;
    } else {
      for (const ph of newProgram.phases) for (const d of ph.days) for (const s of d.sections) {
        const found = s.exercises.find((x) => x.id === en.exerciseId);
        if (found) found.name = trimmed;
      }
    }
    onUpdateProgram(newProgram);
  };
  const setVideoForEntry = (sectionId, exIdx, url, field = "videoUrl") => {
    const en = entriesBySection[sectionId][exIdx];
    setEntriesBySection((prev) => {
      const list = [...prev[sectionId]];
      list[exIdx] = { ...list[exIdx], target: { ...list[exIdx].target, [field]: url } };
      return { ...prev, [sectionId]: list };
    });
    const newProgram = JSON.parse(JSON.stringify(client.program));
    if (en.target.rotatingPool) {
      const pool = newProgram.conjugate[en.target.rotatingPool];
      const item = pool.find((p) => p.name === en.name);
      if (item) item[field] = url;
    } else {
      for (const ph of newProgram.phases) for (const d of ph.days) for (const s of d.sections) {
        const found = s.exercises.find((x) => x.id === en.exerciseId);
        if (found) found[field] = url;
      }
    }
    onUpdateProgram(newProgram);
  };
  const setWarmupVideo = (itemId, url) => {
    const newProgram = JSON.parse(JSON.stringify(client.program));
    for (const block of newProgram.warmup) {
      const item = block.items.find((i) => i.id === itemId);
      if (item) item.videoUrl = url;
    }
    onUpdateProgram(newProgram);
  };

  const finishWorkout = async () => {
    if (savingSession) return;
    let totalVolume = 0; const prNameSet = new Set(); const allExercises = [];
    resolvedSections.forEach((sec) => {
      entriesBySection[sec.id].forEach((en) => {
        const validSets = en.sets.filter((s) => s.weight !== "" || s.reps !== "");
        validSets.forEach((s) => { totalVolume += (Number(s.weight) || 0) * (Number(s.reps) || 0); });
        const priorBest = lastAllTimeBest(client, en.name);
        const newBest = bestSetOf(validSets);
        if (newBest && (!priorBest || newBest.e1rm > priorBest.e1rm)) prNameSet.add(en.name);
        allExercises.push({ exerciseId: en.exerciseId, name: en.name, sets: validSets });
      });
    });
    const prEntries = Object.values(manualPRs);
    prEntries.forEach((p) => prNameSet.add(p.exerciseName));
    const session = {
      id: sessionIdRef.current, date: todayStr(), phaseId, dayId, dayLabel: day.label, weekNumber,
      exercises: allExercises, totalVolume: Math.round(totalVolume), avgRPE: rpe,
      readinessColor: client.readiness[todayStr()]?.color || null,
      warmupCompleted: totalWarmupItems > 0 && warmupCheckedCount === totalWarmupItems,
      sectionCompletion: complete, notes,
    };
    const totalSessionsCount = totalSessionsIn(client.program);
    const isFinalSession = (client.sessionsCompleted || 0) + 1 >= totalSessionsCount;
    const priorTotal = client.logs.reduce((s, l) => s + (l.totalVolume || 0), 0);
    const newTotal = priorTotal + Math.round(totalVolume);
    const newMilestones = LIFT_MILESTONES.filter((m) => m.weight > priorTotal && m.weight <= newTotal);
    // Only claim the session is saved once the write has actually landed. If it
    // failed, stay on the logging screen with every set still on screen — kvSet
    // has already shown a toast with a retry.
    setSavingSession(true);
    const result = await onSave(session);
    setSavingSession(false);
    if (result && result.ok === false) return;
    clearDraft(draftKey);
    setSummary({ totalVolume: session.totalVolume, prNames: Array.from(prNameSet), avgRPE: rpe, isFinalSession, newMilestones });
    setFinished(true);
  };

  if (finished && summary) {
    return (
      <ModalShell onClose={onClose} title="Workout complete" fullscreen>
        <div className="finish-summary">
          {summary.prNames.length > 0 && (
            <div className="pr-celebration">
              <div className="pr-celebration-icon"><Trophy size={28} /></div>
              <div className="pr-celebration-title">{summary.prNames.length === 1 ? "New Personal Record!" : `${summary.prNames.length} New Personal Records!`}</div>
              <div className="pr-celebration-list">
                {summary.prNames.map((n) => <div key={n} className="pr-celebration-chip"><Trophy size={14} color="var(--accent)" /> {n}</div>)}
              </div>
            </div>
          )}
          <div className="finish-stat"><div className="finish-stat-value">{summary.totalVolume.toLocaleString()} pounds</div><div className="finish-stat-label">Total volume</div></div>
          <div className="finish-stat"><div className="finish-stat-value">{summary.avgRPE}</div><div className="finish-stat-label">Session Rate of Perceived Exertion</div></div>
          {summary.newMilestones.length > 0 && (
            <Card title="New Lifting Milestone!">
              {summary.newMilestones.map((m) => (
                <div key={m.name} className="pr-line" style={{ fontSize: 14.5 }}>{m.emoji} Congratulations, you've lifted the weight of {m.name} since you started!</div>
              ))}
            </Card>
          )}
          {summary.isFinalSession && (
            <Card title="Twelve-Week Program Complete">
              <p className="muted" style={{ marginBottom: 12 }}>That's the final session of this block. Every workout, check-in, and Personal Record you've logged stays saved permanently — restarting resets your week and day back to the beginning, and moves your Max Effort rotation forward so the new block doesn't repeat the same exercises this one used.</p>
              <button className="btn-primary wide" onClick={async () => { await onRestartProgram(); onClose(); }}>Restart Program — Keep All My Data</button>
            </Card>
          )}
          <button className="btn-primary wide" onClick={() => { onClose(); onStartMobility(); }}>Start recovery and mobility</button>
          <button className="btn-ghost wide" onClick={onClose}>Done for now</button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} dismissOnEscape={false} title={`Day ${day.label} — ${mainLift}`}
      headerLeftExtra={<button className="icon-btn" onClick={() => setConfirmingReset(true)} title="Clear every input for this session" aria-label="Clear every input for this session"><RotateCcw size={16} /></button>}
      headerRight={<ProgressBadge percent={percent} />} fullscreen>
      {restoredNotice && !finished && (
        <div className="adjust-box" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>Picked up where you left off — everything you'd already entered for this session is back. Finish and save it when you're done.</span>
          <button className="btn-ghost" style={{ marginTop: 0, padding: "6px 10px", fontSize: 12.5 }} onClick={() => setRestoredNotice(false)}>Got it</button>
        </div>
      )}
      {confirmingReset && (
        <div className="adjust-box" style={{ marginBottom: 12 }}>
          Clear every set, checkbox, and note you've entered for this session and start over? This can't be undone.
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn-primary" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} onClick={resetAllInputs}>Yes, clear it</button>
            <button className="btn-ghost" style={{ flex: 1, marginTop: 0, justifyContent: "center" }} onClick={() => setConfirmingReset(false)}>Cancel</button>
          </div>
        </div>
      )}
      {prHint && (
        <div className="rest-banner" style={{ background: "var(--amber)", color: "#101010" }}>
          <Trophy size={16} />
          <span>Type the actual weight and reps you did for {prHint} into those two boxes first — the numbers you see now are just the recommended target, not something you've entered yet. Then tap the trophy again.</span>
          <button className="rest-dismiss" onClick={() => setPrHint(null)}><X size={14} /></button>
        </div>
      )}
      {showFirstSetHelp && (
        <div className="rest-banner" style={{ background: "var(--green)", color: "#101010" }}>
          <Info size={16} />
          <span>New here? For each set below: type the actual weight you used in the Weight box, then how many reps you actually got in the Reps box. Your entries are kept on this phone as you go, so you won't lose them if the app closes mid-session — tap Finish &amp; Save Day at the end to send the session to your account. Effort is already filled in for you — you don't need to touch it. Only tap the trophy if it's a genuine Personal Record.</span>
          <button className="rest-dismiss" onClick={() => setShowFirstSetHelp(false)}><X size={14} /></button>
        </div>
      )}
      {day.intent && <div className="intent-box" style={{ marginBottom: 12 }}>{day.intent}</div>}
      {adjustedNote && <div className="adjust-box" style={{ marginBottom: 12 }}>{adjustedNote}</div>}

      {client.logs.length < 3 && (
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          <strong>Effort</strong> is your Rate of Perceived Exertion — how hard a set felt, out of 10. It is filled in for you on every set, so there is nothing to enter.
        </div>
      )}

      {/* Warm-Up */}
      <div className="log-exercise">
        <SectionHeader title={`Warm-Up (${warmupCheckedCount} of ${totalWarmupItems})`} complete={!!complete.warmup} onToggleComplete={() => toggleComplete("warmup")} expanded={!!expanded.warmup} onToggleExpand={() => toggleExpand("warmup")} />
        {expanded.warmup && warmupItems.map((block) => (
          <div key={block.id} className="warmup-block">
            <div className="warmup-block-head">{block.block} <span className="muted">— {block.duration}</span></div>
            {block.items.map((item) => (
              <div key={item.id} className="warmup-item">
                <input type="checkbox" checked={!!warmupChecked[item.id]} onChange={() => toggleWarmupItem(item.id)} />
                <div style={{ flex: 1 }}>
                  <div className="warmup-item-name">{item.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{item.detail}</div>
                  <VideoLinkBlock canEdit={isCoach} url={item.videoUrl || lookupVideo(item.name)} onSave={(url) => setWarmupVideo(item.id, url)} onDelete={() => setWarmupVideo(item.id, "")} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Day-specific sections */}
      {resolvedSections.map((sec) => (
        <div className="log-exercise" key={sec.id}>
          <SectionHeader title={sectionHeadline(sec)} subtitle={SECTION_LABELS[sec.type]} complete={!!complete[sec.id]} onToggleComplete={() => toggleComplete(sec.id)} expanded={expanded[sec.id] !== false} onToggleExpand={() => toggleExpand(sec.id)} />
          {expanded[sec.id] !== false && sec.skipped && <div className="muted" style={{ marginTop: 10, fontStyle: "italic" }}>Skipped today — recovery priority given your readiness check-in.</div>}
          {expanded[sec.id] !== false && !sec.skipped && entriesBySection[sec.id].map((en, exIdx) => {
            const last = lastSessionFor(client, en.name);
            const lastWeek = lastWeekBest(client, en.name, weekNumber);
            const inferredPoolKey = en.target.rotatingPool || (sec.type === "strength" && exIdx === 0 ? (day.label === "1" ? "meLowerPool" : day.label === "2" ? "meUpperPool" : null) : null);
            const poolOptions = inferredPoolKey ? (client.program.conjugate?.[inferredPoolKey] || []) : [];
            const displayName = en.name || poolOptions[0]?.name || "Exercise unavailable";
            const filledSetCount = en.sets.filter((s) => (needsWeight(displayName) ? (Number(s.weight) || 0) > 0 : String(s.reps || "").trim() !== "")).length;
            const allSetsFilled = en.sets.length > 0 && filledSetCount === en.sets.length;
            const exOpen = exCollapseOverride[en.exerciseId] !== undefined ? exCollapseOverride[en.exerciseId] : !allSetsFilled;
            const collapsedSummary = exOpen ? "" : loggedSummaryFor(en, displayName);
            return (
              <div className={`section-ex-block${/^\d+A$/.test(en.target.supersetLabel || "") ? " ss-a" : /^\d+B$/.test(en.target.supersetLabel || "") ? " ss-b" : ""}`} key={en.exerciseId}>
                <div className="log-exercise-target-wrap">
                  <div className="ex-name-row">
                    {editingName === en.exerciseId ? (
                      <div style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}>
                        <input className="rename-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
                        <button className="icon-btn-sm" onClick={() => { renameExercise(sec.id, exIdx, nameDraft); setEditingName(null); }} aria-label="Save exercise name"><Check size={16} /></button>
                        <button className="icon-btn-sm" onClick={() => setEditingName(null)} aria-label="Cancel renaming exercise"><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="log-exercise-name" style={{ fontSize: 14.5 }}>
                        {en.target.supersetLabel ? (
                          <span className="superset-tag">{en.target.supersetLabel}</span>
                        ) : (
                          en.target.quality && <span className="superset-tag quality-tag">{en.target.quality}</span>
                        )}
                        {displayName}
                        {inferredPoolKey && <span className="recommended-tag">Recommended</span>}
                        <button className="icon-btn-sm" onClick={() => { setEditingName(en.exerciseId); setNameDraft(displayName); }} title="Rename this exercise" aria-label="Rename this exercise"><Pencil size={13} /></button>
                        <button className="icon-btn-sm" onClick={() => toggleExerciseOpen(en.exerciseId, exOpen)} aria-expanded={exOpen} title={exOpen ? "Collapse this exercise" : "Expand this exercise"} aria-label={exOpen ? "Collapse this exercise" : "Expand this exercise"}><ChevronRight size={14} className={exOpen ? "chev-open" : ""} /></button>
                      </div>
                    )}
                  </div>
                  {collapsedSummary && <div className="last-logged" style={{ marginTop: 2 }}>{collapsedSummary}</div>}
                  {exOpen && (<>
                  {sec.type === "conditioning" ? (
                    <ConditioningPlan target={en.target} name={displayName} />
                  ) : (
                    <div className="log-exercise-target">Target: {en.target.sets} sets of {en.target.reps} {en.target.load ? `— ${en.target.load}` : ""} {en.target.rir !== undefined ? `— Rate of Perceived Exertion ${rpeFromRir(en.target.rir)}` : ""}{en.target.tempo ? ` — Tempo ${en.target.tempo}` : ""}</div>
                  )}
                  {en.target.tempo ? <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{TEMPO_LEGEND}</div> : null}
                  {en.target.injuryNote && (
                    <div className="intent-box" style={{ marginTop: 8, fontSize: 12.5 }}>
                      {en.target.substitutedFor ? <><strong>Swapped from {en.target.substitutedFor}.</strong>{" "}</> : <><strong>Eased back.</strong>{" "}</>}
                      {en.target.injuryNote}
                    </div>
                  )}
                  {en.target.rest && <div className="rest-note-static">Rest: {en.target.rest}</div>}
                  {sec.type !== "conditioning" && en.target.purpose && <div className="log-exercise-cue">{en.target.purpose}</div>}
                  {sec.type !== "conditioning" && en.target.cues && <div className="log-exercise-cue" style={{ marginTop: 6 }}>{en.target.cues}</div>}
                  {lastWeek ? (
                    <div className="last-logged">Last week, heaviest: {needsWeight(displayName) ? `${lastWeek.weight} pounds × ` : ""}{lastWeek.reps} {exerciseUnit(displayName, en.target.reps)}</div>
                  ) : (
                    last?.best && <div className="last-logged">Last logged: {needsWeight(displayName) ? `${last.best.weight} pounds × ` : ""}{last.best.reps} {exerciseUnit(displayName, en.target.reps)} ({fmtDate(last.date)})</div>
                  )}
                  <VideoLinkBlock canEdit={isCoach} url={en.target.videoUrl} onSave={(url) => setVideoForEntry(sec.id, exIdx, url)} onDelete={() => setVideoForEntry(sec.id, exIdx, "")} label={en.target.videoUrl2 !== undefined ? "Demo 1" : undefined} />
                  {en.target.videoUrl2 !== undefined && (
                    <VideoLinkBlock canEdit={isCoach} url={en.target.videoUrl2} onSave={(url) => setVideoForEntry(sec.id, exIdx, url, "videoUrl2")} onDelete={() => setVideoForEntry(sec.id, exIdx, "", "videoUrl2")} label="Demo 2" />
                  )}
                  {poolOptions.length > 0 && (
                    <div className="sub-row">
                      <div className="muted" style={{ fontSize: 13, width: "100%" }}>Bothered by this one? Tap another exercise to swap it in:</div>
                      <div className="sub-pill-row">
                        {poolOptions.map((p) => (
                          <button key={p.name} className={`sub-pill ${p.name === displayName ? "active" : ""}`} onClick={() => substituteExercise(sec.id, exIdx, p.name)}>{p.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  </>)}
                </div>
                {exOpen && (<>
                {sec.type === "conditioning" ? (() => {
                  const plan = parseConditioning(en.target.reps);
                  const suggestion = plan
                    ? (plan.kind === "intervals"
                        ? (plan.totalMins ? String(plan.totalMins) : "")
                        : plan.duration.replace(/\s*min$/, ""))
                    : "";
                  return (
                    <div className="cond-log">
                      <label className="cond-log-label" htmlFor={`cond-${en.exerciseId}`}>
                        How long did you actually go?
                      </label>
                      <div className="cond-log-row">
                        <input id={`cond-${en.exerciseId}`} type="text" inputMode="numeric"
                          placeholder={suggestion}
                          value={en.sets[0] ? en.sets[0].reps : ""}
                          onChange={(e) => updateSet(sec.id, exIdx, 0, "reps", e.target.value)} />
                        <span className="cond-log-unit">{exerciseUnitLabel(displayName, en.target.reps).toLowerCase()}</span>
                      </div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                        {plan && plan.kind === "intervals"
                          ? "Total time end to end, including the easy recovery between rounds. Coming in short is still worth logging — it is what tells you and your coach how the week actually went."
                          : "Coming in short is still worth logging — it is what tells you and your coach how the week actually went."}
                      </p>
                    </div>
                  );
                })() : (<>
                <div className="set-grid-header"><span>Set</span><span>{needsWeight(displayName) ? "Weight" : ""}</span><span>{exerciseUnitLabel(displayName, en.target.reps)}</span><span /></div>
                {en.target.perSetTargets && (
                  <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Each set has its own target below — the weight naturally climbs as reps come down, ending on a true top single.</div>
                )}
                {(() => {
                  const isMainLift = sec.type === "strength" || sec.type === "power";
                  const loggedSessions = isMainLift ? sessionsLoggedFor(client, displayName) : 0;
                  // Hold the suggestion back until a second session corroborates it.
                  const priorBestForPct = loggedSessions >= 2 ? lastAllTimeBest(client, displayName) : null;
                  const pctForSet = (i) => {
                    if (i < 0 || i >= en.sets.length) return null;
                    const ps = en.target.perSetTargets ? en.target.perSetTargets[i] : null;
                    return ps?.pct1rm ?? en.target.pct1rmFlat ?? null;
                  };
                  return en.sets.map((s, setIdx) => {
                    const perSet = en.target.perSetTargets ? en.target.perSetTargets[setIdx] : null;
                    const effectivePct = pctForSet(setIdx);
                    const setFlagged = !!manualPRs[`${en.exerciseId}:${setIdx}`];
                    // The trophy only appears once the set actually beats their best
                    // on this lift. Offering it on every row made it a decision to
                    // make forty times a session instead of a moment worth marking.
                    const allTimeBest = lastAllTimeBest(client, displayName);
                    const thisSetE1rm = est1RM(Number(s.weight) || 0, Number(s.reps) || 0);
                    const beatsBest = thisSetE1rm > 0 && (!allTimeBest || thisSetE1rm >= allTimeBest.e1rm);
                    const setHasData = needsWeight(displayName) ? (Number(s.weight) || 0) > 0 : String(s.reps || "").trim() !== "";
                    const targetWeight = effectivePct && priorBestForPct ? Math.round((priorBestForPct.e1rm * effectivePct) / 100) : null;
                    // Consecutive sets at the same percentage share one note above
                    // them, rather than repeating an identical line under each.
                    const startsRun = !!effectivePct && (setIdx === 0 || pctForSet(setIdx - 1) !== effectivePct);
                    let runEnd = setIdx;
                    while (runEnd + 1 < en.sets.length && pctForSet(runEnd + 1) === effectivePct) runEnd++;
                    // Labels like "Top single" are far wider than the set-number
                    // column, so they ride on this line instead of overlapping
                    // the weight box.
                    const runNotes = [];
                    for (let i = setIdx; i <= runEnd; i++) {
                      const n = en.target.perSetTargets ? en.target.perSetTargets[i]?.note : null;
                      if (n && !runNotes.includes(n)) runNotes.push(n);
                    }
                    const runNote = runNotes.join(" / ");
                    const runEfforts = [];
                    for (let i = setIdx; i <= runEnd; i++) {
                      const t = en.target.perSetTargets ? en.target.perSetTargets[i] : null;
                      const r = t && t.rir !== undefined ? t.rir : en.target.rir;
                      if (r !== undefined && r !== null && r !== "" && !runEfforts.includes(r)) runEfforts.push(r);
                    }
                    const runEffort = runEfforts.length === 1 ? rpeFromRir(runEfforts[0]) : null;
                    // The "log this and we'll suggest a weight" line is the same
                    // on every run, so it only earns its place once.
                    const isFirstRun = !en.sets.some((_, i) => i < setIdx && pctForSet(i));
                    return (
                      <React.Fragment key={setIdx}>
                        {startsRun && (
                          <div className="pct-1rm-row">
                            {runEnd > setIdx ? `Sets ${setIdx + 1}\u2013${runEnd + 1}` : `Set ${setIdx + 1}`}{runNote ? ` \u00b7 ${runNote}` : ""}: {effectivePct}% of your One-Rep Max{runEffort ? ` \u00b7 effort ${runEffort}` : ""}
                            {targetWeight
                              ? ` \u2014 try about ${targetWeight} lb, based on your heaviest logged set so far`
                              : !isFirstRun
                                ? ""
                                : loggedSessions === 0
                                  ? " \u2014 once you log this exercise, future sessions will suggest a weight"
                                  : loggedSessions === 1
                                    ? " \u2014 log this once more and future sessions will suggest a weight"
                                    : ""}
                          </div>
                        )}
                        <div className="set-grid-row">
                          <span className="set-num">{setIdx + 1}</span>
                          {needsWeight(displayName) ? (
                            <input type="number" step="0.1" inputMode="decimal" min="0" max="2000" placeholder={targetWeight ? String(targetWeight) : "pounds"} aria-label={`${displayName}, set ${setIdx + 1}, weight in pounds`} value={s.weight} onChange={(e) => updateSet(sec.id, exIdx, setIdx, "weight", e.target.value)} />
                          ) : (
                            <span aria-hidden="true" />
                          )}
                          <input type="text" inputMode="numeric" aria-label={`${exerciseUnitLabel(displayName, en.target.reps)} completed`} placeholder={perSet ? String(perSet.reps) : String(en.target.reps)} value={s.reps} onChange={(e) => updateSet(sec.id, exIdx, setIdx, "reps", e.target.value)} />
                          {(beatsBest || setFlagged) ? (
                          <button type="button" className={`set-pr ${setFlagged ? "flagged" : ""}`} aria-pressed={setFlagged} aria-label={`${setFlagged ? "Remove" : "Mark"} set ${setIdx + 1} as a Personal Record`} onClick={() => { if (!setHasData) { setPrHint(`${en.name} — set ${setIdx + 1}`); return; } togglePRFlag(sec.id, exIdx, setIdx); }} title={setHasData ? "Mark this set as a Personal Record" : "Enter a weight first, then tap to mark a Personal Record"}><Trophy size={15} /></button>
                          ) : <span aria-hidden="true" />}
                        </div>
                      </React.Fragment>
                    );
                  });
                })()}
                </>)}
                </>)}
              </div>
            );
          })}
        </div>
      ))}

      {/* Cool-Down Mobility */}
      <div className="log-exercise">
        <SectionHeader title="Cool-Down Mobility" subtitle="Slow breathing first, then range-of-motion work" complete={!!complete.cooldown} onToggleComplete={() => toggleComplete("cooldown")} expanded={!!expanded.cooldown} onToggleExpand={() => toggleExpand("cooldown")} />
        {expanded.cooldown && (
          <div style={{ marginTop: 10 }}>
            <p className="muted" style={{ marginBottom: 10 }}>Best done right after training, or later if you're pressed for time — mark it complete once you've done it.</p>
            <button className="btn-ghost wide" onClick={onStartMobility}>Begin cool-down mobility</button>
          </div>
        )}
      </div>

      <div className="log-exercise"><div className="log-exercise-head"><h3 className="log-exercise-name">Session Rate of Perceived Exertion</h3></div><SliderRow label="Overall difficulty" value={rpe} max={10} onChange={setRpe} /></div>
      <div className="log-exercise"><div className="log-exercise-head"><h3 className="log-exercise-name">Notes</h3></div><textarea className="notes-box" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How it felt, anything to flag…" /></div>
      <button className="btn-primary wide" style={{ margin: "16px 0 40px" }} onClick={finishWorkout} disabled={savingSession}>{savingSession ? "Saving…" : "Finish & save day"}</button>
    </ModalShell>
  );
}
// The one-line recap a finished exercise collapses down to, so the exercise
// being worked on stays on screen instead of being pushed below completed ones.
function loggedSummaryFor(entry, name) {
  const sets = entry.sets || [];
  const weighted = needsWeight(name);
  const filled = sets.filter((s) => (weighted ? (Number(s.weight) || 0) > 0 : String(s.reps || "").trim() !== ""));
  if (!filled.length) return "";
  const count = `${filled.length} of ${sets.length} sets logged`;
  if (weighted) {
    const best = bestSetOf(sets);
    return best ? `${count} \u2014 heaviest ${best.weight} lb \u00d7 ${best.reps}` : count;
  }
  const unit = exerciseUnit(name, entry.target ? entry.target.reps : "");
  return `${count} \u2014 ${filled.map((s) => String(s.reps).trim()).join(", ")} ${unit}`;
}
// How many separate sessions have a usable logged set for this exercise.
// A percentage-based weight suggestion is only as good as the history behind
// it, and a single light feeling-it-out set produces suggestions that look
// broken ("try about 14 lb" on a squat) and then persist for weeks, since the
// estimate is taken from the heaviest set ever logged.
function sessionsLoggedFor(client, exerciseName) {
  let sessions = 0;
  for (const log of client.logs || []) {
    const en = log.exercises.find((e) => e.name === exerciseName);
    if (en && bestSetOf(en.sets)) sessions++;
  }
  return sessions;
}
function lastAllTimeBest(client, exerciseName) {
  let best = null;
  for (const log of client.logs) { const en = log.exercises.find((e) => e.name === exerciseName); if (!en) continue; const b = bestSetOf(en.sets); if (b && (!best || b.e1rm > best.e1rm)) best = { ...b, date: log.date }; }
  return best;
}
// Every session this exercise was logged, not just the ones flagged as a Personal
// Record — the continuous trend a client actually needs to see whether they're
// getting stronger or weaker, with PR dates called out within it rather than
// shown as the only points on the chart. One point per date: the best set that
// session (heaviest weight for loaded lifts, highest reps/seconds/meters for
// exercises with no external load). Falls back to the Personal Record entry
// itself if a flagged PR has no matching session log.
function exerciseHistorySeries(client, exerciseName) {
  const useWeight = needsWeight(exerciseName);
  const byDate = new Map();
  for (const log of client.logs || []) {
    const en = log.exercises.find((e) => e.name === exerciseName);
    if (!en) continue;
    let value = null;
    let reps = null;
    if (useWeight) {
      const best = bestSetOf(en.sets);
      if (!best) continue;
      value = best.weight;
      reps = best.reps;
    } else {
      for (const s of en.sets || []) {
        const r = Number(s.reps) || 0;
        if (!r) continue;
        if (value === null || r > value) { value = r; reps = r; }
      }
      if (value === null) continue;
    }
    const existing = byDate.get(log.date);
    if (!existing || value > existing.value) byDate.set(log.date, { date: log.date, value, reps, isPR: existing ? existing.isPR : false });
  }
  for (const p of client.prLog || []) {
    if (p.exerciseName !== exerciseName) continue;
    const existing = byDate.get(p.date);
    if (existing) existing.isPR = true;
    else byDate.set(p.date, { date: p.date, value: useWeight ? p.weight : p.reps, reps: p.reps, isPR: true });
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* ============================== MOBILITY / RECOVERY SESSION ============================== */

function MobilitySession({ client, isCoach, onClose, onSave, onUpdateProgram }) {
  const segments = client.program.mobility && client.program.mobility.length ? client.program.mobility : defaultMobility();
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(segments[0]?.seconds || 0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [notes, setNotes] = useState("");
  const timerRef = useRef(null);

  const totalSeconds = segments.reduce((s, seg) => s + seg.seconds, 0);
  const elapsedBefore = segments.slice(0, idx).reduce((s, seg) => s + seg.seconds, 0);

  useEffect(() => { clearInterval(timerRef.current); setRunning(false); setRemaining(segments[idx]?.seconds || 0); }, [idx]); // eslint-disable-line
  useEffect(() => () => clearInterval(timerRef.current), []);

  const goNext = useCallback(() => {
    clearInterval(timerRef.current);
    setRunning(false);
    setIdx((i) => { if (i + 1 >= segments.length) { setDone(true); return i; } return i + 1; });
  }, [segments.length]);

  const toggleRunning = () => {
    if (running) { clearInterval(timerRef.current); setRunning(false); return; }
    setRunning(true);
    timerRef.current = setInterval(() => {
      setRemaining((r) => { if (r <= 1) { clearInterval(timerRef.current); goNext(); return 0; } return r - 1; });
    }, 1000);
  };

  const setSegmentVideo = (segId, url) => {
    const newProgram = JSON.parse(JSON.stringify(client.program));
    const seg = (newProgram.mobility || []).find((s) => s.id === segId);
    if (seg) seg.videoUrl = url;
    onUpdateProgram(newProgram);
  };

  if (done) {
    return (
      <ModalShell onClose={onClose} title="Recovery Complete" fullscreen>
        <div className="finish-summary">
          <div className="finish-stat"><div className="finish-stat-value">{Math.round(totalSeconds / 60)} minutes</div><div className="finish-stat-label">Total mobility time</div></div>
          <div className="log-exercise">
            <div className="log-exercise-head"><h3 className="log-exercise-name">Session Notes</h3></div>
            <textarea className="notes-box" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did mobility feel? Anything tight, anything to flag…" />
          </div>
          <button className="btn-primary wide" onClick={async () => { const r = await onSave({ id: uid(), date: todayStr(), totalSeconds, notes }); if (r && r.ok === false) return; onClose(); }}>Save & finish</button>
        </div>
      </ModalShell>
    );
  }

  const seg = segments[idx];
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <ModalShell onClose={onClose} dismissOnEscape={false} title="Recovery & Mobility" fullscreen>
      <div className="muted" style={{ marginBottom: 8 }}>Segment {idx + 1} of {segments.length} — {Math.round(elapsedBefore / 60)} of {Math.round(totalSeconds / 60)} minutes elapsed</div>
      <div className="card" style={{ textAlign: "center" }}>
        <div className="mobility-type-tag">{seg.type === "breath" ? "Breathwork" : "Stretch"}</div>
        <h3 className="log-exercise-name" style={{ fontSize: 20, marginTop: 6, marginBottom: 6 }}>{seg.name}</h3>
        {seg.detail && <p className="muted" style={{ marginBottom: 10 }}>{seg.detail}</p>}
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}><VideoLinkBlock canEdit={isCoach} url={seg.videoUrl || lookupVideo(seg.name)} onSave={(url) => setSegmentVideo(seg.id, url)} onDelete={() => setSegmentVideo(seg.id, "")} /></div>
        <div className="mobility-timer">{mins}:{String(secs).padStart(2, "0")}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={toggleRunning}>{running ? "Pause" : "Start"}</button>
          <button className="btn-ghost" style={{ flex: 1, marginTop: 0 }} onClick={goNext}>Skip / Next</button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ============================== PROGRAM TAB ============================== */

function ScheduleTab({ client }) {
  const totalWeeks = Math.max(...client.program.phases.map((p) => p.weekEnd));
  const currentWeek = Math.max(1, Math.floor((client.sessionsCompleted || 0) / (client.program.sessionsPerWeek || 3)) + 1);
  const [openWeek, setOpenWeek] = useState(Math.min(currentWeek, totalWeeks));

  return (
    <div>
      <div className="program-title">Full Schedule — All {totalWeeks} Weeks</div>
      <p className="muted" style={{ marginBottom: 14 }}>A condensed look at every day of every week, so you can see what's coming before you get there. Tap a week to expand it.</p>
      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
        const phase = client.program.phases.find((p) => week >= p.weekStart && week <= p.weekEnd);
        if (!phase) return null;
        const isDeload = phase.name.toLowerCase().includes("deload");
        const isCurrentWeek = week === currentWeek;
        const open = openWeek === week;
        return (
          <div key={week} className="phase-block">
            <button className="phase-header" onClick={() => setOpenWeek(open ? null : week)}>
              <div>
                <div className="phase-weeks">Week {week}{isDeload ? " — Deload" : ""}{isCurrentWeek ? " · Current" : ""}</div>
                <div className="phase-name">{phase.name}</div>
              </div>
              <ChevronRight size={18} className={open ? "chev-open" : ""} />
            </button>
            {open && (
              <div className="phase-body">
                {phase.days.map((day) => {
                  const lift = primaryLiftName(day, week, client.program, phase, resolveOptsFor(client));
                  const resolvedSections = resolveDaySections(day, week, client.program, phase, !!client.veteranMode, resolveOptsFor(client));
                  return (
                    <div key={day.id} className="day-card">
                      <div className="day-card-head">
                        <span className="day-badge">{day.label}</span>
                        <span className="day-name">{lift}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{day.name}</div>
                      {resolvedSections.map((sec) => (
                        sec.exercises.length > 0 && (
                          <div key={sec.id} style={{ marginBottom: 6 }}>
                            <div className="section-subheading" style={{ margin: "4px 0 2px" }}>{sec.name || SECTION_LABELS[sec.type]}</div>
                            {sec.exercises.map((e, i) => {
                              const fallbackPoolKey = i === 0 && (sec.type === "strength" || sec.type === "power") ? (day.label === "1" ? "meLowerPool" : day.label === "2" ? "meUpperPool" : null) : null;
                              const displayName = e.name || (fallbackPoolKey ? client.program.conjugate?.[fallbackPoolKey]?.[0]?.name : "") || "Exercise";
                              return <div key={e.id} className="program-ex-row"><span>{displayName}</span><span className="muted">{e.sets} sets of {e.reps}</span></div>;
                            })}
                          </div>
                        )
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProgramTab({ client, onPersist }) {
  const [view, setView] = useState("overview"); // "overview" | "schedule"
  const [openPhase, setOpenPhase] = useState(client.program.phases[0]?.id);
  const [editingDay, setEditingDay] = useState(null);
  const [editingWarmup, setEditingWarmup] = useState(false);
  const [editingPools, setEditingPools] = useState(false);
  const perWeek = client.program.sessionsPerWeek || 3;
  const currentWeekNumber = Math.max(1, Math.floor((client.sessionsCompleted || 0) / perWeek) + 1);

  const viewToggle = (
    <div className="view-toggle-row">
      <button className={`view-toggle-btn ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}>Overview</button>
      <button className={`view-toggle-btn ${view === "schedule" ? "active" : ""}`} onClick={() => setView("schedule")}>Full Schedule</button>
    </div>
  );

  if (view === "schedule") {
    return (
      <div className="pad">
        {viewToggle}
        <ScheduleTab client={client} />
      </div>
    );
  }

  return (
    <div className="pad">
      {viewToggle}
      <div className="program-title">{client.program.name}</div>

      {client.program.coachNote && <Card title="From the Coach"><p className="muted">{client.program.coachNote}</p></Card>}
      {client.program.philosophy && <Card title="Effort Philosophy" right={<Info size={16} color="var(--text-dim)" />}><p className="muted">{client.program.philosophy}</p></Card>}
      {client.program.methodology && <Card title="Methodology"><p className="muted">{client.program.methodology}</p></Card>}

      <div className="program-actions">
        <button className="btn-ghost" onClick={() => setEditingWarmup(true)}><Pencil size={14} /> Edit warm-up</button>
        <button className="btn-ghost" onClick={() => setEditingPools(true)}><Pencil size={14} /> Edit Max Effort pools</button>
      </div>

      {client.program.phases.map((phase) => (
        <div key={phase.id} className="phase-block">
          <button className="phase-header" onClick={() => setOpenPhase(openPhase === phase.id ? null : phase.id)}>
            <div><div className="phase-weeks">Weeks {phase.weekStart} to {phase.weekEnd}{phase.dePercent ? ` — Dynamic Effort ${phase.dePercent}` : ""}</div><div className="phase-name">{phase.name}</div></div>
            <ChevronRight size={18} className={openPhase === phase.id ? "chev-open" : ""} />
          </button>
          {openPhase === phase.id && (
            <div className="phase-body">
              {phase.objective && <p className="muted" style={{ marginBottom: 10 }}>{phase.objective}</p>}
              {phase.days.map((day) => (
                <div key={day.id} className="day-card">
                  <div className="day-card-head">
                    <span className="day-badge">{day.label}</span><span className="day-name">{day.name}</span>
                    <button className="icon-btn small" onClick={() => setEditingDay({ phaseId: phase.id, dayId: day.id })} aria-label={`Edit Day ${day.label}`}><Pencil size={14} /></button>
                  </div>
                  {day.intent && <div className="day-intent-preview">{day.intent}</div>}
                  {day.sections.map((sec) => {
                    const firstEx = sec.exercises[0];
                    const showsRecommended = (sec.type === "strength" || sec.type === "power") && firstEx?.rotatingPool;
                    const recommendedName = showsRecommended ? resolveExercise(firstEx, currentWeekNumber, client.program, phase, resolveOptsFor(client)).name : null;
                    return (
                    <div key={sec.id} style={{ marginBottom: 8 }}>
                      <div className="section-subheading">{recommendedName || sec.name}{recommendedName ? <span className="recommended-tag" style={{ marginLeft: 8 }}>Recommended this week</span> : null}</div>
                      {sec.exercises.map((e) => (
                        <div key={e.id} className="program-ex-row">
                          <span>
                            {e.rotatingPool
                              ? `${poolLabelFor(e.rotatingPool)} — rotates through: ${(client.program.conjugate?.[e.rotatingPool] || []).map((p) => p.name).join(", ")}`
                              : e.name}
                          </span>
                          <span className="muted">{e.sets} sets of {e.reps}{e.rir !== undefined ? `, Rate of Perceived Exertion ${rpeFromRir(e.rir)}` : ""}</span>
                        </div>
                      ))}
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {editingDay && <DayEditor client={client} phaseId={editingDay.phaseId} dayId={editingDay.dayId} onClose={() => setEditingDay(null)} onPersist={onPersist} />}
      {editingWarmup && <WarmupEditor client={client} onClose={() => setEditingWarmup(false)} onPersist={onPersist} />}
      {editingPools && <MEPoolEditor client={client} onClose={() => setEditingPools(false)} onPersist={onPersist} />}
    </div>
  );
}

function DayEditor({ client, phaseId, dayId, onClose, onPersist }) {
  const phase = client.program.phases.find((p) => p.id === phaseId);
  const day = phase.days.find((d) => d.id === dayId);
  const [dayName, setDayName] = useState(day.name);
  const [intent, setIntent] = useState(day.intent || "");
  const [sections, setSections] = useState(JSON.parse(JSON.stringify(day.sections)));

  const updateSectionField = (sIdx, field, value) => setSections((prev) => { const next = [...prev]; next[sIdx] = { ...next[sIdx], [field]: value }; return next; });
  const updateExField = (sIdx, exIdx, field, value) => setSections((prev) => {
    const next = [...prev];
    const exercises = [...next[sIdx].exercises];
    const updatedEx = { ...exercises[exIdx], [field]: value };
    if (field === "name" && updatedEx.rotatingPool) updatedEx.rotatingPool = undefined;
    exercises[exIdx] = updatedEx;
    next[sIdx] = { ...next[sIdx], exercises };
    return next;
  });
  const addExercise = (sIdx) => setSections((prev) => { const next = [...prev]; next[sIdx] = { ...next[sIdx], exercises: [...next[sIdx].exercises, ex({ name: "New exercise" })] }; return next; });
  const removeExercise = (sIdx, exIdx) => setSections((prev) => { const next = [...prev]; next[sIdx] = { ...next[sIdx], exercises: next[sIdx].exercises.filter((_, i) => i !== exIdx) }; return next; });
  const addSection = () => setSections((prev) => [...prev, { id: uid(), type: "durability", name: "New Section", exercises: [] }]);
  const removeSection = (sIdx) => setSections((prev) => prev.filter((_, i) => i !== sIdx));

  const save = async () => {
    const updated = { ...client, program: { ...client.program, phases: client.program.phases.map((p) => p.id !== phaseId ? p : { ...p, days: p.days.map((d) => d.id !== dayId ? d : { ...d, name: dayName, intent, sections }) }) } };
    await onPersist(updated);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} title={`Edit Day ${day.label}`} fullscreen>
      <LabeledInput label="Day name" value={dayName} onChange={setDayName} />
      <label className="labeled-input"><span>Effort note (how hard and why)</span><textarea className="notes-box" rows={2} value={intent} onChange={(e) => setIntent(e.target.value)} /></label>

      {sections.map((sec, sIdx) => (
        <div className="edit-ex-card" key={sec.id} style={{ borderColor: "var(--accent)" }}>
          <div className="edit-ex-row">
            <input className="edit-input wide-input" value={sec.name} onChange={(e) => updateSectionField(sIdx, "name", e.target.value)} placeholder="Section name" />
            <button className="icon-btn small" onClick={() => removeSection(sIdx)} aria-label="Remove this section"><Trash2 size={14} /></button>
          </div>
          {sec.exercises.map((e, exIdx) => (
            <div className="edit-ex-card" key={e.id}>
              <div className="edit-ex-row">
                <input className="edit-input wide-input" value={e.name} onChange={(ev) => updateExField(sIdx, exIdx, "name", ev.target.value)} placeholder="Exercise name" />
                <button className="icon-btn small" onClick={() => removeExercise(sIdx, exIdx)} aria-label="Remove this exercise"><Trash2 size={14} /></button>
              </div>
              {e.rotatingPool && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>This normally rotates through the Max Effort {e.rotatingPool === "meLowerPool" ? "Lower" : "Upper"} pool. Renaming it locks in this exercise instead of rotating.</div>}
              <div className="edit-ex-row four">
                <LabeledInput label="Sets" value={e.sets} onChange={(v) => updateExField(sIdx, exIdx, "sets", Number(v))} type="number" min="1" max="20" />
                <LabeledInput label="Reps" value={e.reps} onChange={(v) => updateExField(sIdx, exIdx, "reps", v)} />
                <LabeledInput label="Reps in reserve" value={e.rir} onChange={(v) => updateExField(sIdx, exIdx, "rir", Number(v))} type="number" min="0" max="10" />
                <LabeledInput label="Rest" value={e.rest} onChange={(v) => updateExField(sIdx, exIdx, "rest", v)} />
              </div>
              {e.deWave ? <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Load is automatically set from this phase's Dynamic Effort percentage ({phase.dePercent || "—"}).</div>
                : <LabeledInput label="Load" value={e.load} onChange={(v) => updateExField(sIdx, exIdx, "load", v)} />}
              <LabeledInput label="Purpose" value={e.purpose} onChange={(v) => updateExField(sIdx, exIdx, "purpose", v)} />
              {!e.rotatingPool && <LabeledInput label="Video link" value={e.videoUrl} onChange={(v) => updateExField(sIdx, exIdx, "videoUrl", v)} />}
              {!e.rotatingPool && <LabeledInput label="Second video link (optional)" value={e.videoUrl2 || ""} onChange={(v) => updateExField(sIdx, exIdx, "videoUrl2", v)} />}
            </div>
          ))}
          <button className="btn-ghost wide" onClick={() => addExercise(sIdx)}><Plus size={16} /> Add exercise to section</button>
        </div>
      ))}
      <button className="btn-ghost wide" onClick={addSection}><Plus size={16} /> Add section</button>
      <button className="btn-primary wide" style={{ marginTop: 14 }} onClick={save}>Save day</button>
    </ModalShell>
  );
}

function WarmupEditor({ client, onClose, onPersist }) {
  const [blocks, setBlocks] = useState(JSON.parse(JSON.stringify(client.program.warmup || defaultWarmup())));
  const updateBlockField = (bIdx, field, value) => setBlocks((prev) => { const next = [...prev]; next[bIdx] = { ...next[bIdx], [field]: value }; return next; });
  const updateItemField = (bIdx, iIdx, field, value) => setBlocks((prev) => { const next = [...prev]; const items = [...next[bIdx].items]; items[iIdx] = { ...items[iIdx], [field]: value }; next[bIdx] = { ...next[bIdx], items }; return next; });
  const addItem = (bIdx) => setBlocks((prev) => { const next = [...prev]; next[bIdx] = { ...next[bIdx], items: [...next[bIdx].items, { id: uid(), name: "New item", detail: "", videoUrl: "" }] }; return next; });
  const removeItem = (bIdx, iIdx) => setBlocks((prev) => { const next = [...prev]; next[bIdx] = { ...next[bIdx], items: next[bIdx].items.filter((_, i) => i !== iIdx) }; return next; });
  const addBlock = () => setBlocks((prev) => [...prev, { id: uid(), block: "New Block", duration: "", items: [] }]);
  const removeBlock = (bIdx) => setBlocks((prev) => prev.filter((_, i) => i !== bIdx));
  const save = async () => { await onPersist({ ...client, program: { ...client.program, warmup: blocks } }); onClose(); };

  return (
    <ModalShell onClose={onClose} title="Edit Warm-Up" fullscreen>
      {blocks.map((block, bIdx) => (
        <div className="edit-ex-card" key={block.id}>
          <div className="edit-ex-row">
            <input className="edit-input wide-input" value={block.block} onChange={(e) => updateBlockField(bIdx, "block", e.target.value)} placeholder="Block name" />
            <input className="edit-input" style={{ width: 100 }} value={block.duration} onChange={(e) => updateBlockField(bIdx, "duration", e.target.value)} placeholder="Duration" />
            <button className="icon-btn small" onClick={() => removeBlock(bIdx)} aria-label="Remove this block"><Trash2 size={14} /></button>
          </div>
          {block.items.map((item, iIdx) => (
            <div key={item.id} className="edit-ex-card">
              <div className="edit-ex-row">
                <input className="edit-input" style={{ flex: 1 }} value={item.name} onChange={(e) => updateItemField(bIdx, iIdx, "name", e.target.value)} placeholder="Item" />
                <button className="icon-btn small" onClick={() => removeItem(bIdx, iIdx)} aria-label="Remove this item"><Trash2 size={14} /></button>
              </div>
              <input className="edit-input wide-input" style={{ marginBottom: 8 }} value={item.detail} onChange={(e) => updateItemField(bIdx, iIdx, "detail", e.target.value)} placeholder="Detail" />
              <LabeledInput label="Video link" value={item.videoUrl} onChange={(v) => updateItemField(bIdx, iIdx, "videoUrl", v)} />
            </div>
          ))}
          <button className="btn-ghost" onClick={() => addItem(bIdx)}><Plus size={14} /> Add item</button>
        </div>
      ))}
      <button className="btn-ghost wide" onClick={addBlock}><Plus size={16} /> Add block</button>
      <button className="btn-primary wide" style={{ marginTop: 14 }} onClick={save}>Save warm-up</button>
    </ModalShell>
  );
}

function MEPoolEditor({ client, onClose, onPersist }) {
  const [conj, setConj] = useState(JSON.parse(JSON.stringify(client.program.conjugate || { meLowerPool: [], meUpperPool: [], meRotationWeeks: 2 })));
  const updatePoolItem = (poolKey, idx, field, value) => setConj((prev) => { const pool = [...prev[poolKey]]; pool[idx] = { ...pool[idx], [field]: value }; return { ...prev, [poolKey]: pool }; });
  const addPoolItem = (poolKey) => setConj((prev) => ({ ...prev, [poolKey]: [...prev[poolKey], { name: "New exercise", notes: "", videoUrl: "" }] }));
  const removePoolItem = (poolKey, idx) => setConj((prev) => ({ ...prev, [poolKey]: prev[poolKey].filter((_, i) => i !== idx) }));
  const save = async () => { await onPersist({ ...client, program: { ...client.program, conjugate: conj } }); onClose(); };

  const renderPool = (poolKey, label) => (
    <div className="edit-ex-card">
      <h3 className="log-exercise-name" style={{ marginBottom: 8 }}>{label}</h3>
      {conj[poolKey].map((item, idx) => (
        <div key={idx} className="edit-ex-card">
          <div className="edit-ex-row">
            <input className="edit-input" style={{ flex: 1 }} value={item.name} onChange={(e) => updatePoolItem(poolKey, idx, "name", e.target.value)} placeholder="Exercise" />
            <button className="icon-btn small" onClick={() => removePoolItem(poolKey, idx)} aria-label="Remove this pool item"><Trash2 size={14} /></button>
          </div>
          <LabeledInput label="Video link" value={item.videoUrl} onChange={(v) => updatePoolItem(poolKey, idx, "videoUrl", v)} />
        </div>
      ))}
      <button className="btn-ghost" onClick={() => addPoolItem(poolKey)}><Plus size={14} /> Add to pool</button>
    </div>
  );

  return (
    <ModalShell onClose={onClose} title="Edit Max Effort Pools" fullscreen>
      <LabeledInput label="Rotate every (weeks)" type="number" min="1" max="12" value={conj.meRotationWeeks} onChange={(v) => setConj((prev) => ({ ...prev, meRotationWeeks: Number(v) }))} />
      {renderPool("meLowerPool", "Max Effort Lower")}
      {renderPool("meUpperPool", "Max Effort Upper")}
      <button className="btn-primary wide" style={{ marginTop: 14 }} onClick={save}>Save pools</button>
    </ModalShell>
  );
}
function LabeledInput({ label, value, onChange, type = "text", step, inputMode, min, max }) {
  return <label className="labeled-input"><span>{label}</span><input type={type} step={step} inputMode={inputMode} min={min} max={max} value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></label>;
}

/* ============================== HISTORY TAB ============================== */

function summarizeSets(sets, exerciseName) {
  const unit = exerciseUnit(exerciseName);
  const label = (n) => (unit === "seconds" ? "sec" : unit === "minutes" ? "min" : unit === "meters" ? "m" : String(n).trim() === "1" ? "rep" : "reps");
  const weighted = needsWeight(exerciseName);
  const tokens = (sets || []).map((s) => {
    const reps = String(s.reps === undefined || s.reps === null ? "" : s.reps).trim() || "0";
    const w = Number(s.weight) || 0;
    const head = weighted && w > 0 ? `${w} lb × ${reps} ${label(reps)}` : `${reps} ${label(reps)}`;
    const hasEffort = s.rir !== "" && s.rir !== undefined && s.rir !== null;
    return head + (hasEffort ? ` @ effort ${rpeFromRir(s.rir)}` : "");
  });
  const groups = [];
  tokens.forEach((t) => {
    const last = groups[groups.length - 1];
    if (last && last.text === t) last.count += 1;
    else groups.push({ text: t, count: 1 });
  });
  return groups.map((g) => (g.count > 1 ? `${g.count} sets of ${g.text}` : g.text)).join(",  ");
}

function EditableLogBody({ log, client, onPersist }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);

  const startEdit = () => { setDraft(JSON.parse(JSON.stringify(log.exercises))); setEditing(true); setSaved(false); };
  const updateDraftSet = (exIdx, setIdx, field, value) => {
    setDraft((prev) => {
      const next = [...prev];
      const sets = [...next[exIdx].sets];
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      next[exIdx] = { ...next[exIdx], sets };
      return next;
    });
  };
  const saveEdit = async () => {
    let totalVolume = 0;
    draft.forEach((e) => e.sets.forEach((s) => { totalVolume += (Number(s.weight) || 0) * (Number(s.reps) || 0); }));
    const updatedLog = { ...log, exercises: draft, totalVolume: Math.round(totalVolume) };
    const updatedLogs = client.logs.map((l) => (l.id === log.id ? updatedLog : l));
    const result = await onPersist({ ...client, logs: updatedLogs });
    // Only claim it saved if it saved. Telling someone their correction landed
    // when it didn't is worse than showing them the failure.
    if (result && result.ok === false) {
      emitToast({ kind: "error", message: "Couldn't save that edit — check your connection and try again.", autoDismissMs: 6000 });
      return;
    }
    setEditing(false);
    setSaved(true);
  };

  if (editing) {
    return (
      <div>
        <div className="history-date" style={{ marginBottom: 8 }}>Editing — Week {log.weekNumber}, Day {log.dayLabel}</div>
        {draft.map((e, exIdx) => (
          <div key={e.exerciseId} className="edit-ex-card">
            <h3 className="log-exercise-name" style={{ fontSize: 13.5, marginBottom: 6 }}>{e.name}</h3>
            <div className="set-grid-header" style={{ gridTemplateColumns: "26px 1fr 1fr 1fr" }}><span>Set</span><span>{needsWeight(e.name) ? "Weight" : ""}</span><span>{exerciseUnitLabel(e.name)}</span><span>Effort</span></div>
            {e.sets.map((s, setIdx) => (
              <div className="set-grid-row" key={setIdx} style={{ gridTemplateColumns: "26px 1fr 1fr 1fr" }}>
                <span className="set-num">{setIdx + 1}</span>
                {needsWeight(e.name) ? (
                  <input type="number" step="0.1" inputMode="decimal" min="0" max="2000" placeholder="pounds" aria-label={`Set ${setIdx + 1}, weight in pounds`} value={s.weight} onChange={(ev) => updateDraftSet(exIdx, setIdx, "weight", ev.target.value)} />
                ) : (
                  <span aria-hidden="true" />
                )}
                <input type="text" placeholder="reps" value={s.reps} onChange={(ev) => updateDraftSet(exIdx, setIdx, "reps", ev.target.value)} />
                <input type="number" min="1" max="10" placeholder="RPE" aria-label="Rate of Perceived Exertion" value={s.rir !== "" && s.rir !== undefined ? rpeFromRir(s.rir) : ""} onChange={(ev) => updateDraftSet(exIdx, setIdx, "rir", ev.target.value === "" ? "" : String(10 - Number(ev.target.value)))} />
              </div>
            ))}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn-primary" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} onClick={saveEdit}>Save Changes</button>
          <button className="btn-ghost" style={{ flex: 1, marginTop: 0, justifyContent: "center" }} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="history-date" style={{ marginBottom: 6 }}>Week {log.weekNumber} — Day {log.dayLabel}</div>
      {log.exercises.map((e) => (
        <div key={e.exerciseId} className="history-ex">
          <div className="history-ex-name">{e.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>{summarizeSets(e.sets, e.name)}</div>
        </div>
      ))}
      {log.notes && <div className="history-notes">"{log.notes}"</div>}
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Total volume {log.totalVolume.toLocaleString()} pounds — Rate of Perceived Exertion {log.avgRPE}{log.readinessColor ? ` — Readiness ${log.readinessColor}` : ""}</div>
      <button className="btn-ghost" style={{ marginTop: 10 }} onClick={startEdit}><Pencil size={14} /> {saved ? "Saved — edit again" : "Fix a typo in this workout"}</button>
    </div>
  );
}

function HistoryTab({ client, onPersist }) {
  const [openId, setOpenId] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const [search, setSearch] = useState("");
  const logs = [...client.logs].reverse();
  const mobilityLogs = [...(client.mobilityLogs || [])].reverse();

  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const logsByDate = useMemo(() => {
    const map = {};
    client.logs.forEach((l) => { (map[l.date] = map[l.date] || []).push(l); });
    return map;
  }, [client.logs]);
  const mobilityByDate = useMemo(() => {
    const map = {};
    (client.mobilityLogs || []).forEach((m) => { (map[m.date] = map[m.date] || []).push(m); });
    return map;
  }, [client.mobilityLogs]);

  // Match on exercise name so someone can find every session they squatted in
  // without scrolling a year of cards.
  const shownLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => (l.exercises || []).some((e) => (e.name || "").toLowerCase().includes(q)));
  }, [logs, search]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedLogs = selectedDate ? (logsByDate[selectedDate] || []) : [];
  const selectedMobility = selectedDate ? (mobilityByDate[selectedDate] || []) : [];

  return (
    <div className="pad">
      {client.weeklySchedule && SCHEDULE_DAYS.some(([key]) => (client.weeklySchedule[key] || []).length > 0) && (
        <Card title="Your Weekly Training Schedule">
          {SCHEDULE_DAYS.map(([key, label]) => {
            const activities = client.weeklySchedule[key] || [];
            if (activities.length === 0) return null;
            const isRestDay = activities.length === 1 && activities[0] === REST_DAY;
            return (
              <div key={key} className="schedule-row">
                <div className="schedule-day">{label}</div>
                <div className={`schedule-detail ${isRestDay ? "off" : ""}`}>{activities.map((a, i) => <div key={i}>{a}</div>)}</div>
              </div>
            );
          })}
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Edit this any time in Settings.</p>
        </Card>
      )}
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>Pick any date on the calendar to jump straight to that workout, or scroll the full list below. Nothing is ever deleted — but you can fix a typo'd weight or rep any time.</p>

      <div className="cal-header">
        <button className="day-nav-btn" onClick={() => { setMonthOffset((o) => o - 1); setSelectedDate(null); }}><ChevronLeft size={16} /></button>
        <div className="program-title" style={{ margin: 0, fontSize: 18 }}>{monthLabel}</div>
        <button className="day-nav-btn" onClick={() => { setMonthOffset((o) => o + 1); setSelectedDate(null); }}><ChevronRight size={16} /></button>
      </div>
      <div className="cal-grid cal-grid-header">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="cal-day-label">{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="cal-cell empty" />;
          const ds = dateStr(d);
          const hasLog = !!logsByDate[ds];
          const hasMobility = !!mobilityByDate[ds];
          const isSelected = selectedDate === ds;
          const isToday = ds === todayStr();
          return (
            <button key={i} className={`cal-cell ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`} onClick={() => setSelectedDate(isSelected ? null : ds)}>
              <span>{d}</span>
              {(hasLog || hasMobility) && (
                <span className="cal-dot-row">
                  {hasLog && <span className="cal-dot workout" />}
                  {hasMobility && <span className="cal-dot mobility" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div style={{ marginTop: 18, marginBottom: 8 }}>
          <div className="program-title" style={{ fontSize: 16, marginBottom: 10 }}>{fmtDate(selectedDate)}</div>
          {selectedLogs.length === 0 && selectedMobility.length === 0 && <p className="muted">No workouts or recovery sessions logged this date.</p>}
          {selectedLogs.map((log) => (
            <div key={log.id} className="history-card">
              <div className="history-body" style={{ borderTop: "none", padding: 14 }}>
                <EditableLogBody log={log} client={client} onPersist={onPersist} />
              </div>
            </div>
          ))}
          {selectedMobility.map((m) => (
            <div key={m.id} className="history-card"><div className="history-body" style={{ borderTop: "none", padding: 14 }}>
              <div className="history-date">Recovery & Mobility — {Math.round(m.totalSeconds / 60)} minutes</div>
              {m.notes && <div className="history-notes">"{m.notes}"</div>}
            </div></div>
          ))}
        </div>
      )}

      <div className="program-title" style={{ fontSize: 18, marginTop: 24, marginBottom: 8 }}>Full History</div>
      {logs.length > 0 && (
        <input
          className="edit-input"
          style={{ width: "100%", marginBottom: 10 }}
          type="search"
          inputMode="search"
          placeholder="Search by exercise — try 'squat'"
          aria-label="Search your history by exercise name"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setVisibleCount(20); }}
        />
      )}
      {logs.length === 0 ? <EmptyState icon={HistoryIcon} text="Nothing logged yet — head to the Today tab and finish your first session. It'll show up here the moment you do." /> : shownLogs.length === 0 ? (
        <EmptyState icon={HistoryIcon} text={`No sessions match "${search}". Try a shorter word — "squat" rather than "box squat".`} />
      ) : (
        <>
          {search.trim() && (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
              {shownLogs.length} of {logs.length} session{logs.length === 1 ? "" : "s"} include an exercise matching "{search.trim()}".
            </p>
          )}
          {shownLogs.slice(0, visibleCount).map((log) => (
            <div key={log.id} className="history-card">
              <button className="history-head" onClick={() => setOpenId(openId === log.id ? null : log.id)}>
                <div><div className="history-date">{fmtDate(log.date)}</div><div className="muted">Week {log.weekNumber} — Day {log.dayLabel}</div></div>
                <div className="history-meta"><span>{log.totalVolume.toLocaleString()} pounds</span><ChevronRight size={16} className={openId === log.id ? "chev-open" : ""} /></div>
              </button>
              {openId === log.id && (
                <div className="history-body">
                  <EditableLogBody log={log} client={client} onPersist={onPersist} />
                  <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{log.warmupCompleted ? "Warm-up complete" : ""}</div>
                </div>
              )}
            </div>
          ))}
          {shownLogs.length > visibleCount && (
            <button className="btn-ghost wide" onClick={() => setVisibleCount((c) => c + 20)}>
              Load 20 More ({shownLogs.length - visibleCount} remaining)
            </button>
          )}
        </>
      )}

      {mobilityLogs.length > 0 && (
        <>
          <div className="program-title" style={{ fontSize: 18, marginTop: 20 }}>Recovery & Mobility</div>
          {mobilityLogs.map((m) => (
            <div key={m.id} className="history-card"><div className="history-body" style={{ borderTop: "none", padding: 14 }}>
              <div className="history-date">{fmtDate(m.date)} — {Math.round(m.totalSeconds / 60)} minutes</div>
              {m.notes && <div className="history-notes">"{m.notes}"</div>}
            </div></div>
          ))}
        </>
      )}
    </div>
  );
}

/* ============================== BJJ NOTES TAB ============================== */

function BJJNotesTab({ client, onPersist }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [learned, setLearned] = useState("");
  const [workOn, setWorkOn] = useState("");
  const notes = [...(client.bjjNotes || [])].sort((a, b) => (a.date < b.date ? 1 : -1));

  const startAdd = () => { setLearned(""); setWorkOn(""); setEditingId(null); setAdding(true); };
  const startEdit = (note) => { setLearned(note.learned || ""); setWorkOn(note.workOn || ""); setEditingId(note.id); setAdding(true); };
  const cancel = () => { setAdding(false); setEditingId(null); };
  const save = async () => {
    if (!learned.trim() && !workOn.trim()) return;
    let updatedNotes;
    if (editingId) {
      updatedNotes = client.bjjNotes.map((n) => (n.id === editingId ? { ...n, learned: learned.trim(), workOn: workOn.trim() } : n));
    } else {
      updatedNotes = [...(client.bjjNotes || []), { id: uid(), date: todayStr(), learned: learned.trim(), workOn: workOn.trim() }];
    }
    await onPersist({ ...client, bjjNotes: updatedNotes });
    setAdding(false);
    setEditingId(null);
  };

  return (
    <div className="pad">
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>A running diary of your mat time — what you learned in class and what to drill next time. These notes are for you — your coach's dashboard doesn't display them.</p>

      {!adding && <button className="btn-primary wide" onClick={startAdd}>+ Add Today's Notes</button>}

      {adding && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="log-exercise-name" style={{ marginBottom: 8 }}>{editingId ? "Edit Entry" : "New Entry"}</h3>
          <label className="labeled-input">
            <span>What I learned in class today</span>
            <textarea className="notes-box" rows={4} value={learned} onChange={(e) => setLearned(e.target.value)} placeholder="New sweep from De La Riva, a detail on my armbar setup, a rolling tip from a training partner..." />
          </label>
          <label className="labeled-input">
            <span>What I need to work on</span>
            <textarea className="notes-box" rows={4} value={workOn} onChange={(e) => setWorkOn(e.target.value)} placeholder="Staying heavy in side control, finishing triangles from mount, better guard retention against passers..." />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn-primary" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} onClick={save}>Save Entry</button>
            <button className="btn-ghost" style={{ flex: 1, marginTop: 0, justifyContent: "center" }} onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {notes.length === 0 && !adding ? (
        <EmptyState text="No notes yet. Add your first entry after your next class." />
      ) : (
        notes.map((note) => (
          <div key={note.id} className="history-card">
            <div className="history-body" style={{ borderTop: "none", padding: 14 }}>
              <div className="history-date" style={{ marginBottom: 8 }}>{fmtDate(note.date)}</div>
              {note.learned && (
                <div style={{ marginBottom: 10 }}>
                  <div className="section-subheading">What I Learned</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{note.learned}</p>
                </div>
              )}
              {note.workOn && (
                <div>
                  <div className="section-subheading">What I Need to Work On</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{note.workOn}</p>
                </div>
              )}
              <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => startEdit(note)}><Pencil size={14} /> Edit this entry</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ============================== PROGRESS TAB ============================== */

function DetailBarToggle({ label, entries, dataKey, domain }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div>
      <button className="btn-ghost wide" style={{ marginTop: 8 }} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} every logged {label} value</button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <ResponsiveContainer width="100%" height={Math.max(140, entries.length * 24)}>
            <BarChart data={entries} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid stroke="var(--border)" />
              <XAxis type="number" stroke="var(--text-dim)" fontSize={10} domain={domain} />
              <YAxis type="category" dataKey="date" stroke="var(--text-dim)" fontSize={10} width={56} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
              <Bar dataKey={dataKey} fill="var(--accent)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ProgressTab({ client }) {
  const CHART_WINDOW = 90;
  const bwData = (client.bodyweightLog || []).map((b) => ({ date: b.date, weight: b.weight })).slice(-CHART_WINDOW);
  const readinessEntries = Object.values(client.readiness || {}).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-CHART_WINDOW);
  const readinessData = readinessEntries.map((r) => ({ date: r.date, score: r.color === "GREEN" ? 3 : r.color === "YELLOW" ? 2 : 1 }));
  // Only entries that actually carry each row, so the old and new shapes each
  // chart their own history instead of plotting zeros where a row didn't exist.
  const feltReadyData = readinessEntries.filter((r) => r.readiness != null).map((r) => ({ date: r.date, readiness: Number(r.readiness) }));
  const sorenessData = readinessEntries.filter((r) => r.readiness == null && r.soreness != null).map((r) => ({ date: r.date, soreness: Number(r.soreness) }));
  const totalBwEntries = (client.bodyweightLog || []).length;
  const totalReadinessEntries = Object.keys(client.readiness || {}).length;

  // Weekly tonnage, so the page leads with training rather than bodyweight.
  const volumeData = weeklyVolumeSeries(client).slice(-12);
  const thisWeekVolume = volumeData.length ? volumeData[volumeData.length - 1].volume : 0;
  const priorWeeks = volumeData.slice(0, -1);
  const avgVolume = priorWeeks.length ? priorWeeks.reduce((a, b) => a + b.volume, 0) / priorWeeks.length : 0;
  const volumeVsAvg = avgVolume > 0 ? Math.round((thisWeekVolume / avgVolume) * 100) : null;
  const latestReadiness = readinessEntries.length ? readinessEntries[readinessEntries.length - 1] : null;
  const readinessPct = latestReadiness
    ? (latestReadiness.readiness != null
        ? Math.round(((Number(latestReadiness.sleep) + Number(latestReadiness.readiness)) / 2 / 5) * 100)
        : Math.round((((Number(latestReadiness.sleep) + Number(latestReadiness.energy || 0)) / 2 - Number(latestReadiness.soreness || 0) + 5) / 10) * 100))
    : null;
  const perWeekTarget = client.program.sessionsPerWeek || 3;
  const sessionsThisWeek = (() => {
    const mondayOf = (ds) => { const d = new Date(ds + "T00:00:00"); const wd = d.getDay(); d.setDate(d.getDate() + ((wd === 0 ? -6 : 1) - wd)); return toLocalDateStr(d); };
    const thisWeek = mondayOf(todayStr());
    return (client.logs || []).filter((l) => mondayOf(l.date) === thisWeek).length;
  })();
  const totalSessionsAll = totalSessionsIn(client.program);
  const blockPct = Math.min(100, Math.round(((client.sessionsCompleted || 0) / totalSessionsAll) * 100));
  const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

  if (bwData.length === 0 && readinessData.length === 0 && volumeData.length === 0) return <div className="pad"><EmptyState text="Log a workout or a daily check-in to see progress charts." /></div>;

  return (
    <div className="pad">
      <div className="ring-row">
        <MetricRing label="Readiness" value={readinessPct === null ? 0 : readinessPct}
          display={readinessPct === null ? "—" : `${readinessPct}%`}
          color={latestReadiness ? readinessCopyFor(latestReadiness).color : "var(--text-dim)"}
          sublabel={latestReadiness ? "Last check-in" : "No check-in yet"} />
        <MetricRing label="This week" value={sessionsThisWeek} max={perWeekTarget}
          display={`${sessionsThisWeek}/${perWeekTarget}`} sublabel="Sessions" />
        <MetricRing label="Block" value={blockPct} display={`${blockPct}%`} sublabel={`${client.sessionsCompleted || 0} of ${totalSessionsAll}`} />
      </div>

      <div className="metric-row">
        <MetricTile label="This week" value={`${compact(thisWeekVolume)} lb`} sub="Total tonnage" />
        <MetricTile label="Vs average" value={volumeVsAvg === null ? "—" : `${volumeVsAvg}%`}
          sub={volumeVsAvg === null ? "Needs 2 weeks" : volumeVsAvg >= 100 ? "Above your average" : "Below your average"}
          color={volumeVsAvg === null ? "var(--text-dim)" : volumeVsAvg >= 100 ? "var(--green)" : "var(--amber)"} />
        <MetricTile label="Sessions" value={String(client.logs.length)} sub="All time" color="var(--info)" />
        <MetricTile label="Records" value={String((client.prLog || []).length)} sub="Personal bests" color="var(--neon-gold)" />
      </div>

      {volumeData.length > 0 && (
        <Card title="Weekly Volume">
          <TrendArea data={volumeData} dataKey="volume" valueFormat={(v) => Math.round(v).toLocaleString()} unit=" lb" />
        </Card>
      )}

      {client.logs.length > 0 && (
        <Card title="Training Consistency">
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Each square is a day. The darker it is, the more you lifted.</p>
          <TrainingHeatmap logs={client.logs} />
        </Card>
      )}
      {bwData.length > 0 && (
        <Card title="Bodyweight">
          {totalBwEntries > CHART_WINDOW && <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Showing your most recent {CHART_WINDOW} entries of {totalBwEntries} total — export your data in Settings for the full history.</p>}
          <TrendArea data={bwData} dataKey="weight" color="var(--info)" unit=" lb" />
          <DetailBarToggle label="bodyweight" entries={bwData} dataKey="weight" domain={["auto", "auto"]} />
        </Card>
      )}

      {readinessData.length > 0 && (
        <Card title="Readiness">
          <TrendArea data={readinessData} dataKey="score" color="var(--green)" height={150} domain={[0, 3]} valueFormat={(v) => ({ 1: "Red", 2: "Yellow", 3: "Green" }[v] || v)} />
          <DetailBarToggle label="readiness" entries={readinessData} dataKey="score" domain={[0, 3]} />
        </Card>
      )}

      {feltReadyData.length > 0 && (
        <Card title="How Ready You Felt">
          <TrendArea data={feltReadyData} dataKey="readiness" color="var(--accent)" height={150} domain={[0, 5]} unit=" / 5" />
          <DetailBarToggle label="readiness" entries={feltReadyData} dataKey="readiness" domain={[0, 5]} />
        </Card>
      )}

      {sorenessData.length > 0 && (
        <Card title="Muscle Soreness (before Sep 2026)">
          <TrendArea data={sorenessData} dataKey="soreness" color="var(--amber)" height={150} domain={[0, 5]} unit=" / 5" />
          <DetailBarToggle label="soreness" entries={sorenessData} dataKey="soreness" domain={[0, 5]} />
        </Card>
      )}
    </div>
  );
}

/* ============================== RECORDS (PR) TAB ============================== */

function PRsTab({ client }) {
  const prLog = client.prLog || [];
  const [openName, setOpenName] = useState(null);

  const grouped = useMemo(() => {
    const map = {};
    prLog.forEach((p) => { (map[p.exerciseName] = map[p.exerciseName] || []).push(p); });
    Object.keys(map).forEach((name) => map[name].sort((a, b) => (a.date < b.date ? 1 : -1)));
    return map;
  }, [prLog]);

  const names = Object.keys(grouped).sort();
  if (names.length === 0) return <div className="pad"><EmptyState text="No Personal Records yet — tap the trophy next to a set once you log it to start tracking them here." /></div>;

  return (
    <div className="pad">
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>Every lift you've flagged as a Personal Record, most recent first. Tap any lift to see your progress graph and full history.</p>
      {names.map((name) => {
        const records = grouped[name];
        const mostRecent = records[0];
        const earlier = records.slice(1);
        const open = openName === name;
        const unit = exerciseUnit(name);
        const useWeight = needsWeight(name);
        const history = open ? exerciseHistorySeries(client, name) : [];
        const chartData = history.map((h) => ({ date: h.date, value: h.value, reps: h.reps, isPR: h.isPR }));
        return (
          <div key={name} className="pr-card-wrap">
            <button className="pr-card-v2" onClick={() => setOpenName(open ? null : name)}>
              <div className="pr-card-v2-top">
                <div className="pr-card-v2-name">{name}</div>
                <ChevronRight size={18} className={open ? "chev-open" : ""} />
              </div>
              <div className="pr-side-row" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                <Trophy size={17} color="var(--accent)" /><span>{mostRecent.weight} lb × {mostRecent.reps} {unit}</span>
              </div>
              <div className="pr-side-row"><CalendarDays size={13} color="var(--text-dim)" /><span className="muted">{fmtDate(mostRecent.date)} — most recent</span></div>
              {records.length > 1 && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{records.length} Personal Records logged — tap to see your progress</div>}
            </button>
            {open && (
              <div className="pr-history">
                {chartData.length > 1 ? (
                  <>
                    <div style={{ height: 190 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="var(--border)" />
                          <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                          <YAxis stroke="var(--text-dim)" fontSize={11} domain={["auto", "auto"]} label={useWeight ? { value: "pounds", angle: -90, position: "insideLeft", fill: "var(--text-dim)", fontSize: 10 } : undefined} />
                          <Tooltip
                            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                            formatter={(value, key, props) => [
                              useWeight ? `${value} lb × ${props.payload.reps} reps` : `${value} ${unit}`,
                              props.payload.isPR ? "Personal Record" : "Logged set",
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="var(--accent)"
                            strokeWidth={2}
                            dot={(dotProps) => {
                              const { cx, cy, payload, index } = dotProps;
                              return payload.isPR ? (
                                <circle key={`pr-${index}`} cx={cx} cy={cy} r={6} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
                              ) : (
                                <circle key={`set-${index}`} cx={cx} cy={cy} r={3.5} fill="var(--text)" stroke="var(--card)" strokeWidth={1} />
                              );
                            }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, margin: "2px 0 10px" }}>Every logged session's top set on this lift, oldest to newest — the larger highlighted dots mark your Personal Records.</div>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Log this lift again to start seeing your progress graph here.</p>
                )}
                {earlier.map((h) => (
                  <div key={h.id} className="pr-history-row-v2">
                    <div className="pr-history-weight">{h.weight} lb <span className="pr-history-x">×</span> {h.reps} {unit}</div>
                    <div className="pr-history-date"><CalendarDays size={12} /> {fmtDate(h.date)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================== CLIENTS MODAL ============================== */

function ClientsModal({ clients, activeId, onSelect, onAdd, onDelete, onClose }) {
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [weight, setWeight] = useState("");
  const [heightFeet, setHeightFeet] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [template, setTemplate] = useState("bjj");
  const [injuryNotes, setInjuryNotes] = useState("");
  const canCreate = firstName.trim() && lastName.trim();

  return (
    <ModalShell onClose={onClose} title="Athletes / Clients">
      {clients.map((c) => (
        <div key={c.id} className="client-row">
          <button className={`client-select ${c.id === activeId ? "active" : ""}`} onClick={() => onSelect(c.id)}>{c.name}</button>
          {clients.length > 1 && <button className="icon-btn small" onClick={() => onDelete(c.id)} aria-label={`Delete ${c.name}`}><Trash2 size={14} /></button>}
        </div>
      ))}
      {!adding ? <button className="btn-ghost wide" style={{ marginTop: 14 }} onClick={() => setAdding(true)}><Plus size={16} /> Add athlete</button> : (
        <div className="add-client-form">
          <LabeledInput label="First name" value={firstName} onChange={setFirstName} />
          <LabeledInput label="Last name" value={lastName} onChange={setLastName} />
          <LabeledInput label="Bodyweight (pounds)" type="number" step="0.1" inputMode="decimal" min="1" max="600" value={weight} onChange={setWeight} />
          <div className="edit-ex-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <LabeledInput label="Height — feet" type="number" min="0" max="8" value={heightFeet} onChange={setHeightFeet} />
            <LabeledInput label="Height — inches" type="number" min="0" max="11" value={heightInches} onChange={setHeightInches} />
          </div>
          <div className="radio-group">
            <label className={`radio-pill ${template === "bjj" ? "active" : ""}`}><input type="radio" checked={template === "bjj"} onChange={() => setTemplate("bjj")} />Conjugate Brazilian Jiu-Jitsu / Wrestling template</label>
            <label className={`radio-pill ${template === "blank" ? "active" : ""}`}><input type="radio" checked={template === "blank"} onChange={() => setTemplate("blank")} />Blank — build custom</label>
          </div>
          <LabeledInput label="Anything to work around? (optional)" value={injuryNotes} onChange={setInjuryNotes} />
          <button className="btn-primary wide" style={{ marginTop: 10 }} disabled={!canCreate}
            onClick={() => {
              onAdd({ firstName: firstName.trim(), lastName: lastName.trim(), weight: Number(weight) || 0, heightFeet: Number(heightFeet) || 0, heightInches: Number(heightInches) || 0, injuryNotes }, template === "bjj");
              setFirstName(""); setLastName(""); setWeight(""); setHeightFeet(""); setHeightInches(""); setInjuryNotes(""); setAdding(false);
            }}>Create athlete</button>
        </div>
      )}
    </ModalShell>
  );
}

/* ============================== SHARED UI ============================== */

function Card({ title, subtitle, right, children }) {
  return <div className="card"><div className="card-head"><div><h2 className="card-title">{title}</h2>{subtitle && <div className="muted" style={{ fontSize: 13 }}>{subtitle}</div>}</div>{right}</div>{children}</div>;
}
function StatChip({ label, value }) { return <div className="stat-chip"><div className="stat-chip-value">{value}</div><div className="stat-chip-label">{label}</div></div>; }
function LoadingState({ label }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <p>{label || "Loading…"}</p>
    </div>
  );
}
function ToastHost() {
  const { toasts, dismiss } = useToastFeed();
  if (!toasts.length) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind || "info"}`}>
          <span>{t.message}</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            {t.onRetry && <button className="toast-action" onClick={() => { t.onRetry(); dismiss(t.id); }}>{t.retryLabel || "Retry"}</button>}
            <button className="toast-dismiss" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><X size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
function EmptyState({ text, icon, actionLabel, onAction }) {
  const Icon = icon || HistoryIcon;
  return (
    <div className="empty-state-v2">
      <div className="empty-state-icon"><Icon size={28} /></div>
      <p>{text}</p>
      {actionLabel && onAction && <button className="btn-primary" style={{ marginTop: 12, padding: "10px 20px" }} onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}
function ModalShell({ title, children, onClose, fullscreen, headerRight, headerLeftExtra, dismissOnEscape = true, hideClose = false }) {
  const closeRef = useRef(null);
  const headRef = useRef(null);
  useEffect(() => {
    if (!dismissOnEscape || !onClose) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissOnEscape, onClose]);
  // Move focus into the dialog so a keyboard or screen-reader user isn't left
  // behind on the page underneath it, keep Tab inside it while it's open, and
  // hand focus back to whatever opened it on the way out.
  const boxRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    (closeRef.current || headRef.current)?.focus();
    const onKey = (e) => {
      if (e.key !== "Tab" || !boxRef.current) return;
      const focusable = boxRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
  }, []);
  return (
    <div className={`modal-overlay ${fullscreen ? "fullscreen" : ""}`}>
      <div className="modal-box" ref={boxRef} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : (typeof title === "object" ? "Dialog" : undefined)}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: hideClose ? 42 : undefined }}>
            {!hideClose && <button className="icon-btn" ref={closeRef} onClick={onClose} aria-label="Close"><ArrowLeft size={18} /></button>}
            {headerLeftExtra}
          </div>
          <h2 className="modal-title" ref={headRef} tabIndex={-1}>{title}</h2>
          <div style={{ minWidth: 42, display: "flex", justifyContent: "flex-end" }}>{headerRight}</div>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}

/* ============================== STYLES ============================== */

function GlobalStyle() {
  return (
    <style>{`
      .app-shell { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; position: relative; overflow-x: hidden;
        background: var(--bg); color: var(--text); }
      .app-shell[data-theme="dark"] { --bg:#000000; --card:#111214; --border:#262931; --field-border:#616776; --text:#f5f6f8; --text-dim:#83878f; --accent:#00d9b8; --accent-text:#00201a; --cta:#00d9b8; --cta2:#00d9b8; --green:#4f9d5c; --amber:#d9a22b; --red:#c0392b; --info:#4a9eff; --neon-gold:#f5e000; }
      .app-shell[data-theme="light"] { --bg:#f7f8f9; --card:#ffffff; --border:#e3e5e8; --field-border:#888e97; --text:#0a0b0d; --text-dim:#6b6f76; --accent:#00705f; --accent-text:#ffffff; --cta:#00705f; --cta2:#00705f; --green:#3f7d4a; --amber:#b9840f; --red:#a93226; --info:#1565c0; --neon-gold:#7d6f00; }
      .app-shell::before { content: ""; position: fixed; inset: 0; max-width: 480px; margin: 0 auto; background: radial-gradient(ellipse 100% 60% at 50% 0%, var(--belt-glow, transparent) 0%, transparent 85%); opacity: 0.38; pointer-events: none; z-index: 0; }
      .app-shell::after { content: ""; position: fixed; top: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; height: 6px; background: var(--belt-glow, transparent); opacity: 0.95; pointer-events: none; z-index: 6; box-shadow: 0 0 12px var(--belt-glow, transparent); }
      .app-shell > * { position: relative; z-index: 1; }
      * { box-sizing: border-box; }
      .scroll-area { flex: 1; overflow-y: auto; padding-bottom: calc(90px + env(safe-area-inset-bottom, 0px)); }
      .pad { padding: 16px; }
      .brand-title { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 26px; letter-spacing: 0.06em; color: var(--text); margin-bottom: 4px; line-height: 1.05; }
      .logo-block { position: relative; overflow: hidden; padding: 38px 18px 34px; margin-bottom: 20px; border-radius: 18px; background: var(--card); border: 1px solid var(--border); }
      .brand-lockup { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .brand-lockup-word { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 30px; letter-spacing: 0.2em; line-height: 1; color: var(--text); text-indent: 0.2em; }
      .brand-lockup-rule { display: flex; align-items: center; gap: 9px; width: 100%; max-width: 230px; }
      .logo-block .brand-title { font-size: 32px; margin-bottom: 0; }
      .logo-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.35; pointer-events: none; }
      .program-choice-card { background: var(--card); border: 2px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 10px; cursor: pointer; }
      .program-choice-card.active { border-color: var(--accent); }
      .program-choice-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
      .topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "brand avatar" "icons icons"; align-items: center; gap: 12px 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 5; }
      .topbar > .brand-block { grid-area: brand; }
      .topbar > .topbar-avatar-btn { grid-area: avatar; }
      .topbar-icons { grid-area: icons; display: flex; gap: 6px; justify-content: flex-start; align-items: center; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
      .topbar-icons::-webkit-scrollbar { display: none; }
      .topbar-avatar-btn { width: 42px; height: 42px; border-radius: 50%; border: 2px solid var(--border); background: var(--card); overflow: hidden; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0 auto; flex-shrink: 0; }
      .topbar-avatar-img { width: 100%; height: 100%; object-fit: cover; }
      .topbar-avatar-fallback { font-size: 16px; font-weight: 700; color: var(--text-dim); }
      .settings-avatar-preview { width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--border); background: var(--card); overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .settings-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
      .settings-avatar-preview span { font-size: 24px; font-weight: 700; color: var(--text-dim); }
      .quote-hero { display: block; width: 100%; text-align: left; background: none; border: none; padding: 2px 0 0; margin-bottom: 18px; cursor: pointer; }
      .quote-hero-text { font-size: 19px; font-weight: 700; line-height: 1.38; color: var(--text); margin: 0 0 9px; }
      .quote-hero-attr { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); }
      .quote-hero-dash { width: 18px; height: 1px; background: var(--text-dim); flex-shrink: 0; }
      /* ---- Title block: emblem + wordmark + ruled subtitle ---- */
      .brand-block { display: flex; align-items: center; gap: 11px; min-width: 0; }
      .brand-stack { min-width: 0; }
      .brand-word { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 21px; letter-spacing: 0.17em; line-height: 1; color: var(--text); }
      .brand-rule { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
      .brand-rule-line { height: 1px; background: var(--accent); opacity: 0.45; flex: 1; min-width: 8px; }
      .brand-sub { font-family: 'Oswald', sans-serif; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.34em; color: var(--accent); white-space: nowrap; }
      .topbar-brand { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 15px; letter-spacing: 0.05em; color: var(--text); line-height: 1.1; max-width: 220px; }
      .topbar-name-sub { font-size: 13px; color: var(--text-dim); margin-top: 3px; }
      .topbar-name-btn { background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border); display: block; max-width: 100%; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
      .dash-stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .dash-stat.wide { grid-column: 1 / -1; }
      .dash-stat-value { font-weight: 700; font-size: 14px; }
      .dash-stat-label { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
      .progress-bar-track { width: 100%; height: 10px; border-radius: 999px; background: var(--border); overflow: hidden; }
      .progress-bar-fill { height: 100%; background: var(--accent); border-radius: 999px; }
      .milestone-row { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; }
      .milestone-row.achieved { opacity: 1; border-color: var(--green); }
      .milestone-emoji { font-size: 26px; flex-shrink: 0; }
      .milestone-name { font-weight: 600; font-size: 13.5px; }
      .icon-btn { background: var(--card); border: 1px solid var(--border); border-radius: 12px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--accent); cursor: pointer; }
      .icon-btn.small { width: 34px; height: 34px; }
      .bottom-nav { position: sticky; bottom: 0; display: flex; border-top: 1px solid var(--border); background: var(--bg); z-index: 10; padding-bottom: env(safe-area-inset-bottom, 0px); }
      .nav-btn { flex: 1; min-width: 0; background: none; border: none; color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 2px 10px; font-size: 11.5px; line-height: 1.1; white-space: nowrap; cursor: pointer; position: relative; }
      .nav-btn span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
      @media (max-width: 359px) { .nav-btn { font-size: 10.5px; } }
      .nav-btn.active { color: var(--accent); }
      .nav-btn.active::after { content: ''; position: absolute; top: -1px; left: 30%; right: 30%; height: 2px; background: var(--accent); border-radius: 2px; }
      .stat-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
      .hero-card { position: relative; border-radius: 20px; padding: 22px 20px 20px; margin-bottom: 16px; overflow: hidden; background: var(--card); border: 1px solid var(--border); }
      .hero-top-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .hero-nav-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 9px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--accent); cursor: pointer; flex-shrink: 0; }
      .hero-nav-btn:disabled { opacity: 0.55; }
      .hero-eyebrow { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-bottom: 4px; }
      .hero-select-row { display: flex; gap: 8px; margin-bottom: 16px; }
      .hero-select { flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 600; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .hero-title { font-family: 'Inter', -apple-system, sans-serif; font-weight: 800; font-style: normal; font-size: 26px; line-height: 1.15; color: var(--text); letter-spacing: -0.01em; margin-bottom: 4px; }
      .hero-duration { font-size: 13px; color: var(--text-dim); margin-bottom: 14px; }
      .hero-quote { font-size: 13px; color: var(--accent); font-style: italic; line-height: 1.55; padding: 0; margin-bottom: 4px; }
      .hero-quote b { font-style: italic; font-weight: 700; }
      .hero-quote-attr { font-size: 13px; color: var(--text-dim); margin-bottom: 18px; }
      .mood-row-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 8px; }
      .mood-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .mood-pill { flex: 1; background: var(--bg); border: 1.5px solid var(--border); border-radius: 12px; padding: 10px 4px; color: var(--text-dim); font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; }
      .mood-pill.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
      /* ---- conditioning ---- */
      .cond-card { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin: 8px 0 10px; }
      .cond-why { margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: var(--text); }
      .cond-stats { display: flex; gap: 8px; margin-bottom: 12px; }
      .cond-stat { flex: 1; min-width: 0; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 9px 8px; text-align: center; }
      .cond-stat.wide { flex-basis: 100%; }
      .cond-stat-v { display: block; font-family: Oswald, sans-serif; font-weight: 600; font-size: 19px; line-height: 1.1; color: var(--accent); }
      .cond-stat-v.small { font-size: 13px; font-family: Inter, sans-serif; font-weight: 500; color: var(--text); line-height: 1.45; }
      .cond-stat-l { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-top: 3px; font-weight: 600; }
      .cond-bars { display: flex; gap: 3px; margin-bottom: 6px; }
      .cond-round { flex: 1; display: flex; gap: 2px; min-width: 0; }
      .cond-work { flex: 1 1 0; min-width: 2px; height: 10px; border-radius: 3px; background: var(--accent); }
      .cond-rest { flex: 1 1 0; min-width: 2px; height: 10px; border-radius: 3px; background: var(--field-border); }
      .cond-bars-key { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--text-dim); margin-bottom: 12px; }
      .cond-bars-key > span { display: inline-flex; align-items: center; gap: 5px; }
      .cond-key-dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
      .cond-key-dot.work { background: var(--accent); }
      .cond-key-dot.rest { background: var(--field-border); }
      .cond-effort { border-radius: 10px; padding: 9px 11px; margin-bottom: 10px; border: 1px solid; }
      .cond-effort-label { display: block; font-weight: 700; font-size: 13px; margin-bottom: 2px; }
      .cond-effort-test { display: block; font-size: 12.5px; line-height: 1.45; color: var(--text-dim); }
      .cond-effort.tone-easy { border-color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent); }
      .cond-effort.tone-easy .cond-effort-label { color: var(--green); }
      .cond-effort.tone-medium { border-color: var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent); }
      .cond-effort.tone-medium .cond-effort-label { color: var(--amber); }
      .cond-effort.tone-hard { border-color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent); }
      .cond-effort.tone-hard .cond-effort-label { color: var(--red); }
      .cond-pacing-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: transparent; border: none; color: var(--text-dim); font-size: 12.5px; font-weight: 600; padding: 8px 0; cursor: pointer; min-height: 44px; }
      .cond-log { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-top: 10px; }
      .cond-log-label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); font-weight: 700; margin-bottom: 8px; }
      .cond-log-row { display: flex; align-items: center; gap: 10px; }
      .cond-log-row input { flex: 1; min-width: 0; background: var(--card); border: 1px solid var(--field-border); border-radius: 10px; color: var(--text); font-size: 16px; padding: 12px; min-height: 44px; }
      .cond-log-unit { font-size: 13px; color: var(--text-dim); font-weight: 600; white-space: nowrap; }
      .hero-full-checkin { display: block; text-align: center; font-size: 13px; color: var(--text-dim); text-decoration: underline; margin: -6px 0 10px; padding: 10px 0; background: none; border: none; cursor: pointer; width: 100%; }
      .hero-start-btn { width: 100%; background: var(--cta); color: var(--accent-text); border: none; border-radius: 12px; padding: 15px; font-size: 15.5px; font-weight: 800; cursor: pointer; text-transform: uppercase; letter-spacing: 0.03em; box-shadow: none; }
      .hero-secondary-row { display: flex; gap: 8px; margin-top: 8px; }
      .hero-secondary-btn { flex: 1; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 12px; padding: 12px 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
      .hero-readiness-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 700; color: var(--text); margin-bottom: 14px; }
      .hero-dot { width: 8px; height: 8px; border-radius: 50%; }
      .stat-chip { flex: 1 1 45%; min-width: 90px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; text-align: center; }
      .stat-chip-value { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 19px; letter-spacing: 0.02em; color: var(--accent); }
      .stat-chip-label { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 14px; }
      .card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
      .card-title { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 15px; letter-spacing: 0.04em; color: var(--text-dim); }
      .muted { color: var(--text-dim); font-size: 14px; line-height: 1.4; }
      .pill { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; color: #ffffff; }
      /* Form fields need a 3:1 edge against their background. --border is 1.4:1,
         which is right for a card outline and invisible on an input you are
         tapping at arm's length in a bright gym. */
      .set-grid-row input, .labeled-input input, .labeled-input textarea, .notes-box,
      .bw-input, .edit-input, .select-input, .section-check-box, .sig-input {
        border-color: var(--field-border);
      }
      .injury-chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .injury-chip { background: var(--card); border: 1px solid var(--field-border); border-radius: 999px; padding: 10px 14px; min-height: 44px; font-size: 13.5px; color: var(--text); cursor: pointer; }
      .injury-chip.on { background: color-mix(in srgb, var(--amber) 18%, var(--card)); border-color: var(--amber); font-weight: 700; }
      .icon-btn-badged { position: relative; overflow: visible; }
      .icon-badge { position: absolute; top: -5px; right: -5px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px; background: var(--red); color: #ffffff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid var(--bg); line-height: 1; }
      .signup-review-card { background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid var(--accent); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
      .payment-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .pill-paid { background: var(--green); color: var(--bg); }
      .pill-unpaid { background: var(--amber); color: #000000; }
      .pill-alert { background: var(--red); color: #ffffff; }
      .intent-box { background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid var(--accent); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--text); margin-bottom: 12px; line-height: 1.4; }
      .nudge-card { background: color-mix(in srgb, var(--accent) 10%, var(--card)); border: 1px solid var(--accent); border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; }
      .nudge-card-title { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; font-size: 13px; color: var(--accent); margin-bottom: 6px; }
      .adjust-box { background: color-mix(in srgb, var(--amber) 14%, transparent); border: 1px solid var(--amber); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--text); margin-bottom: 12px; line-height: 1.4; }
      .error-box { background: color-mix(in srgb, var(--red) 14%, transparent); border: 1px solid var(--red); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--text); margin-bottom: 12px; line-height: 1.4; }
      .success-box { background: color-mix(in srgb, var(--green) 14%, transparent); border: 1px solid var(--green); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--text); margin-bottom: 12px; line-height: 1.4; }
      .link-btn { background: none; border: none; color: var(--accent); text-decoration: underline; font-size: 13px; cursor: pointer; padding: 8px 0; }
      .day-nav-row { display: flex; align-items: center; gap: 8px; }
      .day-nav-btn { background: var(--card); border: 1px solid var(--border); border-radius: 8px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--text); cursor: pointer; flex-shrink: 0; }
      .day-nav-btn:disabled { opacity: 0.55; cursor: default; }
      .jump-picker { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-bottom: 12px; max-height: 240px; overflow-y: auto; }
      .jump-week-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 2px; border-bottom: 1px solid var(--border); }
      .jump-week-row:last-child { border-bottom: none; }
      .jump-week-label { font-size: 12px; color: var(--text-dim); }
      .jump-day-row { display: flex; gap: 6px; }
      .jump-day-btn { width: 44px; height: 44px; border-radius: 6px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 12px; cursor: pointer; }
      .jump-day-btn.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 700; }
      .jump-day-btn.is-today:not(.active) { border-color: var(--accent); color: var(--accent); }
      .day-intent-preview { font-size: 13px; color: var(--text-dim); font-style: italic; margin-bottom: 8px; }
      .section-preview-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
      .preview-toggle { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; color: var(--text); font-size: 13.5px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; cursor: pointer; margin-bottom: 8px; }
      .section-preview-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13.5px; border-bottom: 1px solid var(--border); }
      .section-preview-row:last-child { border-bottom: none; }
      .section-preview-ex-row { font-size: 13px; color: var(--text); padding: 3px 0 3px 8px; border-left: 2px solid var(--border); margin-left: 2px; }
      .section-subheading { font-size: 12px; letter-spacing: 0.03em; color: var(--accent); margin: 8px 0 4px; }
      .btn-primary { background: var(--cta); color: var(--accent-text); border: none; border-radius: 12px; padding: 15px 18px; font-weight: 800; font-size: 15px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.03em; box-shadow: none; }
      .btn-primary.wide, .btn-ghost.wide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; }
      .btn-primary:disabled { opacity: 0.6; }
      .btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 11px 18px; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; }
      .program-actions { display: flex; gap: 8px; margin-bottom: 14px; }
      .view-toggle-row { display: flex; gap: 6px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 4px; margin-bottom: 16px; }
      .view-toggle-btn { flex: 1; background: none; border: none; border-radius: 7px; padding: 8px 0; font-size: 13px; font-weight: 600; color: var(--text-dim); cursor: pointer; }
      .view-toggle-btn.active { background: var(--accent); color: var(--accent-text); }
      .program-actions .btn-ghost { flex: 1; justify-content: center; font-size: 13px; padding: 10px; margin-top: 0; }
      .pr-line { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 4px 0; }
      .slider-row { margin-bottom: 14px; }
      .slider-label { display: flex; justify-content: space-between; font-size: 13.5px; margin-bottom: 6px; }
      .slider-value { color: var(--accent); font-weight: 700; }
      .slider-hint { font-size: 11.5px; color: var(--text-dim); font-weight: 500; }
      input[type="range"] { width: 100%; accent-color: var(--accent); }
      .bw-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 14px; }
      .bw-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font-size: 14px; text-align: right; }
      .sig-block { margin-top: 18px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px 16px 12px; }
      .sig-label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-bottom: 10px; }
      .sig-input { width: 100%; box-sizing: border-box; background: transparent; border: none; outline: none; color: var(--text); font-family: 'Caveat', 'Snell Roundhand', 'Segoe Script', 'Bradley Hand', cursive; font-size: 36px; line-height: 1.3; padding: 0 2px 6px; min-height: 48px; }
      .sig-input::placeholder { color: var(--text-dim); opacity: 0.45; }
      .sig-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
      .sig-block:focus-within .sig-rule { background: var(--accent); }
      .sig-signed { font-family: 'Caveat', 'Snell Roundhand', 'Segoe Script', 'Bradley Hand', cursive; font-size: 36px; line-height: 1.3; color: var(--text); padding: 0 2px 6px; min-height: 48px; word-break: break-word; }
      .sig-rule { height: 1px; background: var(--border); margin-bottom: 8px; transition: background 0.15s ease; }
      .sig-foot { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; color: var(--text-dim); }
      .bjj-toggle { display: flex; align-items: center; gap: 8px; font-size: 13.5px; margin-bottom: 16px; cursor: pointer; }
      .bjj-toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 50; display: flex; align-items: flex-end; justify-content: center; }
      .modal-box { background: var(--bg); width: 100%; max-width: 480px; max-height: 88dvh; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; overflow: hidden; }
      .modal-overlay.fullscreen .modal-box { max-height: 100dvh; height: 100dvh; border-radius: 0; }
      .modal-overlay.fullscreen .modal-content { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
      .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 8px; }
      .modal-title { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; font-size: 16px; flex: 1; }
      .modal-content { padding: 16px; overflow-y: auto; flex: 1; }
      .progress-circle { position: relative; width: 42px; height: 42px; }
      .progress-circle-arc { stroke: var(--accent); transition: stroke-dashoffset 0.25s; }
      .progress-circle.amber .progress-circle-arc { stroke: var(--amber); }
      .progress-circle.green .progress-circle-arc { stroke: var(--green); }
      .progress-circle.neon .progress-circle-arc { stroke: var(--neon-gold); filter: drop-shadow(0 0 4px var(--neon-gold)); }
      .progress-circle-pct { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--text); }
      .rest-banner { display: flex; align-items: flex-start; gap: 8px; background: var(--accent); color: var(--accent-text); padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.4; margin-bottom: 14px; position: sticky; top: 0; z-index: 2; }
      .rest-banner span { flex: 1; }
      .rest-dismiss { background: rgba(0,0,0,0.18); border: none; border-radius: 999px; width: 44px; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: inherit; cursor: pointer; }
      .log-exercise { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .log-exercise-head { margin-bottom: 10px; }
      .log-exercise-name { font-weight: 700; font-size: 15.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .section-ex-block { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
      /* A superset is one unit. The pair is joined by a shared accent rail and a
         single seam, so it reads as "go back and forth between these two". */
      .section-ex-block.ss-a { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: none; margin-bottom: 0; border-left: 3px solid var(--accent); }
      .section-ex-block.ss-b { border-top-left-radius: 0; border-top-right-radius: 0; border-left: 3px solid var(--accent); position: relative; }
      .section-ex-block.ss-b::before { content: ""; position: absolute; top: 0; left: 14px; right: 14px; height: 1px; background: var(--border); }
      .log-exercise-target-wrap { margin-bottom: 10px; }
      .log-exercise-target { font-size: 13px; color: var(--text); font-weight: 600; margin-top: 4px; }
      .rest-note-static { font-size: 13px; color: var(--info); margin-top: 6px; font-weight: 600; }
      .rename-input { flex: 1; background: var(--bg); border: 1px solid var(--accent); border-radius: 8px; padding: 6px 10px; color: var(--text); font-size: 14px; font-weight: 700; }
      .icon-btn-sm { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 10px; margin: -4px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .icon-btn-sm:hover { color: var(--accent); }
      .log-exercise-cue { font-size: 13px; color: var(--text-dim); margin-top: 6px; font-style: normal; line-height: 1.5; padding-top: 6px; border-top: 1px dashed var(--border); }
      .ex-name-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .recommended-tag { font-size: 12px; color: var(--green); border: 1px solid var(--green); border-radius: 999px; padding: 1px 7px; margin-left: 8px; vertical-align: 2px; }
      .last-logged { font-size: 13px; color: var(--accent); margin-top: 8px; font-weight: 600; }
      .superset-tag { font-size: 12px; font-weight: 800; color: var(--bg); background: var(--accent); border-radius: 5px; padding: 1px 6px; margin-right: 6px; letter-spacing: 0.03em; }
      .quality-tag { color: var(--accent); background: none; border: 1.5px solid var(--accent); }
      .pct-1rm-row { font-size: 13px; color: var(--accent); margin: 4px 0 5px 2px; font-style: italic; }
      .ex-links-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      .video-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--accent); text-decoration: none; border: 1px solid var(--accent); border-radius: 999px; padding: 3px 9px; }
      .link-x-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 999px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; }
      .link-edit-btn { background: none; border: none; color: var(--text-dim); font-size: 12px; text-decoration: underline; cursor: pointer; }
      .add-link-btn { background: none; border: 1px dashed var(--border); border-radius: 999px; color: var(--text-dim); font-size: 12px; padding: 3px 10px; cursor: pointer; margin-top: 8px; }
      .video-edit-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
      .set-pr { background: var(--card); border: 1px solid var(--border); border-radius: 8px; min-height: 44px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; }
      .set-pr.flagged { background: var(--amber); border-color: var(--amber); color: var(--bg); }
      .sub-row { display: flex; flex-wrap: wrap; margin-top: 8px; gap: 6px; }
      .sub-pill-row { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
      .sub-pill { background: var(--bg); border: 1px solid var(--border); border-radius: 999px; color: var(--text); font-size: 12px; padding: 6px 11px; cursor: pointer; }
      .sub-pill.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 700; }
      .section-header { flex: 1; min-width: 0; background: none; border: none; color: var(--text); display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 8px 0; }
      .section-header-row { display: flex; align-items: center; gap: 4px; }
      .section-check { width: 44px; height: 44px; flex-shrink: 0; background: none; border: none; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .section-check-box { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; color: var(--bg); }
      .section-check.checked .section-check-box { background: var(--green); border-color: var(--green); }
      .warmup-block { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
      .warmup-block-head { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
      .warmup-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; }
      .warmup-item input { margin-top: 3px; accent-color: var(--accent); }
      .warmup-item-name { font-size: 13.5px; }
      .set-grid-header, .set-grid-row { display: grid; grid-template-columns: 26px 1fr 1fr 40px; gap: 8px; align-items: center; }
      .set-grid-header > *, .set-grid-row > * { min-width: 0; }
      .set-grid-header { font-size: 12px; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.02em; }
      .set-grid-row { margin-bottom: 6px; }
      .set-num { font-size: 13px; color: var(--text-dim); }
      .set-grid-row input { background: var(--bg); border: 1.5px solid var(--border); border-radius: 8px; color: var(--text); padding: 12px 4px; min-height: 44px; font-size: 16px; font-weight: 700; width: 100%; text-align: center; }
      .set-grid-row input:focus { border-color: var(--accent); outline: none; }
      .set-grid-row input[type="number"]::-webkit-outer-spin-button,
      .set-grid-row input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .set-grid-row input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
      .set-grid-row input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .set-grid-row input:disabled, .set-grid-row input[readonly] { opacity: 0.55; background: var(--card); cursor: default; font-weight: 600; }
      .set-done { background: var(--card); border: 1px solid var(--border); border-radius: 8px; height: 34px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; }
      .set-done.done { background: var(--green); color: #fff; border-color: var(--green); }
      .notes-box { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; color: var(--text); padding: 10px; font-size: 14px; font-family: inherit; resize: vertical; }
      .finish-summary { display: flex; flex-direction: column; gap: 12px; align-items: stretch; padding-top: 10px; }
      .finish-stat { text-align: center; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
      .finish-stat-value { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 30px; color: var(--accent); }
      .finish-stat-label { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
      .pr-celebration { text-align: center; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 14%, var(--card)) 0%, var(--card) 100%); border: 1px solid var(--accent); border-radius: 16px; padding: 24px 18px; }
      .pr-celebration-icon { width: 56px; height: 56px; border-radius: 50%; background: var(--accent); color: var(--accent-text); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; animation: pr-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .pr-celebration-title { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 15px; color: var(--accent); margin-bottom: 12px; }
      .pr-celebration-list { display: flex; flex-direction: column; gap: 8px; }
      .pr-celebration-chip { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; font-size: 14px; font-weight: 600; text-align: left; }
      @keyframes pr-pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      .program-title { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; font-size: 19px; margin-bottom: 14px; }
      .phase-block { margin-bottom: 10px; }
      .phase-header { width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; color: var(--text); }
      .phase-weeks { font-size: 12px; color: var(--accent); letter-spacing: 0.03em; }
      .phase-name { font-weight: 700; font-size: 15px; margin-top: 2px; }
      .chev-open { transform: rotate(90deg); transition: transform 0.15s; }
      .phase-body { padding: 12px 4px; }
      .day-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
      .day-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .day-badge { background: var(--accent); color: var(--accent-text); font-weight: 800; font-size: 12px; width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
      .day-name { font-weight: 600; font-size: 14px; flex: 1; }
      .program-ex-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; border-top: 1px solid var(--border); gap: 10px; }
      .program-ex-row:first-of-type { border-top: none; }
      .edit-ex-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
      .edit-ex-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
      .edit-ex-row.four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .edit-input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px; font-size: 13.5px; }
      .edit-input:disabled { opacity: 0.6; }
      .wide-input { flex: 1; }
      .labeled-input { display: flex; flex-direction: column; gap: 6px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 12px; }
      .labeled-input input { background: var(--bg); border: 1px solid var(--border); border-radius: 11px; color: var(--text); padding: 13px 12px; font-size: 15px; font-weight: 500; letter-spacing: normal; text-transform: none; }
      .labeled-input input:focus { border-color: var(--accent); outline: none; }
      .labeled-input input::placeholder { color: var(--text-dim); opacity: 0.7; }
      .select-input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px; font-size: 13.5px; font-family: inherit; }
      .history-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
      .history-head { width: 100%; background: none; border: none; color: var(--text); padding: 14px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
      .history-date { font-weight: 700; font-size: 14.5px; }
      .history-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--accent); }
      .history-body { padding: 0 14px 14px; border-top: 1px solid var(--border); }
      .history-ex { padding: 8px 0; border-bottom: 1px solid var(--border); }
      .history-ex:last-of-type { border-bottom: none; }
      .history-ex-name { font-weight: 600; font-size: 13.5px; }
      .history-notes { font-style: italic; font-size: 13px; color: var(--text-dim); margin-top: 8px; }
      .pr-card-wrap { margin-bottom: 10px; }
      .pr-card { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; color: var(--text); font-family: inherit; }
      .pr-card-v2 { width: 100%; text-align: left; cursor: pointer; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; color: var(--text); font-family: inherit; display: block; }
      .pr-card-v2-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      .pr-card-v2-name { font-weight: 700; font-size: 16px; }
      .pr-card-v2-stats { display: flex; align-items: center; gap: 16px; }
      .pr-big-stat { flex-shrink: 0; }
      .pr-big-number { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 34px; color: var(--accent); line-height: 1; }
      .pr-big-unit { font-size: 15px; margin-left: 3px; color: var(--text-dim); font-family: inherit; }
      .pr-big-label { font-size: 12px; color: var(--text-dim); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.03em; }
      .pr-side-stats { display: flex; flex-direction: column; gap: 6px; border-left: 1px solid var(--border); padding-left: 14px; flex: 1; }
      .pr-side-row { display: flex; align-items: center; gap: 6px; font-size: 13.5px; }
      .pr-history-row-v2 { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--border); }
      .pr-history-row-v2:last-child { border-bottom: none; }
      .pr-history-weight { font-weight: 700; font-size: 14px; }
      .pr-history-x { color: var(--text-dim); font-weight: 400; }
      .pr-history-date { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--text-dim); }
      .pr-chart-wrap { background: var(--bg); border: 1px solid var(--border); border-top: none; border-radius: 0 0 12px 12px; padding: 10px 14px 14px; margin-top: -1px; }
      .pr-card-name { font-weight: 700; font-size: 14.5px; }
      .pr-history { background: var(--bg); border: 1px solid var(--border); border-top: none; border-radius: 0 0 12px 12px; padding: 8px 14px; margin-top: -1px; }
      .pr-history-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
      .pr-history-row:last-child { border-bottom: none; }
      .empty-state { text-align: center; color: var(--text-dim); padding: 60px 20px; font-size: 14px; }
      .empty-state-v2 { text-align: center; color: var(--text-dim); padding: 48px 24px; font-size: 14px; }
      .empty-state-icon { width: 56px; height: 56px; border-radius: 50%; background: var(--card); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; color: var(--accent); }
      .client-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .client-select { flex: 1; text-align: left; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; color: var(--text); font-size: 14.5px; cursor: pointer; }
      .client-select.active { border-color: var(--accent); color: var(--accent); font-weight: 700; }
      .add-client-form { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
      .radio-group { display: flex; gap: 8px; }
      .radio-pill { flex: 1; border: 1px solid var(--border); border-radius: 10px; padding: 10px; text-align: center; font-size: 12.5px; cursor: pointer; color: var(--text-dim); display: flex; align-items: center; justify-content: center; }
      .radio-pill.active { border-color: var(--accent); color: var(--accent); }
      .radio-pill input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
      .radio-pill:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
      .mobility-type-tag { display: inline-block; font-size: 12px; letter-spacing: 0.04em; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 2px 10px; }
      .mobility-timer { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 48px; color: var(--accent); }
      .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .schedule-row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
      .schedule-row:last-of-type { border-bottom: none; }
      .schedule-day { width: 76px; flex-shrink: 0; font-weight: 700; font-size: 12.5px; padding-top: 1px; }
      .schedule-detail { font-size: 13px; color: var(--text); line-height: 1.5; }
      .schedule-detail.off { color: var(--text-dim); font-style: italic; }
      .schedule-editor { margin-bottom: 4px; }
      .schedule-edit-row { padding: 10px 0; border-bottom: 1px solid var(--border); }
      .schedule-edit-row:last-child { border-bottom: none; }
      .schedule-edit-day { font-weight: 700; font-size: 13px; margin-bottom: 8px; }
      .schedule-edit-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .schedule-chip { background: var(--bg); border: 1px solid var(--border); border-radius: 999px; color: var(--text); font-size: 12px; padding: 7px 12px; cursor: pointer; }
      .schedule-chip.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 700; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .cal-grid-header { margin-bottom: 4px; }
      .cal-day-label { text-align: center; font-size: 12px; color: var(--text-dim); font-weight: 700; padding-bottom: 2px; }
      .cal-cell { aspect-ratio: 1; background: var(--card); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text); font-size: 12px; cursor: pointer; gap: 3px; padding: 0; }
      .cal-cell.empty { background: transparent; border: none; cursor: default; }
      .cal-cell.today { border-color: var(--accent); border-width: 2px; }
      .cal-cell.selected { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
      .cal-dot-row { display: flex; gap: 3px; }
      .cal-dot { width: 6px; height: 6px; border-radius: 50%; }
      .cal-dot.workout { background: var(--green); }
      .cal-dot.mobility { background: var(--amber); border-radius: 1px; }
      .cal-cell.selected .cal-dot.workout, .cal-cell.selected .cal-dot.mobility { background: #ffffff; }

      /* ---- Metric visuals: rings, tiles, wearable strip, heatmap ---- */
      .ring-row { display: flex; justify-content: space-around; align-items: flex-start; gap: 6px; margin-bottom: 18px; }
      .ring-wrap { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
      .ring-value { fill: var(--text); font-family: 'Inter', sans-serif; font-size: 21px; font-weight: 700; }
      .ring-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-top: 8px; text-align: center; }
      .ring-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; text-align: center; }

      .metric-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px; }
      .metric-row > * { min-width: 0; }
      .metric-tile { display: flex; align-items: stretch; gap: 10px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 12px 12px 0; overflow: hidden; }
      .metric-tile-bar { width: 4px; border-radius: 0 3px 3px 0; flex-shrink: 0; }
      .metric-tile-body { min-width: 0; }
      .metric-tile-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
      .metric-tile-value { font-size: 22px; font-weight: 800; color: var(--text); line-height: 1.15; margin-top: 3px; }
      .metric-tile-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; }

      .wearable-strip { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-bottom: 14px; }
      .wearable-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; gap: 8px; }
      .wearable-source { font-size: 13.5px; font-weight: 700; color: var(--text); }
      .wearable-date { font-size: 12px; color: var(--text-dim); }
      .wearable-metrics { display: flex; gap: 8px; }
      .wearable-metric { flex: 1; min-width: 0; }
      .wearable-metric-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
      .wearable-metric-value { font-size: 20px; font-weight: 800; color: var(--text); margin-top: 2px; }

      .chart-endlabel { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-dim); margin-top: 8px; }
      .chart-endlabel-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .chart-endlabel strong { color: var(--text); font-weight: 700; }

      .heatmap { overflow-x: auto; padding-bottom: 2px; }
      .heatmap-grid { display: flex; gap: 3px; align-items: flex-start; }
      .heatmap-days { display: flex; flex-direction: column; gap: 3px; margin-right: 2px; }
      .heatmap-dayname { font-size: 9px; color: var(--text-dim); height: 12px; line-height: 12px; width: 10px; }
      .heatmap-col { display: flex; flex-direction: column; gap: 3px; }
      .heatmap-cell { width: 12px; height: 12px; border-radius: 3px; display: block; flex-shrink: 0; background: color-mix(in srgb, var(--text) 9%, var(--bg)); }
      .heatmap-cell.is-rest { box-shadow: inset 0 0 0 1px var(--border); }
      .heatmap-legend { display: flex; align-items: center; gap: 4px; margin-top: 10px; font-size: 11.5px; color: var(--text-dim); }

      /* ---- Accessibility: visible keyboard focus + respecting reduced motion ---- */
      a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, [tabindex]:focus-visible {
        outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px;
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
      }

      /* ---- Toasts (surfaced save/load failures, with a Retry action) ---- */
      .toast-host { position: fixed; left: 50%; transform: translateX(-50%); bottom: 84px; width: calc(100% - 32px); max-width: 448px; z-index: 60; display: flex; flex-direction: column; gap: 8px; }
      .toast { background: var(--card); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--text); box-shadow: 0 8px 24px -8px rgba(0,0,0,0.5); }
      .toast-error { border-left-color: #ff6b6b; }
      .toast-action { background: none; border: 1px solid var(--accent); color: var(--accent); border-radius: 8px; padding: 6px 11px; font-size: 12.5px; font-weight: 700; cursor: pointer; flex-shrink: 0; min-height: 44px; }
      .toast-dismiss { background: none; border: none; color: var(--text-dim); cursor: pointer; display: flex; padding: 6px; flex-shrink: 0; }
      @media (prefers-reduced-motion: no-preference) { .toast { animation: toast-in 0.2s ease-out; } }
      @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

      /* ---- Shared loading state ---- */
      .loading-state { padding: 60px 20px; text-align: center; color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: 12px; }
      .loading-state p { font-size: 13px; margin: 0; }
      .loading-spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent); }
      @media (prefers-reduced-motion: no-preference) { .loading-spinner { animation: spin 0.8s linear infinite; } }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}</style>
  );
}

/* ============================== AUTH SCREEN ============================== */

// Supabase's own strings ("Invalid login credentials", "User already
// registered") read as broken software on a sign-in screen. Module scope
// because both the sign-in screen and the password-reset screen need it.
function friendlyAuthError(m) {
  const s = String(m || "").toLowerCase();
  if (s.includes("invalid login")) return "That email and password don't match an account. Check both, or use Forgot password.";
  if (s.includes("already registered") || s.includes("already been registered")) return "There's already an account with that email. Sign in instead, or use Forgot password.";
  if (s.includes("rate limit") || s.includes("too many")) return "Too many tries just now. Wait a minute and try again.";
  if (s.includes("not confirmed") || s.includes("confirm")) return "Check your email for the confirmation link, then come back and sign in.";
  if (s.includes("password")) return "Your password needs to be at least 6 characters.";
  if (s.includes("email")) return "That doesn't look like a valid email address.";
  return "Something went wrong. Please try again in a moment.";
}

function AuthScreen() {
  const [theme, setTheme] = useState("dark");
  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrOk, setQrOk] = useState(true);
  const [promoCode, setPromoCode] = useState("");
  const promoDiscount = PROMO_CODES[promoCode.trim().toUpperCase()] || 0;
  const duePrice = PROGRAM_PRICE - promoDiscount;
  const hasPaymentInfo = coachVenmo || coachCashApp || coachPaymentLink;

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { data: signUpData, error: err } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { promoCode: promoCode.trim().toUpperCase() } } });
        if (err) setError(friendlyAuthError(err.message));
        else {
          const newUserId = signUpData?.user?.id;
          if (newUserId && COACH_USER_ID && newUserId !== COACH_USER_ID) {
            // Best-effort: link this new client to the coach so they show up in the
            // Coach Dashboard automatically. Never blocks or fails signup if it errors.
            // supabase-js returns { error }, it does not throw — so a bare
            // try/catch here silently swallowed every failure. And with email
            // confirmation on there is no session yet, so RLS rejects this
            // insert outright. Either way the athlete would never appear in the
            // coach dashboard, pay, and then hard-lock at week 2. The upsert on
            // load below is the real fix; this is just the fast path.
            const { error: linkErr } = await supabase.from("client_links")
              .upsert({ client_user_id: newUserId, coach_user_id: COACH_USER_ID, client_email: signUpData.user.email }, { onConflict: "client_user_id" });
            if (linkErr) console.warn("client_links insert deferred to first sign-in:", linkErr.message);
          }
          setInfo("Account created. If we ask you to confirm your email, open the link we just sent you and then come back and sign in. Otherwise you'll be taken straight to your program.");
        }
      } else if (mode === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (err) setError(friendlyAuthError(err.message));
        else setInfo("Check your email for a link to reset your password.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(friendlyAuthError(err.message));
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <div className="pad" style={{ paddingTop: 60, maxWidth: 420, margin: "0 auto" }}>
        <div className="logo-block">
          <BrandLockup />
        </div>
        <div className="program-title" style={{ fontSize: 20, marginBottom: 4 }}>{mode === "signup" ? "Create Your Account" : mode === "forgot" ? "Reset Your Password" : "Sign In"}</div>
        <p className="muted" style={{ marginBottom: 20 }}>
          {mode === "signup" ? "Your own account, your own data, saved permanently and available on any device." : mode === "forgot" ? "Enter your email and we'll send you a link to set a new password." : "Welcome back."}
        </p>
        {mode === "signup" && hasPaymentInfo && (
          <div className="card" style={{ marginBottom: 18, textAlign: "center" }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Payment</div>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>{`Your First Week Of Sessions Free / One-Time $${duePrice} Fee After That For Unlimited Access`}</p>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>No payment today — your first week of sessions is on the house. Once you've finished them, you'll be asked for the fee here before the next session unlocks. It's a one-time fee, not a subscription: you're never charged again, on this block or any future one.</p>
            <label className="labeled-input" style={{ marginBottom: 10, textAlign: "left" }}>
              <span>Promo Code (optional)</span>
              <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="Enter code" style={{ textTransform: "uppercase" }} />
            </label>
            {promoDiscount > 0 && <p style={{ color: "var(--green)", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{`✓ Promo code applied — $${promoDiscount} off, $${duePrice} due at Week 2`}</p>}
            {qrOk && (
              coachPaymentLink ? (
                <a href={coachPaymentLink} target="_blank" rel="noopener noreferrer">
                  <img src="/payment-qr.png" alt="Payment QR code — tap to pay" style={{ width: 180, height: 180, objectFit: "contain", margin: "0 auto 12px", display: "block", borderRadius: 8, background: "#fff" }} onError={() => setQrOk(false)} />
                </a>
              ) : (
                <img src="/payment-qr.png" alt="Payment QR code" style={{ width: 180, height: 180, objectFit: "contain", margin: "0 auto 12px", display: "block", borderRadius: 8, background: "#fff" }} onError={() => setQrOk(false)} />
              )
            )}
            {coachVenmo && <div style={{ fontSize: 13.5, marginBottom: 4 }}>Venmo: <strong>{coachVenmo}</strong></div>}
            {coachCashApp && <div style={{ fontSize: 13.5, marginBottom: coachPaymentLink ? 10 : 0 }}>Cash App: <strong>{coachCashApp}</strong></div>}
            {coachPaymentLink && <a className="btn-ghost wide" style={{ textDecoration: "none", display: "block" }} href={coachPaymentLink} target="_blank" rel="noopener noreferrer">Open Payment Link</a>}
          </div>
        )}
        <form onSubmit={submit}>
          <label className="labeled-input">
            <span><Mail size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          {mode !== "forgot" && (
            <label className="labeled-input">
              <span><Lock size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Password</span>
              <input type="password" required minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </label>
          )}
          {mode === "signin" && (
            <button type="button" className="link-btn" style={{ display: "block", marginBottom: 12 }} onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}>Forgot password?</button>
          )}
          {error && <div className="error-box" role="alert">{error}</div>}
          {info && <div className="success-box" role="status">{info}</div>}
          <button className="btn-primary wide" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create Account" : mode === "forgot" ? "Send Reset Link" : "Sign In"}</button>
        </form>
        {mode === "forgot" ? (
          <button className="btn-ghost wide" onClick={() => { setMode("signin"); setError(""); setInfo(""); }}>Back to sign in</button>
        ) : (
          <button className="btn-ghost wide" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setInfo(""); }}>
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        )}
      </div>
      <GlobalStyle />
    </div>
  );
}

function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) setError(friendlyAuthError(err.message));
      else onDone();
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="app-shell" data-theme="dark">
      <div className="pad" style={{ paddingTop: 60, maxWidth: 420, margin: "0 auto" }}>
        <div className="program-title" style={{ fontSize: 20, marginBottom: 4 }}>Set a New Password</div>
        <p className="muted" style={{ marginBottom: 20 }}>Choose a new password for your account, then sign in with it going forward.</p>
        <form onSubmit={submit}>
          <label className="labeled-input">
            <span><Lock size={13} style={{ marginRight: 5, verticalAlign: -2 }} />New password</span>
            <input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
          </label>
          {error && <div className="error-box" role="alert">{error}</div>}
          <button className="btn-primary wide" type="submit" disabled={busy}>{busy ? "Please wait…" : "Update Password"}</button>
        </form>
      </div>
      <GlobalStyle />
    </div>
  );
}

function ConfigMissingScreen() {
  return (
    <div className="app-shell" data-theme="dark">
      <div className="pad" style={{ paddingTop: 60, maxWidth: 460, margin: "0 auto" }}>
        <div className="program-title" style={{ fontSize: 20, marginBottom: 10 }}>Setup Needed</div>
        <p className="muted">
          This app isn't available right now — that's a setup problem on our end, not anything you
          did. Message your coach and he'll get it sorted.
        </p>
        {/* For the coach: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as environment
            variables in the Vercel project settings, then redeploy. */}
      </div>
      <GlobalStyle />
    </div>
  );
}

export default function AppGate() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out, object = signed in
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).catch(() => setSession(null));
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabase) return <ConfigMissingScreen />;
  if (session === undefined) return <div className="app-shell" data-theme="dark"><LoadingState /><GlobalStyle /></div>;
  if (recovery) return <ResetPasswordScreen onDone={() => setRecovery(false)} />;
  if (!session) return <AuthScreen />;
  return (
    <AppErrorBoundary>
      <MainApp userId={session.user.id} onSignOut={() => supabase.auth.signOut()} />
    </AppErrorBoundary>
  );
}
