import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Home, CalendarDays, History as HistoryIcon, TrendingUp, Trophy,
  Users, Plus, ChevronRight, ChevronLeft, Check, Timer, ArrowLeft, Pencil, Trash2,
  Scale, ListChecks, Info, Settings as SettingsIcon, Sun, Moon, X, Calendar, RotateCcw, Calculator, ListOrdered, HelpCircle, BookOpen, LogOut, Mail, Lock
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
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

/* ============================== STORAGE HELPERS ============================== */
// These five functions are the ONLY place the rest of the app talks to storage.
// Everything else in this file is unchanged from the original Claude-artifact version.

const CLIENT_LIST_KEY = "sc-app:client-list";
const SETTINGS_KEY = "sc-app:settings";
const clientKey = (id) => `sc-app:client:${id}`;

async function kvGet(userId, key) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.from("kv_store").select("value").eq("user_id", userId).eq("key", key).maybeSingle();
  if (error || !data) return null;
  return data.value;
}
async function kvSet(userId, key, value) {
  if (!supabase || !userId) return;
  await supabase.from("kv_store").upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() });
}
async function kvDelete(userId, key) {
  if (!supabase || !userId) return;
  await supabase.from("kv_store").delete().eq("user_id", userId).eq("key", key);
}

async function getClientList(userId) {
  try { const v = await kvGet(userId, CLIENT_LIST_KEY); return v || []; } catch { return []; }
}
async function setClientList(userId, list) { try { await kvSet(userId, CLIENT_LIST_KEY, list); } catch {} }
async function getClient(userId, id) { try { const v = await kvGet(userId, clientKey(id)); return v || null; } catch { return null; } }
async function setClient(userId, id, data) { try { await kvSet(userId, clientKey(id), data); } catch {} }
async function deleteClientStorage(userId, id) { try { await kvDelete(userId, clientKey(id)); } catch {} }
function rosterKey(code, clientId) { return `roster_${code.trim().toUpperCase()}_${clientId}`; }
async function pushRosterSnapshot(client) {
  if (!client?.roster?.sharing || !client.roster.code?.trim() || !supabase) return;
  try {
    const perWeek = client.program.sessionsPerWeek || 3;
    const totalWeeks = Math.max(...client.program.phases.map((p) => p.weekEnd));
    const totalSessions = totalWeeks * perWeek;
    const pos = positionAtIndex(client.program, client.sessionsCompleted || 0);
    const lastLog = client.logs.length ? client.logs[client.logs.length - 1] : null;
    const recentPRs = [...(client.prLog || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    const today = todayStr();
    const readinessToday = client.readiness[today];
    const snapshot = {
      clientId: client.id, name: client.name, programName: client.program.name,
      blockNumber: client.blockNumber || 1, currentWeek: pos.weekNumber, totalWeeks,
      sessionsCompleted: client.sessionsCompleted || 0, totalSessions,
      totalWorkouts: client.logs.length,
      lastWorkoutDate: lastLog ? lastLog.date : null, lastWorkoutDay: lastLog ? lastLog.dayLabel : null,
      readinessColor: readinessToday ? readinessToday.color : null,
      recentPRs, updatedAt: new Date().toISOString(),
    };
    await supabase.from("roster_snapshots").upsert({
      roster_code: client.roster.code.trim().toUpperCase(), client_id: client.id, snapshot, updated_at: snapshot.updatedAt,
    });
  } catch {}
}
async function removeRosterSnapshot(client) {
  if (!client?.roster?.code?.trim() || !supabase) return;
  try { await supabase.from("roster_snapshots").delete().eq("roster_code", client.roster.code.trim().toUpperCase()).eq("client_id", client.id); } catch {}
}
async function fetchRoster(code) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("roster_snapshots").select("snapshot, updated_at").eq("roster_code", code.trim().toUpperCase());
    if (error || !data) return [];
    return data.map((row) => row.snapshot).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch { return []; }
}
async function getSettings(userId) { try { const v = await kvGet(userId, SETTINGS_KEY); return v || { theme: "dark" }; } catch { return { theme: "dark" }; } }
async function setSettings(userId, s) { try { await kvSet(userId, SETTINGS_KEY, s); } catch {} }

/* ============================== ID / MATH HELPERS ============================== */

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

function est1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}
function bestSetOf(sets) {
  let best = null;
  for (const s of sets || []) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    if (!w || !r) continue;
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
function generateMilestones() {
  const list = [];
  LIFT_MILESTONE_BASE.forEach((obj) => {
    for (let m = 1; m <= 5; m++) {
      list.push({ name: pluralizeMilestoneName(obj.name, m), weight: obj.weight * m, emoji: obj.emoji });
    }
  });
  list.sort((a, b) => a.weight - b.weight);
  return list.slice(0, 300);
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
    const key = monday.toISOString().slice(0, 10);
    map[key] = (map[key] || 0) + (log.totalVolume || 0);
  });
  return Object.keys(map).sort().map((k) => ({ date: fmtDate(k), volume: map[k] }));
}

/* ============================== CONJUGATE HELPERS ============================== */

function resolveExercise(e, weekNumber, program, phase) {
  if (e.rotatingPool && program.conjugate?.[e.rotatingPool]) {
    const pool = program.conjugate[e.rotatingPool];
    const rotW = program.conjugate.meRotationWeeks || 2;
    const idx = Math.floor((weekNumber - 1) / rotW) % pool.length;
    const chosen = pool[idx];
    return { ...e, name: chosen.name, purpose: chosen.notes || e.purpose, videoUrl: chosen.videoUrl || "",
      reps: chosen.reps || e.reps, sets: chosen.sets || e.sets, load: chosen.load || e.load, cues: chosen.cues || e.cues,
      poolLabel: e.rotatingPool === "meLowerPool" ? "Max Effort Lower" : "Max Effort Upper" };
  }
  if (e.deWave) {
    const pct = phase?.dePercent || "55%";
    const nums = (pct.match(/\d+/g) || []).map(Number);
    const pctNum = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    const perSetTargets = pctNum ? Array.from({ length: e.sets || 8 }, () => ({ pct1rm: pctNum, reps: e.reps, rir: e.rir })) : e.perSetTargets;
    return { ...e, load: `${pct} of your One-Rep Max, maximal bar speed`, perSetTargets };
  }
  return e;
}
function resolveSectionExercises(section, weekNumber, program, phase) {
  return section.exercises.map((e) => resolveExercise(e, weekNumber, program, phase));
}
function resolveDaySections(day, weekNumber, program, phase) {
  return day.sections.map((sec) => ({ ...sec, exercises: resolveSectionExercises(sec, weekNumber, program, phase) }));
}
function primaryLiftName(day, weekNumber, program, phase) {
  for (const sec of day.sections) {
    if (sec.type === "strength" || sec.type === "power") {
      const first = sec.exercises[0];
      if (first) return resolveExercise(first, weekNumber, program, phase).name;
    }
  }
  return day.name;
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
    if (color === "RED" && (sec.type === "agility" || sec.type === "durability" || sec.type === "arms_core")) {
      return { ...sec, exercises: [], skipped: true };
    }
    if (color === "RED" && (sec.type === "strength" || sec.type === "power")) {
      exs = exs.map((e) => ({
        ...e, rir: Math.max(e.rir || 0, 3),
        cues: `${e.cues || ""} Today: cap effort well short of a max — technical rehearsal only given low readiness.`.trim(),
        perSetTargets: e.perSetTargets ? e.perSetTargets.map((t) => ({ ...t, rir: Math.max(t.rir, 3), pct1rm: t.pct1rm ? Math.min(t.pct1rm, 85) : t.pct1rm, note: t.pct1rm && t.pct1rm >= 90 ? "Capped — low readiness" : t.note })) : e.perSetTargets,
        pct1rmFlat: e.pct1rmFlat ? Math.min(e.pct1rmFlat, 85) : e.pct1rmFlat,
      }));
    }
    if (color === "RED" && sec.type === "conditioning") {
      exs = exs.map((e) => ({ ...e, reps: "easy pace, roughly half the normal duration" }));
    }
    if (color === "YELLOW" && (sec.type === "strength" || sec.type === "power")) {
      exs = exs.map((e) => ({
        ...e, rir: (e.rir || 0) + 1,
        perSetTargets: e.perSetTargets ? e.perSetTargets.map((t) => ({ ...t, rir: t.rir + 1, pct1rm: t.pct1rm ? Math.max(50, t.pct1rm - 5) : t.pct1rm })) : e.perSetTargets,
        pct1rmFlat: e.pct1rmFlat ? Math.max(50, e.pct1rmFlat - 5) : e.pct1rmFlat,
      }));
    }
    if (color === "YELLOW" && (sec.type === "durability" || sec.type === "arms_core")) {
      exs = exs.map((e) => ({ ...e, sets: Math.max(1, Math.round((e.sets || 2) * 0.7)) }));
    }
    if (bjjHard && sec.type === "conditioning") {
      exs = exs.map((e) => ({ ...e, sets: 1, reps: "optional — trim or skip, hard grappling already supplied today's conditioning stimulus" }));
    }
    return { ...sec, exercises: exs, skipped };
  });

  if (color === "RED") notes.push("Red readiness: agility, durability, and arm/core work skipped. Strength capped at 3+ reps in reserve and 85% of your One-Rep Max at most — no true max attempts today, technical rehearsal only. Conditioning trimmed.");
  else if (color === "YELLOW") notes.push("Yellow readiness: one extra rep in reserve added and roughly 5% taken off every Max Effort and Dynamic Effort percentage. Durability and arm/core volume trimmed.");
  if (bjjHard) notes.push("Hard grappling flagged: conditioning trimmed since training already supplied that stimulus today.");

  return { sections: adjusted, adjustedNote: notes.length ? notes.join(" ") : null };
}

/* ============================== SEED PROGRAM: CONJUGATE BRAZILIAN JIU-JITSU / WRESTLING ============================== */

function ex(o) {
  return { id: uid(), sets: 3, reps: "8", load: "", rir: 2, rest: "90 seconds", tempo: "", cues: "", purpose: "", quality: "", videoUrl: "", perSetTargets: null, ...o };
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
    cues: "Work up in doubles and triples to a heavy top single or triple. This is a true max effort — stop when bar speed or technique breaks down, not at a preset percentage." });
}
function meUpperBlock() {
  return ex({ name: meUpperPool[0].name, rotatingPool: "meUpperPool", sets: 6, reps: "working sets of 3 down to 1", perSetTargets: meWorkingSets(), load: "autoregulated", rir: 0, rest: "3 to 4 minutes", quality: "Max Effort",
    cues: "Work up in doubles and triples to a heavy top single or triple. Stop on any breakdown in bar speed or technique." });
}
function deSquat(pct1rm) {
  return ex({ name: "Trap Bar Jump Squat — Dynamic Effort", deWave: true, sets: 8, reps: "3", load: "", rir: 0, rest: "90 seconds", quality: "Dynamic Effort", pct1rmFlat: pct1rm,
    cues: "Load the trap bar light to moderate, sit the hips back, explode into a jump, land soft and reset. Stop the set if jump height visibly drops.",
    purpose: "Rate of force development — loaded triple extension directly transferable to shots, sprawls, and scrambles" });
}
function deBench(pct1rm) {
  return ex({ name: "Speed Bench Press — Dynamic Effort", deWave: true, sets: 8, reps: "3", load: "", rir: 0, rest: "60 seconds", quality: "Dynamic Effort", pct1rmFlat: pct1rm,
    cues: "Fast, controlled descent; maximal bar speed off the chest. Stop the set if speed visibly drops.", purpose: "Upper body rate of force development" });
}

const meLowerPool = [
  { name: "Box Squat (bench set to box height)", notes: "Sit back to the bench at parallel, pause, drive up. Rotated to avoid staleness.", videoUrl: "" },
  { name: "Front Squat", notes: "Upright torso, quad and trunk-bracing emphasis", videoUrl: "" },
  { name: "Anderson Squat (from pins)", notes: "Dead-stop squat starting from safety pins set just below parallel — builds strength without any stretch-reflex assistance, a genuine Westside staple", videoUrl: "" },
  { name: "Zercher Squat", notes: "Heavy anterior-loaded trunk bracing — carries over to grappling posture under load", videoUrl: "" },
  { name: "Trap Bar Deadlift", notes: "Neutral grip, lower technical demand heavy pull — the safest way to push a true top single at home", videoUrl: "" },
  { name: "Barbell Good Morning", notes: "Posterior chain and hip-hinge strength", videoUrl: "" },
];
const meUpperPool = [
  { name: "Close-Grip Bench Press", notes: "Triceps-dominant press — frame and pummel strength", videoUrl: "" },
  { name: "Spoto Press", notes: "Pause one inch off the chest — strength off the chest without bounce", videoUrl: "" },
  { name: "Standing Barbell Overhead Press", notes: "Overhead strength, shoulder resilience", videoUrl: "" },
  { name: "Weighted Dip (dip station)", notes: "Pressing strength — chest, shoulders, and triceps under a heavy vertical load", videoUrl: "" },
  { name: "Incline Barbell Press", notes: "Upper chest and shoulder press strength", videoUrl: "" },
  { name: "Wide-Grip Bench Press", notes: "Chest-dominant press variation", videoUrl: "" },
];
const wristPool = [
  { name: "Barbell Wrist Curl and Reverse Wrist Curl (Flexors and Extensors)", notes: "Direct forearm strength through both wrist flexion and extension — the flexor and extensor work back to back", reps: "12 per direction" },
  { name: "Rice Bucket Grip Drills", notes: "Dig, twist, and squeeze through a bucket of rice — forearm and wrist rotator conditioning that also toughens the hands", reps: "20 seconds each direction" },
];
const bicepAltPool = [
  { name: "Inverse Zottman Curl", notes: "Curl with a reverse grip up, rotate to a standard grip on the way down — biceps and forearm rotator strength in one movement" },
  { name: "Face-Away Behind-the-Back Cable Curl", notes: "Face away from a low cable and curl behind the body — loads the biceps in a deep stretched position most curls never reach" },
];
const conditioningIntervalPool = [
  { name: "Assault Bike, Treadmill, or Weighted-Vest Backward Walk — Extensive Tempo Intervals", notes: "Jamieson's extensive tempo method — repeated short efforts that build repeat-effort work capacity and clear lactate between hard training days, without the glycolytic or nervous-system cost of true sprints or true VO2max work. The weighted-vest backward treadmill walk is the sled-substitute version of this same interval, and also unloads the knees eccentrically", reps: "15 rounds of 15 seconds moderate effort, 15 seconds easy", cues: "Work effort should feel like about a 6 to 7 out of 10 — brisk and purposeful, not a sprint. Heart rate should stay under roughly 155 beats per minute throughout the whole set; if you can check it, it should visibly rise during each 15-second work period and come back down during the 15-second rest, not climb higher every single round. Rest exactly 15 seconds — stay on your feet and keep moving lightly rather than sitting down, since the point is repeated effort under mild fatigue, not full recovery between rounds. If you can't hold a light jog pace or can't speak at all by round 5, the effort is too high for this protocol — back it off." },
  { name: "Assault Bike or Treadmill — Aerobic Power Intervals (Jamieson VO2max Protocol)", notes: "Jamieson's actual aerobic power interval method for raising VO2max — hard enough that heart rate climbs to roughly 90 percent of your max by the end of each work interval. This is genuinely demanding, which is exactly why it only shows up here every other week rather than every session", reps: "5 rounds of 2 to 3 minutes hard effort, equal time easy between rounds", cues: "Each work interval should be hard enough that you could not hold a conversation, and your heart rate should be climbing to roughly 90 percent of your estimated max (a rough estimate is 220 minus your age, though this varies person to person) by the time the interval ends — that is the actual point of this protocol, so don't undershoot it. Rest exactly as long as the work interval lasted — a 2-minute work round gets a full 2 minutes of easy rest, a 3-minute round gets 3 minutes — and use that rest to genuinely recover, walking or pedaling easily rather than stopping dead, letting heart rate come back down as much as it will before the next round starts. If your heart rate isn't climbing that high by the end of a work interval, the pace was too easy for what this protocol is built to train. Because this is demanding, it only appears every other week — treat the in-between week's extensive tempo work as the recovery, not a second dose of this." },
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
            ex({ name: "Single-Leg Balance Reach", sets: 1, reps: "5 reaches per leg", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Brief movement preparation only", quality: "Neuromuscular" }),
          ]},
          { id: uid(), type: "strength", name: "Main Strength", exercises: [ meLowerDeloadBlock() ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "Moderate Farmer Carry", sets: 2, reps: "20 meters", load: "moderate", rir: 3, rest: "90 seconds", purpose: "Light grip and trunk maintenance, low fatigue cost", quality: "Grip/Trunk" }),
          ]},
        ]},
      { id: uid(), label: "2", name: "Max Effort Upper — Deload",
        intent: "Same idea upstairs — moderate weight, clean technique, plenty of reps left in reserve.",
        sections: [
          { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
            ex({ name: "Scapular Push-Up", sets: 1, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Brief shoulder preparation only", quality: "Neuromuscular" }),
          ]},
          { id: uid(), type: "strength", name: "Main Strength", exercises: [ meUpperDeloadBlock() ]},
          { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
            ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "moderate time, well short of maximum", load: "bodyweight", rir: 3, rest: "60 seconds", purpose: "Light grip maintenance", quality: "Grip" }),
          ]},
        ]},
      { id: uid(), label: "3", name: "Full Body Recovery + Light Conditioning",
        intent: "No explosive lifting this week — just movement quality and an easy aerobic session. Let your body catch up.",
        sections: [
          { id: uid(), type: "agility", name: "Movement Quality", exercises: [
            ex({ name: "Multi-Planar Lunge Matrix", sets: 1, reps: "6 per direction", load: "bodyweight", rir: 3, rest: "45 seconds", purpose: "Easy full-body movement quality work, no explosive intent this week", quality: "Movement Quality" }),
          ]},
          { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
            ex({ name: "Assault Bike or Treadmill — Easy Aerobic", sets: 1, reps: "10 to 12 minutes", load: "easy, conversational pace", rir: 0, rest: "none", purpose: "Active recovery — keep the aerobic system ticking over without adding fatigue", quality: "Conditioning" }),
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
    "I've spent years studying the training philosophies of Westside Barbell, Phil Daru, Joel Jamieson, Marv Marinovich, Doctor Edythe Heus, Dane Miller, Josh Settlage, and other coaches who train elite strength and combat athletes, and merged that study with my own coaching experience to build this all-in-one program for grapplers who want to be in the top one percent. Technique decides a match between two athletes of different skill levels. But when two athletes are matched in technique, the stronger, more explosive, more durable athlete wins that exchange the overwhelming majority of the time. That gap — physical advantage between technically equal grapplers — is what this program exists to close.",
  methodology:
    "Structure: a condensed conjugate system (Max Effort and Dynamic Effort work) in the tradition of Westside Barbell, adapted for grappling the way coaches like Phil Daru and Josh Settlage (widely known as \"The Brazilian Jiu-Jitsu Strength Coach\") build combat-sport programs — Settlage's publicly stated approach keeps main lifts in an efficient 3-to-6 rep range to build strength without adding unnecessary size, pairs jump training with squat and deadlift work for explosiveness, and trains only as much volume as an athlete can actually recover from given their mat time, which is exactly the same governing principle behind this program's readiness-based auto-adjustment. Explosive strength work also draws on approaches associated with coaches like Dane Miller. Tissue preparation: warm-ups and select accessory work draw on fascia-focused, multi-planar movement principles associated with Marv Marinovich and Doctor Edythe Heus, and on Thomas Myers' Anatomy Trains myofascial-line concept, including loaded rotational work since grappling is a rotational sport. Neuromuscular and durability work: activation and durability blocks use reactive neuromuscular training principles associated with physical therapists Gray Cook and Michael Voight, and tendon-loading ideas associated with Cal Dietz's triphasic method, with dedicated coverage for the neck, ankles, wrists and elbows, shoulders, adductors, and knees. Conditioning: built around Joel Jamieson's actual combat-sport energy-system model rather than random high-intensity work — a genuine aerobic base as the foundation (heart rate held at 120 to 150 beats per minute, the qualifying standard for that work), Jamieson's extensive tempo method for repeat-effort work capacity, and his real aerobic power interval protocol for raising VO2max (roughly 2 to 3 minute hard efforts at about 90 percent of max heart rate, equal time easy between rounds) — used only every other week since it's genuinely demanding and grappling itself already supplies plenty of high-intensity stimulus on its own. Equipment: every exercise in this program is built specifically around a squat rack, barbell and plates, a flat bench, dumbbells, a dip station, a cable machine, a trap bar, bands, an adjustable weighted vest, a pull-up bar, an assault bike, and a treadmill. There is no sled in this program — anywhere that kind of loaded, repeat-effort work would normally show up, it's replaced with heavy carries, loaded barbell or trap bar pulls, weighted-vest incline or backward treadmill walking, or assault bike intervals, which deliver a comparable training stimulus with the equipment actually on hand. Fatigue management: not every method appears in every session — Max Effort, Dynamic Effort, accessory work, plyometrics, conditioning, and postural or joint work rotate intelligently across the week and across phases rather than being crammed into one long workout, and volume is trimmed automatically as grappling training and life stress go up. All of this is Category D — established, well-known coaching practice rather than heavily research-tested systems in isolation — layered on general strength principles (progressive overload, autoregulation using reps in reserve) that carry stronger evidence (National Strength and Conditioning Association and American College of Sports Medicine position stands). Every session also adjusts automatically to your daily readiness check-in and to hard grappling training.",
  philosophy:
    "Brazilian Jiu-Jitsu and wrestling are the priority. This program exists to make you stronger, more explosive, and more durable without taking anything away from the mats. Max Effort work is genuinely hard — push it, that's where strength is earned. Everything else here (agility preparation, durability work, conditioning) is deliberately dosed, and it automatically trims itself when your readiness check-in reads Yellow or Red, or when you flag hard grappling training. When in doubt, the app already errs toward less strength and conditioning work, not more.",
  conjugate: { meLowerPool, meUpperPool, wristPool, bicepAltPool, conditioningIntervalPool, meRotationWeeks: 2 },
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
              ex({ name: "Single-Leg Balance Reach", sets: 2, reps: "5 reaches per leg", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Reactive neuromuscular training for ankle and knee stability before loading the lift", quality: "Neuromuscular" }),
              ex({ name: "Lateral Shuffle", sets: 4, reps: "10 meters", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Primes lateral hip stability and change-of-direction patterning relevant to scrambles", quality: "Agility" }),
              ex({ name: "Pogo Hops", sets: 2, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Low-amplitude reactive hops — primes ankle and tendon stiffness before heavy lifting", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meLowerBlock(),
              ex({ name: "Single-Leg Hip Thrust (Dumbbell, bench-supported)", sets: 3, reps: "8 per leg", load: "moderate", rir: 2, rest: "90 seconds", purpose: "Posterior chain and single-leg stability", quality: "Accessory" }),
              ex({ name: "Hanging Leg Raise", sets: 3, reps: "10", load: "bodyweight", rir: 2, rest: "60 seconds", purpose: "Trunk flexion strength", quality: "Trunk" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Heavy Farmer Carry", sets: 3, reps: "30 meters", load: "heavy dumbbells, add the weighted vest for extra load if grip becomes the limiter", rir: 1, rest: "2 minutes", purpose: "Grip and trunk bracing under load", quality: "Grip/Trunk" }),
              ex({ name: "Copenhagen Plank (each side)", sets: 2, reps: "20 to 30 seconds per side", load: "bodyweight", rir: 1, rest: "60 seconds", purpose: "Adductor strength and durability — directly protective for guard retention and hip health", quality: "Durability" }),
              ex({ name: "Heavy Isometric Wall Sit", sets: 2, reps: "30 to 45 seconds", load: "bodyweight, or holding a dumbbell", rir: 1, rest: "90 seconds", purpose: "Tendon-loading isometric for knee health", quality: "Durability" }),
              ex({ name: "Tibialis Raise", sets: 2, reps: "15", load: "bodyweight or a light plate", rir: 2, rest: "45 seconds", purpose: "Ankle and shin strength and durability — protects the ankle joint under guard-retention and scrambling loads", quality: "Durability" }),
              ex({ name: "Foot Crunches (Toe Scrunches)", sets: 2, reps: "15", load: "bodyweight, or scrunching a small towel with your toes", rir: 2, rest: "30 seconds", purpose: "Strengthens the intrinsic muscles of the foot — foot mobility and control matter directly for barefoot grappling on the mat", quality: "Foot Mobility" }),
              ex({ name: "Metatarsal Spread (Toe Splay)", sets: 2, reps: "15", load: "bodyweight", rir: 2, rest: "30 seconds", purpose: "Trains active spreading of the toes and forefoot — foot mobility and base stability for scrambles and takedown defense", quality: "Foot Mobility" }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper + Durability + Arms & Core",
          intent: "Same approach on the press — one hard top set, then light shoulder-health, grip and tendon, arm, and core work. Don't chase extra volume this early in the block.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Scapular Push-Up", sets: 2, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Activates the serratus anterior, primes shoulder blade control before heavy pressing", quality: "Neuromuscular" }),
              ex({ name: "Dip Station Support Hold", sets: 2, reps: "15 seconds", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Shoulder stability and proprioception, isometric support on the dip bars before heavy pressing", quality: "Neuromuscular" }),
              ex({ name: "Cable External Rotation (light)", sets: 2, reps: "12 per side", load: "light", rir: 2, rest: "45 seconds", purpose: "Rotator cuff activation and shoulder health before heavy pressing", quality: "Agility" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meUpperBlock(),
              ex({ name: "Weighted Pull-Up", sets: 4, reps: "5", load: "added weight", rir: 2, rest: "2 to 3 minutes", purpose: "Pulling strength, grappling transfer", quality: "Accessory" }),
              ex({ name: "Single-Arm Dumbbell Row", sets: 3, reps: "8 per side", load: "moderate", rir: 2, rest: "90 seconds", purpose: "Unilateral pull, scapular resilience", quality: "Accessory" }),
              ex({ name: "Cable Face Pull", sets: 3, reps: "15", load: "light to moderate", rir: 2, rest: "60 seconds", purpose: "Shoulder and scapular health", quality: "Prehab" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "maximum time", load: "bodyweight", rir: 1, rest: "90 seconds", purpose: "Support grip, isometric strength", quality: "Grip" }),
              ex({ name: wristPool[0].name, rotatingPool: "wristPool", sets: 2, reps: wristPool[0].reps, load: "light", rir: 2, rest: "45 seconds", purpose: "Direct wrist flexor and extensor strength, alternated every 2 weeks with rice bucket grip work for tendon health and grip conditioning", quality: "Durability" }),
              ex({ name: "Neck Curl and Neck Extension (light plate or manual resistance)", sets: 2, reps: "10 per direction", load: "light plate or your own hand for resistance", rir: 2, rest: "45 seconds", purpose: "Direct neck strength through a full range of motion — protective against neck cranks, guillotines, and posture under pressure", quality: "Durability" }),
            ]},
            { id: uid(), type: "arms_core", name: "Arms & Core Isolation", exercises: [
              ex({ name: bicepAltPool[0].name, rotatingPool: "bicepAltPool", sets: 3, reps: "10 per side", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Direct arm isolation — biceps and forearm strength for grip fighting and pulling positions, alternated every 2 weeks between two curl variations", quality: "Arms" }),
              ex({ name: "Pallof Press (Anti-Rotation)", sets: 3, reps: "10 per side", load: "light to moderate cable", rir: 2, rest: "60 seconds", purpose: "Anti-rotation trunk strength — resisting rotation is as important for grappling as producing it", quality: "Core" }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Full Body Dynamic Effort + Speed & Agility + Conditioning",
          intent: "Speed and rhythm over grinding. The conditioning piece should feel easy — if it doesn't, you're going too hard for a base week.",
          sections: [
            { id: uid(), type: "agility", name: "Speed, Agility & Change of Direction", exercises: [
              ex({ name: "Pogo Hops", sets: 2, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Elastic ankle stiffness preparation before jump-loaded work", quality: "Neuromuscular" }),
              ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 4, reps: "1 maximal effort sprint", load: "bodyweight, full recovery between efforts", rir: 0, rest: "90 seconds", purpose: "Alactic power and acceleration — short maximal efforts with full recovery, directly relevant to explosive takedown entries", quality: "Alactic Power" }),
              ex({ name: "Five-Ten-Five Pro Agility Shuttle", sets: 3, reps: "1 shuttle", load: "bodyweight", rir: 0, rest: "90 seconds", purpose: "Combines acceleration, deceleration, lateral movement, and change of direction in a single drill", quality: "Agility" }),
            ]},
            { id: uid(), type: "power", name: "Dynamic Effort & Grappling Power", exercises: [
              deSquat(50), deBench(50),
              ex({ name: "Landmine Rotational Press (each side)", sets: 3, reps: "6 per side", load: "light to moderate", rir: 1, rest: "90 seconds", purpose: "Loaded rotational power — hip-to-shoulder force transfer directly relevant to underhooks, throws, and scrambles", quality: "Rotational Power" }),
            ]},
            { id: uid(), type: "arms_core", name: "Arm Isolation", exercises: [
              ex({ name: "Cable Triceps Pushdown", sets: 3, reps: "12", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Direct arm isolation — triceps strength for framing and pushing off the mat", quality: "Arms" }),
            ]},
            { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
              ex({ name: "Assault Bike or Incline Treadmill Walk — Aerobic Base (Jamieson Zone 1)", sets: 1, reps: "15 to 20 minutes", load: "heart rate held at 120 to 150 beats per minute — conversational, nasal-breathing pace", rir: 0, rest: "none", purpose: "General aerobic base development — the foundation of Jamieson's energy-system model. This is the qualifying work: staying inside that heart-rate window, not the pace, is what builds the aerobic engine. Add the weighted vest on the treadmill for a heavier, sled-style version of this same stimulus", quality: "Conditioning",
                cues: "A rough estimate for max heart rate is 220 minus your age, though this varies quite a bit person to person — 120 to 150 beats per minute typically lands in the 65 to 75 percent range of that number for most adults. No rest during this one, it's continuous — the whole 15 to 20 minutes stays inside that heart-rate window. If you don't have a heart rate monitor, use the talk test: you should be able to speak in full sentences without gasping for air, but it shouldn't feel as easy as sitting and chatting. If you can't finish a sentence without stopping to breathe, you've drifted above the zone — slow down. If you could comfortably hold a full conversation for the entire 20 minutes without your breathing rate ever picking up at all, you're below the zone — pick the pace up slightly." }),
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
              ex({ name: "Single-Leg Balance Reach", sets: 2, reps: "5 reaches per leg", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Reactive neuromuscular training for ankle and knee stability", quality: "Neuromuscular" }),
              ex({ name: "Lateral Shuffle", sets: 3, reps: "10 meters", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Lateral hip stability, change-of-direction priming", quality: "Agility" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meLowerBlock(),
              ex({ name: "Single-Leg Hip Thrust (Dumbbell, bench-supported)", sets: 3, reps: "6 per leg", load: "moderate to heavy", rir: 2, rest: "90 seconds", purpose: "Posterior chain strength", quality: "Accessory" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Heavy Farmer Carry", sets: 3, reps: "20 meters", load: "heavier", rir: 1, rest: "2 minutes", purpose: "Grip and trunk under near-maximal load", quality: "Grip/Trunk" }),
              ex({ name: "Copenhagen Plank (each side)", sets: 2, reps: "20 to 30 seconds per side", load: "bodyweight", rir: 1, rest: "60 seconds", purpose: "Adductor durability for guard retention", quality: "Durability" }),
              ex({ name: "Tibialis Raise", sets: 2, reps: "15", load: "bodyweight or a light plate", rir: 2, rest: "45 seconds", purpose: "Ankle and shin durability", quality: "Durability" }),
              ex({ name: "Foot Crunches (Toe Scrunches)", sets: 2, reps: "15", load: "bodyweight, or scrunching a small towel with your toes", rir: 2, rest: "30 seconds", purpose: "Intrinsic foot strength for barefoot grappling", quality: "Foot Mobility" }),
              ex({ name: "Metatarsal Spread (Toe Splay)", sets: 2, reps: "15", load: "bodyweight", rir: 2, rest: "30 seconds", purpose: "Foot mobility and base stability for scrambles", quality: "Foot Mobility" }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper + Durability + Arms & Core",
          intent: "Same logic upstairs — hard top set, short accessory list. If grappling was rough this week, this is the day to trim first.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Scapular Push-Up", sets: 2, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Serratus activation before pressing", quality: "Neuromuscular" }),
              ex({ name: "Dip Station Support Hold", sets: 2, reps: "15 seconds", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Shoulder stability and proprioception", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [
              meUpperBlock(),
              ex({ name: "Weighted Pull-Up", sets: 4, reps: "4", load: "added weight", rir: 2, rest: "2 to 3 minutes", purpose: "Pulling strength maintenance", quality: "Accessory" }),
            ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "maximum time", load: "bodyweight", rir: 1, rest: "90 seconds", purpose: "Support grip — kept low volume, grappling already fatigues grip", quality: "Grip" }),
              ex({ name: wristPool[0].name, rotatingPool: "wristPool", sets: 2, reps: wristPool[0].reps, load: "light", rir: 2, rest: "45 seconds", purpose: "Direct wrist flexor and extensor strength, alternated every 2 weeks with rice bucket grip work", quality: "Durability" }),
              ex({ name: "Neck Curl and Neck Extension (light plate or manual resistance)", sets: 2, reps: "10 per direction", load: "light plate or your own hand for resistance", rir: 2, rest: "45 seconds", purpose: "Neck strength and durability", quality: "Durability" }),
            ]},
            { id: uid(), type: "arms_core", name: "Arms & Core Isolation", exercises: [
              ex({ name: bicepAltPool[0].name, rotatingPool: "bicepAltPool", sets: 3, reps: "10 per side", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Direct arm isolation, alternated every 2 weeks between two curl variations", quality: "Arms" }),
              ex({ name: "Pallof Press (Anti-Rotation)", sets: 3, reps: "10 per side", load: "light to moderate cable", rir: 2, rest: "60 seconds", purpose: "Anti-rotation trunk strength", quality: "Core" }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Full Body Dynamic Effort + Speed & Agility + Conditioning",
          intent: "Tempo work, not a fight. Moderate-hard effort, never all-out — save your nervous system for the mats and for the next top set.",
          sections: [
            { id: uid(), type: "agility", name: "Speed, Agility & Change of Direction", exercises: [
              ex({ name: "Pogo Hops", sets: 2, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Elastic ankle stiffness preparation", quality: "Neuromuscular" }),
              ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 4, reps: "1 maximal effort sprint", load: "bodyweight, full recovery between efforts", rir: 0, rest: "90 seconds", purpose: "Alactic power and acceleration", quality: "Alactic Power" }),
              ex({ name: "Five-Ten-Five Pro Agility Shuttle", sets: 3, reps: "1 shuttle", load: "bodyweight", rir: 0, rest: "90 seconds", purpose: "Acceleration, deceleration, lateral movement, and change of direction in one drill", quality: "Agility" }),
            ]},
            { id: uid(), type: "power", name: "Dynamic Effort & Grappling Power", exercises: [
              deSquat(55), deBench(55),
              ex({ name: "Landmine Rotational Press (each side)", sets: 3, reps: "6 per side", load: "light to moderate", rir: 1, rest: "90 seconds", purpose: "Loaded rotational power for throws and scrambles", quality: "Rotational Power" }),
              ex({ name: "Trap Bar High Pull", sets: 4, reps: "5", load: "moderate, explosive intent", rir: 1, rest: "2 minutes", purpose: "Total-body explosive triple extension and grip demand — the closest barbell-based equivalent to a loaded sandbag or sled push without either", quality: "Power" }),
            ]},
            { id: uid(), type: "arms_core", name: "Arm Isolation", exercises: [
              ex({ name: "Cable Triceps Pushdown", sets: 3, reps: "12", load: "moderate", rir: 2, rest: "60 seconds", purpose: "Direct arm isolation", quality: "Arms" }),
            ]},
            { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
              ex({ name: conditioningIntervalPool[0].name, rotatingPool: "conditioningIntervalPool", sets: 1, reps: conditioningIntervalPool[0].reps, load: "see reps for the exact protocol", rir: 0, rest: "none", purpose: "Alternates every 2 weeks between Jamieson's extensive tempo method and his actual aerobic power interval protocol for raising VO2max, so both energy systems get trained without every single week being maximally fatiguing", quality: "Conditioning" }),
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
              ex({ name: "Single-Leg Balance Reach", sets: 1, reps: "5 reaches per leg", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Brief preparation only — freshness is the priority", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [ meLowerBlock() ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Heavy Farmer Carry", sets: 2, reps: "20 meters", load: "heavy", rir: 1, rest: "90 seconds", purpose: "Grip and trunk maintenance, low volume for freshness", quality: "Grip/Trunk" }),
              ex({ name: "Hanging Leg Raise", sets: 2, reps: "10", load: "bodyweight", rir: 2, rest: "60 seconds", purpose: "Trunk flexion strength, kept brief to protect freshness", quality: "Trunk" }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper",
          intent: "Same — hard top set, minimal accessory. This late in the block, more volume doesn't make you stronger, it just makes you tired.",
          sections: [
            { id: uid(), type: "agility", name: "Neuromuscular Activation & Agility", exercises: [
              ex({ name: "Scapular Push-Up", sets: 1, reps: "10", load: "bodyweight", rir: 0, rest: "45 seconds", purpose: "Brief shoulder preparation only", quality: "Neuromuscular" }),
            ]},
            { id: uid(), type: "strength", name: "Main Strength", exercises: [ meUpperBlock() ]},
            { id: uid(), type: "durability", name: "Durability & Tendon Health", exercises: [
              ex({ name: "Pull-Up Bar Dead Hang", sets: 2, reps: "maximum time", load: "bodyweight", rir: 1, rest: "90 seconds", purpose: "Grip maintenance, minimal volume", quality: "Grip" }),
              ex({ name: wristPool[0].name, rotatingPool: "wristPool", sets: 1, reps: wristPool[0].reps, load: "light", rir: 2, rest: "45 seconds", purpose: "Brief wrist flexor and extensor maintenance, kept low to protect freshness this close to peak weeks", quality: "Durability" }),
              ex({ name: "Neck Curl and Neck Extension (light plate or manual resistance)", sets: 1, reps: "8 per direction", load: "light plate or your own hand for resistance", rir: 2, rest: "45 seconds", purpose: "Brief neck maintenance, kept low to protect freshness this close to peak weeks", quality: "Durability" }),
              ex({ name: "Pallof Press (Anti-Rotation)", sets: 2, reps: "10 per side", load: "light cable", rir: 2, rest: "60 seconds", purpose: "Anti-rotation trunk strength, kept brief to protect freshness", quality: "Core" }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Full Body Dynamic Effort",
          intent: "Keep it snappy and short. This is the easiest day to cut entirely if grappling is heavy this week.",
          sections: [
            { id: uid(), type: "agility", name: "Speed & Agility", exercises: [
              ex({ name: "Acceleration Sprint (10 to 15 yards)", sets: 3, reps: "1 maximal effort sprint", load: "bodyweight, full recovery", rir: 0, rest: "90 seconds", purpose: "Alactic power maintenance", quality: "Alactic Power" }),
            ]},
            { id: uid(), type: "power", name: "Dynamic Effort & Grappling Power", exercises: [
              deSquat(62), deBench(62),
              ex({ name: "Heavy Dumbbell Swing", sets: 3, reps: "5", load: "heavy dumbbell", rir: 0, rest: "2 minutes", purpose: "Hip power expression", quality: "Power" }),
            ]},
            { id: uid(), type: "conditioning", name: "Grappling Conditioning", exercises: [
              ex({ name: "Assault Bike or Treadmill — Aerobic Maintenance", sets: 1, reps: "8 to 10 minutes", load: "easy to moderate, heart rate under about 140 beats per minute", rir: 0, rest: "none", purpose: "Maintain aerobic qualities without adding fatigue this close to peak weeks", quality: "Conditioning",
                cues: "This is deliberately shorter and easier than the base-phase version — the goal now is just to hold onto what you've already built, not add more. Stay well under 140 beats per minute the whole time; if you can check it, this should feel closer to a warm-up than real training. No rest, continuous movement for the full 8 to 10 minutes." }),
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
              ex({ ...meLowerBlock(), sets: 5, perSetTargets: meRetestSets(), cues: "Same rotation exercise as this week's pool slot. Every set stays at 50 to 60 percent of your last known One-Rep Max — this is deliberately light, not a build-up to anything heavy." }),
            ]},
          ]},
        { id: uid(), label: "2", name: "Max Effort Upper — Deload",
          intent: "Same approach — stay light on purpose, no ego reps.",
          sections: [
            { id: uid(), type: "strength", name: "Main Strength — Deload", exercises: [
              ex({ ...meUpperBlock(), sets: 5, perSetTargets: meRetestSets(), cues: "Same rotation exercise as this week's pool slot. Every set stays at 50 to 60 percent of your last known One-Rep Max." }),
            ]},
          ]},
        { id: uid(), label: "3", name: "Recovery & Easy Conditioning",
          intent: "Light and easy, full stop. The only goal this week is walking into the next block's Week 1 completely recovered.",
          sections: [
            { id: uid(), type: "conditioning", name: "Aerobic Base — Deload", exercises: [
              ex({ name: "Assault Bike or Incline Treadmill Walk — Aerobic Base (Jamieson Zone 1)", sets: 1, reps: "12 to 15 minutes", load: "heart rate held at 120 to 150 beats per minute — easy, conversational pace", rir: 0, rest: "none", purpose: "Easy aerobic movement to stay loose without adding any real fatigue heading into next week's fresh start", quality: "Conditioning" }),
            ]},
          ]},
      ],
    },
  ],
};

function defaultWarmup() {
  return [
    { id: uid(), block: "General Raise", duration: "3 to 5 minutes", items: [
      { id: uid(), name: "Assault Bike or Treadmill, light pace", detail: "Build to a light sweat, nasal breathing only", videoUrl: "" },
    ]},
    { id: uid(), block: "Dynamic Mobility", duration: "5 to 6 minutes", items: [
      { id: uid(), name: "World's Greatest Stretch", detail: "5 reps per side", videoUrl: "" },
      { id: uid(), name: "Leg Swings, front-to-back and lateral", detail: "10 reps per direction per side", videoUrl: "" },
      { id: uid(), name: "Hip Circles", detail: "8 reps per direction per side", videoUrl: "" },
      { id: uid(), name: "Thoracic Rotations (quadruped)", detail: "8 reps per side", videoUrl: "" },
      { id: uid(), name: "Cable Pull-Apart (light, rope attachment)", detail: "15 reps", videoUrl: "" },
      { id: uid(), name: "Toe Yoga (big toe and little toe isolation)", detail: "10 reps per foot, barefoot", videoUrl: "" },
    ]},
    { id: uid(), block: "Fascial & Multi-Planar Preparation", duration: "3 to 4 minutes", items: [
      { id: uid(), name: "Multi-Planar Lunge Matrix", detail: "Forward, lateral, and rotational lunge, each direction, bodyweight", videoUrl: "" },
      { id: uid(), name: "Cable Diagonal Chop (light load)", detail: "High-to-low and low-to-high, 6 reps per side", videoUrl: "" },
      { id: uid(), name: "Cross-Crawl March with Reach", detail: "10 total, slow and controlled", videoUrl: "" },
    ]},
    { id: uid(), block: "Activation", duration: "3 to 4 minutes", items: [
      { id: uid(), name: "Glute Bridge", detail: "12 reps", videoUrl: "" },
      { id: uid(), name: "Bodyweight Lateral Squat Walk", detail: "10 steps per direction", videoUrl: "" },
      { id: uid(), name: "Dead Bug", detail: "8 reps per side", videoUrl: "" },
    ]},
    { id: uid(), block: "Movement-Specific Ramp-Up", duration: "3 to 5 minutes", items: [
      { id: uid(), name: "Ramp up today's first lift", detail: "2 to 3 warm-up sets with the empty bar and increasing load, building to the first working set", videoUrl: "" },
    ]},
  ];
}

function defaultMobility() {
  return [
    { id: uid(), name: "Down-Regulation Breathing", seconds: 120, type: "breath", detail: "Box breathing — inhale 4, hold 4, exhale 4, hold 4. Let your heart rate settle after training.", videoUrl: "" },
    { id: uid(), name: "Couch Stretch (each side)", seconds: 180, type: "stretch", detail: "90 seconds per side. Rear knee down, hips squared forward, glute of the back leg engaged.", videoUrl: "" },
    { id: uid(), name: "90/90 Hip Switch Flow", seconds: 60, type: "stretch", detail: "Flow slowly side to side, feeling both hips through internal and external rotation.", videoUrl: "" },
    { id: uid(), name: "Figure-4 / Pigeon Stretch (each side)", seconds: 180, type: "stretch", detail: "90 seconds per side. Sit into the hip, keep the spine tall, breathe into the stretch.", videoUrl: "" },
    { id: uid(), name: "Deep Squat Hold", seconds: 60, type: "stretch", detail: "Heels down if possible, hands inside the knees gently pressing them out.", videoUrl: "" },
    { id: uid(), name: "Open Book Thoracic Rotation (each side)", seconds: 90, type: "stretch", detail: "45 seconds per side, slow controlled rotation, follow the top hand with your eyes.", videoUrl: "" },
    { id: uid(), name: "Overhead Lat and Shoulder Stretch (each side)", seconds: 90, type: "stretch", detail: "45 seconds per side, hand on the rack or a bar, side-bend away to lengthen the lat.", videoUrl: "" },
    { id: uid(), name: "Neck Mobility Flow", seconds: 60, type: "stretch", detail: "Slow flexion, extension, and side-to-side — no forcing, stay pain-free.", videoUrl: "" },
    { id: uid(), name: "Straddle Hamstring and Adductor Hold", seconds: 120, type: "stretch", detail: "Long hold. Hinge from the hips and relax deeper into the stretch on each exhale.", videoUrl: "" },
    { id: uid(), name: "Child's Pose with Lateral Reach", seconds: 60, type: "stretch", detail: "Walk your hands to each side to open the lats and obliques.", videoUrl: "" },
    { id: uid(), name: "Closing Breathwork / Body Scan", seconds: 120, type: "breath", detail: "Slow nasal breathing, scan down the body, notice what loosened up.", videoUrl: "" },
  ];
}

function blankProgram(name) {
  return {
    id: uid(), name: name || "Custom Program", sport: "", sessionsPerWeek: 3,
    coachNote: "", methodology: "", philosophy: "",
    conjugate: { meLowerPool: [], meUpperPool: [], wristPool: [], bicepAltPool: [], conditioningIntervalPool: [], meRotationWeeks: 2 },
    warmup: defaultWarmup(),
    mobility: defaultMobility(),
    phases: [{ id: uid(), name: "Phase 1", weekStart: 1, weekEnd: 4, objective: "", intensityNote: "",
      days: [{ id: uid(), label: "1", name: "Day A", intent: "", sections: [{ id: uid(), type: "strength", name: "Main Strength", exercises: [] }] }] }],
  };
}

function defaultWeeklySchedule() {
  return {
    mon: "6:00–7:00 AM Brazilian Jiu-Jitsu\n6:30–8:00 PM Brazilian Jiu-Jitsu",
    tue: "6:00–7:00 AM Strength & Conditioning\n6:30–8:00 PM Brazilian Jiu-Jitsu",
    wed: "6:30–8:00 PM Brazilian Jiu-Jitsu",
    thu: "Off",
    fri: "6:00–7:00 AM Brazilian Jiu-Jitsu\n7:30–8:30 AM Strength & Conditioning",
    sat: "12:00–1:00 PM Brazilian Jiu-Jitsu",
    sun: "6:00–7:00 AM Strength & Conditioning",
  };
}
function buildProgramVariant(variant) {
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
          day.intent = "Two qualities in one session, Settlage-style — a true max effort on the lower body lift, then explosive speed work on the upper body press. Keep the Dynamic Effort set genuinely fast, not just lighter.";
          day.sections.splice(1, 0, { id: uid(), type: "power", name: "Dynamic Effort Upper", exercises: [deBench(dePct)] });
        }
        if (day.label === "2" && day.name.includes("Max Effort Upper")) {
          day.name = day.name.replace("Max Effort Upper", "Max Effort Upper + Dynamic Effort Lower");
          day.intent = "Same idea in reverse — max effort on the press, then explosive speed work on the lower body. Two qualities trained per session so three days a week covers everything.";
          day.sections.splice(1, 0, { id: uid(), type: "power", name: "Dynamic Effort Lower", exercises: [deSquat(dePct)] });
        }
      });
    });
  } else {
    base.name = "Traditional Split — Twelve-Week Program (Program B)";
    base.variant = "B";
  }
  return base;
}

function buildClient({ id, firstName, lastName, weight, heightFeet, heightInches, useTemplate, beltLevel, programVariant }) {
  const name = `${firstName} ${lastName}`.trim() || "Athlete";
  return {
    id, name, firstName, lastName, heightFeet: heightFeet || 0, heightInches: heightInches || 0,
    createdAt: todayStr(),
    program: useTemplate ? buildProgramVariant(programVariant === "A" ? "A" : "B") : blankProgram(),
    logs: [], readiness: {}, prLog: [],
    bodyweightLog: weight ? [{ date: todayStr(), weight: Number(weight) }] : [],
    mobilityLogs: [], sessionsCompleted: 0, blockNumber: 1,
    roster: { code: "", sharing: false }, hasSeenTutorial: false,
    weeklySchedule: defaultWeeklySchedule(),
    beltLevel: beltLevel || "White",
    bjjNotes: [],
  };
}

const BELT_LEVELS = ["White", "Grey", "Yellow", "Orange", "Green", "Blue", "Purple", "Brown", "Black"];

const MENTAL_COACHING_LIBRARY = [
  { title: "Getting tapped is data, not a verdict", body: "A tap tells you exactly one thing: that specific position, against that specific person, on that specific day, didn't work. It says nothing about your worth as a grappler. The athletes who improve fastest treat every tap as free information about a hole in their game, then go close that hole — instead of spiraling about what it means about them." },
  { title: "Breathe before you decide", body: "Under real pressure — bad position, gassed, opponent surging — your first impulse is almost always panic, not strategy. Build the habit of one slow exhale before you commit to an escape or a scramble. That half-second doesn't cost you the position. It's usually what saves it." },
  { title: "You're allowed to be bad at new things forever", body: "Every belt promotion quietly demotes you back to white belt at the next level of the game. That feeling of being clumsy again isn't a sign you're regressing — it's the actual mechanism of getting better. The athletes who plateau are usually the ones who stopped being willing to feel incompetent." },
  { title: "Rolling with lower belts isn't a threat to your ego", body: "If a white belt catches you, that's not evidence you're bad — it's evidence they found a gap everyone has and you happened to be the one training with them that day. Treat it as free coaching. The moment ego enters the room, learning leaves it." },
  { title: "Competition nerves are just excitement without a story", body: "Physiologically, fear and excitement are almost the same signal — racing heart, tight chest, adrenaline. The difference is entirely the story you tell yourself about it. Before you step on the mat, try relabeling it out loud: 'I'm excited,' not 'I'm scared.' Your body won't know the difference, but your mind will." },
  { title: "Play the position, not the outcome", body: "Thinking about winning the match while you're still in guard is a distraction from the only thing that actually determines the outcome — winning this exchange, right now. Narrow your focus to the frame, the grip, the base in front of you. The scoreboard takes care of itself when the details do." },
  { title: "Plateaus are where the actual adaptation happens", body: "The weeks where nothing feels like it's improving are usually exactly when your nervous system is consolidating the last six months of reps. Visible progress and actual progress are not the same timeline. Trust the process specifically during the stretch where it stops feeling like progress." },
  { title: "Losing a scramble is not losing the round", body: "Grapplers with real composure treat a bad scramble as one exchange among dozens in a round, not a referendum on the whole roll. The athletes who lose their composure after one bad exchange usually lose two or three more chasing the feeling of having 'fixed' it immediately. Reset, breathe, next exchange." },
  { title: "Visualize the specific problem, not just success", body: "Generic visualization — 'I win the match' — does almost nothing for performance. Specific visualization — rehearsing exactly how you'll answer a collar tie, or what you'll do when someone stalls in your guard — genuinely primes the same neural pathways as physical repetition. Be precise about what you rehearse." },
  { title: "Your training partners are not your opponents", body: "The number one predictor of long-term improvement in grappling isn't talent, it's whether you stay in a gym long enough to build real training relationships. Protect those relationships — roll hard, but never at the cost of someone else's safety or willingness to keep training with you." },
  { title: "Discomfort is the actual curriculum", body: "If a position feels easy, you're probably not the one being tested in it. Seek out the rolls and drills that make you uncomfortable — bad position, worse grips, tougher partner — since that's precisely the stimulus your game is missing. Comfortable training produces comfortable, stagnant results." },
  { title: "Frustration is information about your standards, not your ability", body: "Getting frustrated in a roll usually means you expect more from yourself than you're currently delivering — which is actually a sign you're improving, not failing. The skill isn't eliminating frustration, it's noticing it quickly and returning attention to the next single detail in front of you." },
  { title: "The mat doesn't care about your bad day", body: "Walking in stressed, tired, or distracted and expecting your body to perform like nothing happened is unrealistic — but so is skipping training every time life gets hard. The middle path: show up, lower your expectations for that specific session, and let it be maintenance rather than a personal record attempt." },
  { title: "Confidence is built in rehearsal, not granted by belief", body: "Telling yourself 'I'm confident' rarely works under real pressure if you haven't actually drilled the response enough times to trust your body. Real competition confidence comes from having done the specific movement — the escape, the pass, the submission — enough times that your body doesn't need permission from your mind to execute it." },
  { title: "You can't out-technique panic", body: "The best technical game in the world falls apart if your nervous system floods with panic the moment things go wrong. Train your ability to stay calm in bad positions on purpose — start rolls from the worst spot, hold mount bottom longer than comfortable — so panic stops being the default response when it happens for real." },
  { title: "Injuries test who you actually are as a training partner", body: "How you roll with an injured or clearly overmatched partner reveals more about your character than any tournament medal. Control is not the same as domination. The grapplers everyone wants to train with long-term are the ones who can go hard without ever needing to prove it against someone who can't defend themselves." },
  { title: "Separate the loss from the story about the loss", body: "Losing a match or getting submitted repeatedly by the same person triggers a story — 'I'm not good enough,' 'I'll never beat them' — that's almost always bigger and more permanent-sounding than the actual event. Write down what literally happened, technically, without the narrative. The gap between the two is usually where your anxiety is actually living." },
  { title: "Pressure reveals your training, it doesn't create weakness", body: "Whatever shows up when you're tired, losing, or under a strong opponent isn't a new flaw appearing — it's an existing gap becoming visible because there's no energy left to mask it. Treat competition and hard rounds as the most honest diagnostic tool you have, not as unfair tests of character." },
  { title: "Slow is a skill, not a consolation prize", body: "Grapplers chasing speed and explosiveness before they have real control usually plateau early, because speed without precision just means making mistakes faster. Deliberately slow rolling — where you could stop and explain every grip and weight distribution — builds the base that speed eventually gets layered onto." },
  { title: "The person you're most afraid to roll with is your best teacher", body: "Avoidance of a specific training partner is almost always a signal, not a preference. Notice who you quietly try not to roll with, and ask honestly why. That roll — not the comfortable ones — is usually where the actual next lesson is waiting." },
  { title: "Recovery is part of the technique, not separate from it", body: "Showing up exhausted and forcing a hard round doesn't build toughness, it builds bad movement patterns your body will default to under pressure later. Real mental toughness sometimes looks like tapping into your ego and taking the lighter round, or the day off, because you can tell the difference between fatigue and weakness." },
  { title: "Compare yourself to your last version, not to your training partners", body: "Everyone in the room started at a different point, with a different body, a different schedule, and different life stress outside the gym. The only fair comparison is you six months ago. If that person would be impressed with where you are now, you're on track — regardless of who's currently tapping you." },
  { title: "Name the emotion before it runs the roll", body: "Frustration, fear, and anger all narrow your attention and make you fight the position instead of solving it. The fastest way out of an emotional spiral mid-roll is silently naming it — 'this is frustration' — which genuinely reactivates the thinking part of your brain that panic and anger shut off." },
  { title: "A bad camp doesn't mean a bad competitor", body: "If your training leading into a competition was disrupted — injury, work, life — walk in with adjusted goals instead of abandoning the goal entirely. 'Survive and learn' is a completely legitimate competition objective. Showing up under-prepared and competing anyway builds more resilience than skipping it would." },
  { title: "Your ego and your growth want different things", body: "Ego wants to win every round, submit everyone, never look bad in front of the gym. Growth wants you in bad positions, against tougher partners, failing in front of people. Notice which one is choosing your training partners and your rolling intensity on a given day — and deliberately let growth win more often than ego does." },
];

function mentalTipForDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  return MENTAL_COACHING_LIBRARY[hash % MENTAL_COACHING_LIBRARY.length];
}

/* ============================== READINESS ============================== */

function classifyReadiness(r) {
  const pos = (Number(r.sleep) + Number(r.energy)) / 2;
  const neg = Number(r.soreness);
  const score = pos - neg;
  if (score <= -1.5) return "RED";
  if (score >= 1.5) return "GREEN";
  return "YELLOW";
}
const READINESS_COPY = {
  GREEN: { detail: "Complete today's session as written.", color: "var(--green)" },
  YELLOW: { detail: "Session automatically adjusted: one extra rep in reserve on strength and power, durability and arm/core work trimmed.", color: "var(--amber)" },
  RED: { detail: "Session automatically adjusted: agility, durability, and arm/core work skipped, strength capped well short of failure, conditioning trimmed.", color: "var(--accent)" },
};

/* ============================== APP SHELL ============================== */

const TABS = [
  { id: "today", label: "Today", icon: Home },
  { id: "schedule", label: "Schedule", icon: ListOrdered },
  { id: "program", label: "Program", icon: CalendarDays },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "bjj", label: "BJJ Notes", icon: BookOpen },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "prs", label: "Records", icon: Trophy },
];

function MainApp({ userId, onSignOut }) {
  const [clients, setClients] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [client, setClientState] = useState(null);
  const [tab, setTab] = useState("today");
  const [showClients, setShowClients] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showCoachDashboard, setShowCoachDashboard] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [logging, setLogging] = useState(null);
  const [showMobility, setShowMobility] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    (async () => {
      const list = await getClientList(userId);
      const settings = await getSettings(userId);
      setTheme(settings.theme || "dark");
      setClients(list || []);
      if (list && list.length) setActiveId(list[0].id);
      setLoaded(true);
    })();
  }, [userId]);

  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const c = await getClient(userId, activeId);
      if (c) {
        if (!c.bodyweightLog) c.bodyweightLog = [];
        if (!c.mobilityLogs) c.mobilityLogs = [];
        if (!c.prLog) c.prLog = [];
        if (!c.blockNumber) c.blockNumber = 1;
        if (!c.roster) c.roster = { code: "", sharing: false };
        if (c.hasSeenTutorial === undefined) c.hasSeenTutorial = false;
        if (!c.weeklySchedule) c.weeklySchedule = defaultWeeklySchedule();
        if (!c.beltLevel) c.beltLevel = "White";
        if (!c.bjjNotes) c.bjjNotes = [];
        if (!c.program.mobility) c.program.mobility = defaultMobility();

        // Self-heal: older versions of this app briefly saved rotating Max Effort
        // exercises with a blank name, which then got frozen into this client's
        // stored data forever. Repair any of those on load, and any pool entries
        // that are missing a name, using the current default pools as reference.
        let healed = false;
        if (c.program?.conjugate) {
          ["meLowerPool", "meUpperPool", "wristPool", "bicepAltPool", "conditioningIntervalPool"].forEach((key) => {
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
    })();
  }, [activeId, userId]);

  const persistClient = useCallback(async (updated) => { setClientState(updated); await setClient(userId, updated.id, updated); }, [userId]);

  useEffect(() => { if (client) pushRosterSnapshot(client); }, [client]);
  useEffect(() => { if (client && !client.hasSeenTutorial) setShowTutorial(true); }, [client?.id]); // eslint-disable-line
  const changeTheme = async (t) => { setTheme(t); await setSettings(userId, { theme: t }); };

  const completeOnboarding = async (profile) => {
    const id = uid();
    const c = buildClient({ id, ...profile, useTemplate: true });
    await setClient(userId, id, c);
    const list = [{ id, name: c.name }];
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
  const refreshProgramTemplate = async () => {
    if (!client) return;
    const updated = { ...client, program: buildProgramVariant(client.program?.variant === "A" ? "A" : "B") };
    await persistClient(updated);
  };

  if (!loaded) return <div className="app-shell" data-theme={theme}><div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>Loading…</div><GlobalStyle /></div>;
  if (clients.length === 0) return <div className="app-shell" data-theme={theme}><OnboardingScreen onSubmit={completeOnboarding} /><GlobalStyle /></div>;
  if (!client) return <div className="app-shell" data-theme={theme}><div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>Loading…</div><GlobalStyle /></div>;

  return (
    <div className="app-shell" data-theme={theme} style={{ "--belt-glow": BELT_COLORS[client.beltLevel] || BELT_COLORS.White }}>
      <TopBar client={client} onOpenClients={() => setShowClients(true)} onOpenSettings={() => setShowSettings(true)} onOpenCalculator={() => setShowCalculator(true)} onOpenDashboard={() => setShowDashboard(true)} onOpenHelp={() => setShowTutorial(true)} />
      <div className="scroll-area">
        {tab === "today" && (
          <TodayTab client={client} onPersist={persistClient}
            onStartLog={(phaseId, dayId) => setLogging({ phaseId, dayId })}
            onStartMobility={() => setShowMobility(true)} />
        )}
        {tab === "schedule" && <ScheduleTab client={client} />}
        {tab === "program" && <ProgramTab client={client} onPersist={persistClient} />}
        {tab === "history" && <HistoryTab client={client} onPersist={persistClient} />}
        {tab === "bjj" && <BJJNotesTab client={client} onPersist={persistClient} />}
        {tab === "progress" && <ProgressTab client={client} />}
        {tab === "prs" && <PRsTab client={client} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
      {showClients && (
        <ClientsModal clients={clients} activeId={activeId}
          onSelect={(id) => { setActiveId(id); setShowClients(false); }}
          onAdd={addClient} onDelete={deleteClient} onClose={() => setShowClients(false)} />
      )}
      {showSettings && <SettingsModal client={client} onPersist={persistClient} theme={theme} onChangeTheme={changeTheme} onClose={() => setShowSettings(false)} onResetApp={resetAppData} onRefreshProgram={refreshProgramTemplate} onOpenCoachDashboard={() => { setShowSettings(false); setShowCoachDashboard(true); }} onSignOut={onSignOut} />}
      {showCoachDashboard && <CoachDashboard onClose={() => setShowCoachDashboard(false)} />}
      {showTutorial && (
        <TutorialModal onClose={async () => {
          setShowTutorial(false);
          if (!client.hasSeenTutorial) await persistClient({ ...client, hasSeenTutorial: true });
        }} />
      )}
      {showCalculator && <OneRepMaxCalculator onClose={() => setShowCalculator(false)} />}
      {showDashboard && <ClientDashboard client={client} onClose={() => setShowDashboard(false)} />}
      {logging && (
        <DaySessionScreen client={client} phaseId={logging.phaseId} dayId={logging.dayId} onClose={() => setLogging(null)}
          onStartMobility={() => setShowMobility(true)}
          onUpdateProgram={(newProgram) => persistClient({ ...client, program: newProgram })}
          onSave={async (session) => {
            const updated = { ...client, logs: [...client.logs, session], sessionsCompleted: (client.sessionsCompleted || 0) + 1 };
            await persistClient(updated);
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
        <MobilitySession client={client} onClose={() => setShowMobility(false)}
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

function GrapplingMark({ opacity = 0.14 }) {
  return (
    <svg viewBox="0 0 300 220" className="sisyphus-mark" style={{ opacity }} preserveAspectRatio="xMidYMid slice">
      {/* ground shadow */}
      <ellipse cx="135" cy="206" rx="75" ry="9" fill="currentColor" opacity="0.25" />

      {/* ===== TORI — the thrower, bent forward driving the throw ===== */}
      <g fill="#2f6fb3">
        {/* both legs, fused at a wide driving base */}
        <path d="M100,145 L145,140 L158,176 L140,206 L120,206 L127,178 L109,178 L96,206 L76,206 L87,176 Z" />
        {/* torso and head, rounded back, leaning into the throw */}
        <path d="M105,142 L140,138 Q175,118 178,90 Q179,74 165,67 Q149,76 142,95 Q134,116 117,133 Q108,139 105,142 Z" />
        <circle cx="168" cy="71" r="15" />
        {/* gripping arm, reaching up to control uke */}
        <path d="M155,94 L181,77 L206,61 L193,82 L166,100 Z" />
      </g>

      {/* ===== UKE — being thrown, arched overhead with legs kicked up ===== */}
      <g fill="#e7e7ea">
        {/* arched body, draped over tori's back and hip */}
        <path d="M130,156 Q151,130 176,109 Q206,87 226,59 Q233,49 226,39 Q211,41 196,57 Q171,81 146,104 Q128,121 122,144 Q124,151 130,156 Z" />
        {/* head, low near tori's hip as the body rotates over */}
        <circle cx="127" cy="159" r="13" />
        {/* legs, kicked high into the air */}
        <path d="M219,54 L246,31 L269,11 L256,31 L229,54 Z" />
        <path d="M229,59 L256,37 L279,17 L267,37 L241,61 Z" />
        {/* arm, extended and controlled by tori's grip */}
        <path d="M176,104 L199,84 L219,67 L207,87 L186,107 Z" />
      </g>

    </svg>
  );
}

function OnboardingScreen({ onSubmit }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [weight, setWeight] = useState("");
  const [heightFeet, setHeightFeet] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [beltLevel, setBeltLevel] = useState("White");
  const [programVariant, setProgramVariant] = useState("B");
  const [logoImageOk, setLogoImageOk] = useState(true);
  const canSubmit = firstName.trim() && lastName.trim() && weight;

  return (
    <div className="pad" style={{ paddingTop: 40, maxWidth: 420, margin: "0 auto" }}>
      <div className="logo-block">
        {logoImageOk ? (
          <img src="/kc-logo.png" alt="" className="logo-image" onError={() => setLogoImageOk(false)} />
        ) : (
          <GrapplingMark opacity={0.14} />
        )}
        <div className="brand-title" style={{ position: "relative" }}>KC Grappling Protocol</div>
      </div>
      <div className="program-title" style={{ fontSize: 20, marginBottom: 4 }}>Welcome</div>
      <p className="muted" style={{ marginBottom: 20 }}>Set up your profile to get started with your training system.</p>
      <LabeledInput label="First name" value={firstName} onChange={setFirstName} />
      <LabeledInput label="Last name" value={lastName} onChange={setLastName} />
      <LabeledInput label="Bodyweight (pounds)" type="number" step="0.1" inputMode="decimal" value={weight} onChange={setWeight} />
      <div className="edit-ex-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <LabeledInput label="Height — feet" type="number" value={heightFeet} onChange={setHeightFeet} />
        <LabeledInput label="Height — inches" type="number" value={heightInches} onChange={setHeightInches} />
      </div>
      <label className="labeled-input">
        <span>Brazilian Jiu-Jitsu belt level</span>
        <select className="select-input" value={beltLevel} onChange={(e) => setBeltLevel(e.target.value)}>
          {BELT_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <div className="log-exercise-name" style={{ marginTop: 18, marginBottom: 4 }}>Choose Your Program</div>
      <div className={`program-choice-card ${programVariant === "A" ? "active" : ""}`} onClick={() => setProgramVariant("A")}>
        <div className="program-choice-title">Program A — Condensed Conjugate</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Day 1: Max Effort Lower + Dynamic Effort Upper. Day 2: Max Effort Upper + Dynamic Effort Lower. Day 3: Full Body Dynamic Effort. Both qualities trained every session — best if you want maximum coverage in three days a week.</p>
      </div>
      <div className={`program-choice-card ${programVariant === "B" ? "active" : ""}`} onClick={() => setProgramVariant("B")}>
        <div className="program-choice-title">Program B — Traditional Split</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Day 1: Max Effort Lower. Day 2: Max Effort Upper. Day 3: Full Body Dynamic Effort. One quality per session — more recovery room around each lift, best if your BJJ volume is already high.</p>
      </div>
      <button className="btn-primary wide" style={{ marginTop: 10 }} disabled={!canSubmit}
        onClick={() => onSubmit({ firstName: firstName.trim(), lastName: lastName.trim(), weight: Number(weight) || 0, heightFeet: Number(heightFeet) || 0, heightInches: Number(heightInches) || 0, beltLevel, programVariant })}>
        Get started
      </button>
    </div>
  );
}

function TopBar({ client, onOpenClients, onOpenSettings, onOpenCalculator, onOpenDashboard, onOpenHelp }) {
  return (
    <div className="topbar">
      <div>
        <div className="topbar-brand">KC Grappling Protocol</div>
        <button className="topbar-name-sub topbar-name-btn" onClick={onOpenDashboard}>{client.name} — view progress</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="icon-btn" onClick={onOpenHelp} aria-label="Help and glossary"><HelpCircle size={20} /></button>
        <button className="icon-btn" onClick={onOpenCalculator} aria-label="One-Rep Max and Rate of Perceived Exertion calculator"><Calculator size={20} /></button>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="Settings"><SettingsIcon size={20} /></button>
        <button className="icon-btn" onClick={onOpenClients} aria-label="Switch client"><Users size={20} /></button>
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
  { title: "Deload Week", body: "Every fourth week, the program automatically gets lighter on purpose — lower volume, no true max attempts. It's built-in recovery, not a step backward, and it happens whether you ask for it or not." },
  { title: "Daily Readiness Check-In", body: "A few quick questions each day about sleep, soreness, and energy. Based on your answers, the app automatically adjusts that day's workout — trimming volume or dropping entire sections when you actually need it." },
];

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

  const logDates = Array.from(new Set(client.logs.map((l) => l.date))).sort().reverse();
  let streak = 0;
  if (logDates.length) {
    streak = 1;
    let cursor = new Date(logDates[0] + "T00:00:00");
    for (let i = 1; i < logDates.length; i++) {
      const prevDay = new Date(cursor);
      prevDay.setDate(prevDay.getDate() - 1);
      const prevDayStr = prevDay.toISOString().slice(0, 10);
      if (logDates[i] === prevDayStr) { streak++; cursor = prevDay; } else break;
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
        <DashStat label="Training Streak" value={`${streak} day${streak === 1 ? "" : "s"}`} />
        <DashStat label="Last Workout" value={lastLog ? `${fmtDate(lastLog.date)} — Day ${lastLog.dayLabel}` : "None yet"} wide />
      </div>
      <div className="card">
        <div className="log-exercise-name" style={{ marginBottom: 8 }}>Overall Progress</div>
        <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${completionPct}%` }} /></div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>{client.sessionsCompleted || 0} of {totalSessions} sessions completed this block.</p>
      </div>
      <div className="card">
        <div className="log-exercise-name" style={{ marginBottom: 8 }}>Personal Records</div>
        {recentPRs.length === 0 ? <p className="muted">No Personal Records flagged yet — check the Personal Record box next to a set on the workout screen to start tracking them here.</p> : recentPRs.map((p) => (
          <div key={p.id} className="pr-history-row"><span>{p.exerciseName}</span><span>{p.weight} pounds × {p.reps} reps — {fmtDate(p.date)}</span></div>
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
      <LabeledInput label="Weight lifted (pounds)" type="number" step="0.1" inputMode="decimal" value={weight} onChange={setWeight} />
      <LabeledInput label="Reps performed" type="number" value={reps} onChange={setReps} />
      <LabeledInput label="Reps in reserve (how many more reps you could have done)" type="number" value={rir} onChange={setRir} />

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
          <div className="log-exercise-name" style={{ marginBottom: 8 }}>Suggested Training Weights</div>
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

function SettingsModal({ client, onPersist, theme, onChangeTheme, onClose, onResetApp, onRefreshProgram, onOpenCoachDashboard, onSignOut }) {
  const [confirmingAppReset, setConfirmingAppReset] = useState(false);
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [rosterCode, setRosterCode] = useState(client?.roster?.code || "");
  const [sharing, setSharing] = useState(!!client?.roster?.sharing);
  const [savedSharing, setSavedSharing] = useState(false);
  const [schedule, setSchedule] = useState(client?.weeklySchedule || defaultWeeklySchedule());
  const [savedSchedule, setSavedSchedule] = useState(false);
  const [belt, setBelt] = useState(client?.beltLevel || "White");
  const [savedBelt, setSavedBelt] = useState(false);

  const saveSharing = async () => {
    const updated = { ...client, roster: { code: rosterCode.trim(), sharing: sharing && !!rosterCode.trim() } };
    if (!updated.roster.sharing) await removeRosterSnapshot(client);
    await onPersist(updated);
    setSavedSharing(true);
    setTimeout(() => setSavedSharing(false), 2000);
  };
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

  return (
    <ModalShell onClose={onClose} title="Settings">
      <div className="log-exercise-name" style={{ marginBottom: 6 }}>Brazilian Jiu-Jitsu Belt Level</div>
      <select className="select-input" style={{ width: "100%", marginBottom: 10 }} value={belt} onChange={(e) => setBelt(e.target.value)}>
        {BELT_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <button className="btn-primary wide" onClick={saveBelt}>{savedBelt ? "Saved" : "Save Belt Level"}</button>
      <div className="log-exercise-name" style={{ marginBottom: 6 }}>Share Progress With Your Coach</div>
      <p className="muted" style={{ marginBottom: 10 }}>
        Ask your coach for their roster code and enter it below. Once you turn sharing on, a summary of your progress — current week, workout count, last session, and recent Personal Records — syncs automatically so your coach can see it on their end. Full set-by-set workout details are never shared, only this summary.
      </p>
      <LabeledInput label="Coach roster code" value={rosterCode} onChange={setRosterCode} />
      <label className="bjj-toggle">
        <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
        <span>Share my progress with this code</span>
      </label>
      <button className="btn-primary wide" onClick={saveSharing}>{savedSharing ? "Saved" : "Save Sharing Settings"}</button>
      {client?.roster?.sharing && client?.roster?.code && (
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Currently sharing with code "{client.roster.code}".</p>
      )}

      <div className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>My Weekly Training Schedule</div>
      <p className="muted" style={{ marginBottom: 10 }}>Enter your regular Brazilian Jiu-Jitsu and Strength & Conditioning times for each day. This shows up on the History tab so you always know what's coming this week.</p>
      {[["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]].map(([key, label]) => (
        <label key={key} className="labeled-input">
          <span>{label}</span>
          <textarea className="notes-box" rows={2} style={{ fontSize: 13 }} value={schedule[key] || ""} onChange={(e) => setSchedule((prev) => ({ ...prev, [key]: e.target.value }))} placeholder="For example: 6:00–7:00 AM Brazilian Jiu-Jitsu" />
        </label>
      ))}
      <button className="btn-primary wide" onClick={saveSchedule}>{savedSchedule ? "Saved" : "Save Schedule"}</button>

      <div className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Coach Dashboard</div>
      <p className="muted" style={{ marginBottom: 10 }}>If you're the coach, open this to see every athlete who has shared their progress with one of your roster codes.</p>
      <button className="btn-ghost wide" onClick={onOpenCoachDashboard}>Open Coach Dashboard</button>

      <div className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Update Your Program</div>
      <p className="muted" style={{ marginBottom: 10 }}>
        Your athlete's program is saved the moment their profile is created, so improvements made to the program afterward don't automatically reach an existing profile. Use this any time to pull your saved profile up to the newest version of the program — every workout, check-in, and Personal Record you've logged stays exactly as it is. This only replaces the program itself, so any exercises, warm-up items, or video links you've manually edited in the Program tab will be overwritten back to the current default.
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

      <div className="log-exercise-name" style={{ marginTop: 24, marginBottom: 10 }}>Appearance</div>
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

      <div className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Start Over From the Welcome Screen</div>
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

      {onSignOut && (
        <>
          <div className="log-exercise-name" style={{ marginTop: 24, marginBottom: 6 }}>Account</div>
          <button className="btn-ghost wide" onClick={onSignOut}><LogOut size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Sign Out</button>
        </>
      )}
    </ModalShell>
  );
}

/* ============================== COACH DASHBOARD ============================== */

function CoachDashboard({ onClose }) {
  const [code, setCode] = useState("");
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!code.trim()) return;
    setLoading(true);
    const r = await fetchRoster(code);
    setRoster(r);
    setLoading(false);
  };

  return (
    <ModalShell onClose={onClose} title="Coach Dashboard">
      <p className="muted" style={{ marginBottom: 12 }}>Enter a roster code to see every athlete who has turned on sharing with it. This only shows the summary they've opted to share — not their full workout logs.</p>
      <div className="bw-row">
        <input className="bw-input" style={{ textAlign: "left", flex: 1 }} placeholder="Roster code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn-primary" style={{ padding: "10px 16px" }} onClick={load} disabled={!code.trim()}>Load</button>
      </div>
      {loading && <p className="muted" style={{ marginTop: 12 }}>Loading roster…</p>}
      {roster && roster.length === 0 && <div style={{ marginTop: 12 }}><EmptyState text="No athletes have shared their progress with this code yet." /></div>}
      {roster && roster.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {roster.map((a) => (
            <div key={a.clientId} className="card">
              <div className="card-title" style={{ marginBottom: 2 }}>{a.name}</div>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{a.programName}</div>
              <div className="dash-grid">
                <DashStat label="Week" value={`${a.currentWeek} of ${a.totalWeeks}`} />
                <DashStat label="Block" value={`${a.blockNumber}`} />
                <DashStat label="Total Workouts" value={`${a.totalWorkouts}`} />
                <DashStat label="Last Workout" value={a.lastWorkoutDate ? `${fmtDate(a.lastWorkoutDate)} — Day ${a.lastWorkoutDay}` : "None yet"} wide />
              </div>
              {a.readinessColor && (
                <span className="pill" style={{ background: a.readinessColor === "GREEN" ? "var(--green)" : a.readinessColor === "YELLOW" ? "var(--amber)" : "var(--accent)", display: "inline-block", marginTop: 10 }}>
                  Today: {a.readinessColor}
                </span>
              )}
              {a.recentPRs?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="section-subheading">Recent Personal Records</div>
                  {a.recentPRs.map((p) => (
                    <div key={p.id} className="pr-history-row"><span>{p.exerciseName}</span><span>{p.weight} pounds × {p.reps} — {fmtDate(p.date)}</span></div>
                  ))}
                </div>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>Last synced {new Date(a.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
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

  if (actualComplete) {
    return (
      <div className="pad">
        <Card title="Twelve-Week Block Complete">
          <p className="muted" style={{ marginBottom: 14 }}>
            You've finished Block {client.blockNumber || 1} of "{client.program.name}". Every workout, check-in, and Personal Record you logged is saved permanently — review Progress and Records, then start the next block whenever you're ready. Nothing gets deleted.
          </p>
          <button className="btn-primary wide" onClick={async () => { await onPersist({ ...client, sessionsCompleted: 0, blockNumber: (client.blockNumber || 1) + 1 }); }}>
            Start New Twelve-Week Block
          </button>
        </Card>
      </div>
    );
  }

  const pos = positionAtIndex(client.program, viewIndex);
  const isCurrent = viewIndex === (client.sessionsCompleted || 0);
  const mainLift = primaryLiftName(pos.day, pos.weekNumber, client.program, pos.phase);
  const resolvedRaw = useMemo(() => resolveDaySections(pos.day, pos.weekNumber, client.program, pos.phase), [pos.day, pos.weekNumber, client.program, pos.phase]);
  const adjustment = useMemo(() => (isCurrent ? adjustSectionsForReadiness(resolvedRaw, readinessToday) : { sections: resolvedRaw, adjustedNote: null }), [resolvedRaw, readinessToday, isCurrent]);

  return (
    <div className="pad">
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

      <Card title="Mental Game" subtitle="A new one every day">
        <div className="log-exercise-name" style={{ fontSize: 14, marginBottom: 6 }}>{todaysMentalTip.title}</div>
        <p className="muted" style={{ marginBottom: 10 }}>{todaysMentalTip.body}</p>
        <button className="btn-ghost wide" onClick={() => setShowMentalLibrary(true)}>Browse All Mental Game Entries</button>
      </Card>

      <Card title="Readiness & Bodyweight" right={readinessToday ? <span className="pill" style={{ background: READINESS_COPY[readinessToday.color].color }}>{readinessToday.color}</span> : null}>
        {readinessToday ? (
          <div><p className="muted" style={{ marginBottom: 10 }}>{READINESS_COPY[readinessToday.color].detail}</p><button className="btn-ghost" onClick={() => setShowReadiness(true)}>Update today's check-in</button></div>
        ) : (
          <div><p className="muted" style={{ marginBottom: 10 }}>Quick check-in before today's session — sleep, soreness, energy, bodyweight, and whether grappling has been rough lately. The workout adjusts itself based on your answers.</p><button className="btn-primary" onClick={() => setShowReadiness(true)}>Check in</button></div>
        )}
      </Card>

      {recentPR && (
        <Card title="Most Recent Personal Record"><div className="pr-line"><Trophy size={16} color="var(--accent)" /><span><b>{recentPR.name}</b> — {recentPR.weight} pounds × {recentPR.reps} reps ({fmtDate(recentPR.date)})</span></div></Card>
      )}

      <Card
        title={
          <div className="day-nav-row">
            <button className="day-nav-btn" disabled={viewIndex <= 0} onClick={() => setViewIndex((i) => Math.max(0, i - 1))}><ChevronLeft size={16} /></button>
            <span>Day {pos.day.label} — {mainLift}</span>
            <button className="day-nav-btn" disabled={viewIndex >= totalSessions - 1} onClick={() => setViewIndex((i) => Math.min(totalSessions - 1, i + 1))}><ChevronRight size={16} /></button>
            <button className="day-nav-btn" onClick={() => setShowJumpPicker((s) => !s)} title="Preview or skip ahead to a different day"><CalendarDays size={14} /></button>
          </div>
        }
        subtitle={pos.day.name}
      >
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
        {!isCurrent && (
          <div className="adjust-box">
            Previewing Week {pos.weekNumber}, Day {pos.day.label} — this is not today's actual session.
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="link-btn" onClick={() => setViewIndex(client.sessionsCompleted || 0)}>Jump back to today</button>
              <button className="link-btn" onClick={async () => { await onPersist({ ...client, sessionsCompleted: viewIndex }); setShowJumpPicker(false); }}>Skip ahead — make this my current day</button>
            </div>
          </div>
        )}
        {pos.day.intent && <div className="intent-box">{pos.day.intent}</div>}
        {adjustment.adjustedNote && <div className="adjust-box">{adjustment.adjustedNote}</div>}
        <button className="preview-toggle" onClick={() => setShowPreview((s) => !s)}>
          <span>Preview today's workout</span>
          <ChevronRight size={16} className={showPreview ? "chev-open" : ""} />
        </button>
        {showPreview && (
          <div className="section-preview-list">
            <div className="section-preview-row"><span>Warm-Up</span><span className="muted">{(client.program.warmup || []).reduce((n, b) => n + b.items.length, 0)} items</span></div>
            {adjustment.sections.map((sec) => (
              <div key={sec.id} className="section-preview-row"><span>{sectionHeadline(sec)}{sec.skipped ? " (skipped today)" : ""}</span><span className="muted">{sec.exercises.length} {sec.exercises.length === 1 ? "item" : "items"}</span></div>
            ))}
            <div className="section-preview-row"><span>Cool-Down Mobility</span><span className="muted">{mobilityMinutes} minutes</span></div>
          </div>
        )}
        {isCurrent ? (
          <button className="btn-primary wide" style={{ marginTop: 14 }} onClick={() => onStartLog(pos.phase.id, pos.day.id)}>Start workout</button>
        ) : (
          <div className="muted" style={{ marginTop: 14, fontSize: 12.5, fontStyle: "italic" }}>Preview only. Return to today's session to log a workout.</div>
        )}
      </Card>

      <Card title="Recovery & Mobility" subtitle={`${mobilityMinutes} minutes — breathwork plus full-body stretch flow`}>
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
            const updated = { ...client, readiness: { ...client.readiness, [today]: { ...entry, color, date: today } }, bodyweightLog: weight ? upsertBodyweight(client.bodyweightLog, today, Number(weight)) : client.bodyweightLog };
            await onPersist(updated);
            setShowReadiness(false);
          }} />
      )}
      {showAccomplishments && <AccomplishmentsPage client={client} onClose={() => setShowAccomplishments(false)} />}
      {showMentalLibrary && (
        <ModalShell onClose={() => setShowMentalLibrary(false)} title="Mental Game Library">
          <p className="muted" style={{ marginBottom: 14 }}>Every entry in the rotation — today's is highlighted.</p>
          {MENTAL_COACHING_LIBRARY.map((tip) => (
            <div key={tip.title} className="card" style={{ marginBottom: 10, borderColor: tip.title === todaysMentalTip.title ? "var(--accent)" : "var(--border)" }}>
              <div className="log-exercise-name" style={{ fontSize: 14, marginBottom: 6 }}>{tip.title}</div>
              <p className="muted" style={{ marginBottom: 0 }}>{tip.body}</p>
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
  return (
    <ModalShell onClose={onClose} title="Lifting Milestones">
      <div className="card" style={{ textAlign: "center", padding: 24 }}>
        <div className="finish-stat-value" style={{ fontSize: 26 }}>{formatWeight(total)}</div>
        <div className="muted">Total weight lifted since you started</div>
      </div>
      {volumeSeries.length > 0 && (
        <Card title="Volume Over Time" subtitle="Total weight lifted, by week">
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeSeries}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
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
              <div className="muted" style={{ fontSize: 11.5 }}>{formatWeight(m.weight)}{achieved ? ` — reached ${fmtDate(achievedDates[idx])}` : ""}</div>
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
  const [v, setV] = useState(existing || { sleep: 3, energy: 3, soreness: 3, bjjHard: false });
  const [weight, setWeight] = useState(existingWeight || "");
  const fields = [
    { key: "sleep", label: "Sleep quality", max: 5 },
    { key: "energy", label: "Energy", max: 5 },
    { key: "soreness", label: "Muscle soreness", max: 5 },
  ];
  return (
    <ModalShell onClose={onClose} title="Daily Check-In">
      <div className="bw-row"><Scale size={16} color="var(--accent)" /><span>Bodyweight (pounds)</span><input type="number" step="0.1" inputMode="decimal" className="bw-input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="for example, 178.5" /></div>
      {fields.map((f) => <SliderRow key={f.key} label={f.label} value={v[f.key]} max={f.max} onChange={(n) => setV({ ...v, [f.key]: n })} />)}
      <label className="bjj-toggle">
        <input type="checkbox" checked={!!v.bjjHard} onChange={(e) => setV({ ...v, bjjHard: e.target.checked })} />
        <span>Hard Brazilian Jiu-Jitsu training recently?</span>
      </label>
      <button className="btn-primary wide" style={{ marginTop: 16 }} onClick={() => onSave({ ...v, weight })}>Save check-in</button>
    </ModalShell>
  );
}
function SliderRow({ label, value, max, onChange }) {
  return <div className="slider-row"><div className="slider-label"><span>{label}</span><span className="slider-value">{value}</span></div><input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}

/* ============================== SHARED SESSION UI ============================== */

function SectionHeader({ title, subtitle, complete, onToggleComplete, expanded, onToggleExpand }) {
  return (
    <button className="section-header" onClick={onToggleExpand}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`section-check ${complete ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); onToggleComplete(); }}>{complete && <Check size={13} />}</span>
        <div style={{ textAlign: "left" }}><div className="log-exercise-name">{title}</div>{subtitle && <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>}</div>
      </div>
      <ChevronRight size={16} className={expanded ? "chev-open" : ""} />
    </button>
  );
}
function VideoLinkBlock({ url, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url || "");
  if (editing) {
    return (
      <div className="video-edit-row" onClick={(e) => e.stopPropagation()}>
        <input className="edit-input" style={{ flex: 1 }} placeholder="Paste a video link" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn-ghost" style={{ marginTop: 0 }} onClick={() => { onSave(draft.trim()); setEditing(false); }}>Save</button>
        <button className="icon-btn small" onClick={() => setEditing(false)}><X size={13} /></button>
      </div>
    );
  }
  if (url) {
    return (
      <div className="ex-links-row" onClick={(e) => e.stopPropagation()}>
        <a className="video-link" href={url} target="_blank" rel="noopener noreferrer">Watch video</a>
        <button className="link-x-btn" onClick={onDelete} title="Remove this link"><X size={12} /></button>
        <button className="link-edit-btn" onClick={() => { setDraft(url); setEditing(true); }}>Edit</button>
      </div>
    );
  }
  return <button className="add-link-btn" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>+ Add a video link</button>;
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

/* ============================== FULL-DAY SESSION SCREEN ============================== */

function DaySessionScreen({ client, phaseId, dayId, onClose, onSave, onStartMobility, onUpdateProgram, onRestartProgram, onRecordPR, onRemovePR }) {
  const phase = client.program.phases.find((p) => p.id === phaseId);
  const day = phase.days.find((d) => d.id === dayId);
  const totalSessions = totalSessionsIn(client.program);
  const perWeek = client.program.sessionsPerWeek || 3;
  const weekNumber = Math.min(Math.ceil(((client.sessionsCompleted || 0) + 1) / perWeek), Math.max(...client.program.phases.map((p) => p.weekEnd)));
  const readinessToday = client.readiness[todayStr()];

  const rawResolvedSections = useMemo(() => resolveDaySections(day, weekNumber, client.program, phase), [day, weekNumber, client.program, phase]);
  const { sections: resolvedSections, adjustedNote } = useMemo(() => adjustSectionsForReadiness(rawResolvedSections, readinessToday), [rawResolvedSections, readinessToday]);
  const mainLift = primaryLiftName(day, weekNumber, client.program, phase);

  const buildFreshEntries = useCallback(() => {
    const map = {};
    resolvedSections.forEach((sec) => {
      map[sec.id] = sec.exercises.map((e) => ({ exerciseId: e.id, name: e.name, target: e, sets: Array.from({ length: e.sets || 3 }).map((_, setIdx) => ({ weight: "", reps: defaultRepsFor(e, setIdx), rir: defaultRirFor(e, setIdx), done: false })) }));
    });
    return map;
  }, [resolvedSections]);

  const [warmupChecked, setWarmupChecked] = useState({});
  const [expanded, setExpanded] = useState({ warmup: true });
  const [complete, setComplete] = useState({});
  const [manualPRs, setManualPRs] = useState({});
  const [entriesBySection, setEntriesBySection] = useState(buildFreshEntries);
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState(7);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [prHint, setPrHint] = useState(null);
  const [showFirstSetHelp, setShowFirstSetHelp] = useState(client.logs.length === 0);
  const [editingName, setEditingName] = useState(null);
  const [nameDraft, setNameDraft] = useState("");

  const resetAllInputs = () => {
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
  const markDone = (sectionId, exIdx, setIdx) => {
    const currentlyDone = entriesBySection[sectionId][exIdx].sets[setIdx].done;
    updateSet(sectionId, exIdx, setIdx, "done", !currentlyDone);
  };
  const substituteExercise = (sectionId, exIdx, newName) => {
    setEntriesBySection((prev) => {
      const list = [...prev[sectionId]];
      const poolKey = list[exIdx].target.rotatingPool || (day.label === "1" ? "meLowerPool" : day.label === "2" ? "meUpperPool" : null);
      const poolArr = client.program.conjugate?.[poolKey] || [];
      const chosen = poolArr.find((p) => p.name === newName);
      if (!chosen) return prev;
      list[exIdx] = { ...list[exIdx], name: chosen.name, target: { ...list[exIdx].target, name: chosen.name, rotatingPool: poolKey, purpose: chosen.notes, videoUrl: chosen.videoUrl || "" } };
      return { ...prev, [sectionId]: list };
    });
  };
  const togglePRFlag = async (sectionId, exIdx, setIdx) => {
    const en = entriesBySection[sectionId][exIdx];
    const s = en.sets[setIdx];
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    if (!w || !r) return;
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
  const setVideoForEntry = (sectionId, exIdx, url) => {
    const en = entriesBySection[sectionId][exIdx];
    setEntriesBySection((prev) => {
      const list = [...prev[sectionId]];
      list[exIdx] = { ...list[exIdx], target: { ...list[exIdx].target, videoUrl: url } };
      return { ...prev, [sectionId]: list };
    });
    const newProgram = JSON.parse(JSON.stringify(client.program));
    if (en.target.rotatingPool) {
      const pool = newProgram.conjugate[en.target.rotatingPool];
      const item = pool.find((p) => p.name === en.name);
      if (item) item.videoUrl = url;
    } else {
      for (const ph of newProgram.phases) for (const d of ph.days) for (const s of d.sections) {
        const found = s.exercises.find((x) => x.id === en.exerciseId);
        if (found) found.videoUrl = url;
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

  const finishWorkout = () => {
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
      id: uid(), date: todayStr(), phaseId, dayId, dayLabel: day.label, weekNumber,
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
    setSummary({ totalVolume: session.totalVolume, prNames: Array.from(prNameSet), avgRPE: rpe, isFinalSession, newMilestones });
    setFinished(true);
    onSave(session);
  };

  if (finished && summary) {
    return (
      <ModalShell onClose={onClose} title="Workout complete" fullscreen>
        <div className="finish-summary">
          <div className="finish-stat"><div className="finish-stat-value">{summary.totalVolume.toLocaleString()} pounds</div><div className="finish-stat-label">Total volume</div></div>
          <div className="finish-stat"><div className="finish-stat-value">{summary.avgRPE}</div><div className="finish-stat-label">Session Rate of Perceived Exertion</div></div>
          {summary.newMilestones.length > 0 && (
            <Card title="New Lifting Milestone!">
              {summary.newMilestones.map((m) => (
                <div key={m.name} className="pr-line" style={{ fontSize: 14.5 }}>{m.emoji} Congratulations, you've lifted the weight of {m.name} since you started!</div>
              ))}
            </Card>
          )}
          {summary.prNames.length > 0 && <Card title="New Personal Records">{summary.prNames.map((n) => <div key={n} className="pr-line"><Trophy size={16} color="var(--accent)" /> {n}</div>)}</Card>}
          {summary.isFinalSession && (
            <Card title="Twelve-Week Program Complete">
              <p className="muted" style={{ marginBottom: 12 }}>That's the final session of this block. Every workout, check-in, and Personal Record you've logged stays saved permanently — restarting only resets your week and day back to the beginning.</p>
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
    <ModalShell onClose={onClose} title={`Day ${day.label} — ${mainLift}`}
      headerLeftExtra={<button className="icon-btn" onClick={() => setConfirmingReset(true)} title="Clear every input for this session"><RotateCcw size={16} /></button>}
      headerRight={<ProgressBadge percent={percent} />} fullscreen>
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
        <div className="rest-banner" style={{ background: "var(--amber)" }}>
          <Trophy size={16} />
          <span>Type the actual weight and reps you did for {prHint} into those two boxes first — the numbers you see now are just the recommended target, not something you've entered yet. Then tap the trophy again.</span>
          <button className="rest-dismiss" onClick={() => setPrHint(null)}><X size={14} /></button>
        </div>
      )}
      {showFirstSetHelp && (
        <div className="rest-banner" style={{ background: "var(--green)" }}>
          <Info size={16} />
          <span>New here? For each set below: type the actual weight you used in the Weight box, then how many reps you actually got in the Reps box. Reps in Reserve is already filled in for you — you don't need to touch it. Tap the checkmark once you've finished the set, and the trophy only if it's a genuine Personal Record.</span>
          <button className="rest-dismiss" onClick={() => setShowFirstSetHelp(false)}><X size={14} /></button>
        </div>
      )}
      {day.intent && <div className="intent-box" style={{ marginBottom: 12 }}>{day.intent}</div>}
      {adjustedNote && <div className="adjust-box" style={{ marginBottom: 12 }}>{adjustedNote}</div>}

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
                  <VideoLinkBlock url={item.videoUrl} onSave={(url) => setWarmupVideo(item.id, url)} onDelete={() => setWarmupVideo(item.id, "")} />
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
            return (
              <div className="section-ex-block" key={en.exerciseId}>
                <div className="log-exercise-target-wrap">
                  <div className="ex-name-row">
                    {editingName === en.exerciseId ? (
                      <div style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}>
                        <input className="rename-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
                        <button className="icon-btn-sm" onClick={() => { renameExercise(sec.id, exIdx, nameDraft); setEditingName(null); }}><Check size={16} /></button>
                        <button className="icon-btn-sm" onClick={() => setEditingName(null)}><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="log-exercise-name" style={{ fontSize: 14.5 }}>
                        {displayName}
                        {inferredPoolKey && <span className="recommended-tag">Recommended</span>}
                        <button className="icon-btn-sm" onClick={() => { setEditingName(en.exerciseId); setNameDraft(displayName); }} title="Rename this exercise"><Pencil size={13} /></button>
                      </div>
                    )}
                  </div>
                  <div className="log-exercise-target">Target: {en.target.sets} sets of {en.target.reps} {en.target.load ? `— ${en.target.load}` : ""} {en.target.rir !== undefined ? `— Rate of Perceived Exertion ${rpeFromRir(en.target.rir)}` : ""}</div>
                  {en.target.rest && <div className="rest-note-static">Rest: {en.target.rest}</div>}
                  {en.target.purpose && <div className="log-exercise-cue">{en.target.purpose}</div>}
                  {en.target.cues && <div className="log-exercise-cue" style={{ marginTop: 6 }}>{en.target.cues}</div>}
                  {lastWeek ? (
                    <div className="last-logged">Last week, heaviest: {lastWeek.weight} pounds × {lastWeek.reps} reps</div>
                  ) : (
                    last?.best && <div className="last-logged">Last logged: {last.best.weight} pounds × {last.best.reps} reps ({fmtDate(last.date)})</div>
                  )}
                  <VideoLinkBlock url={en.target.videoUrl} onSave={(url) => setVideoForEntry(sec.id, exIdx, url)} onDelete={() => setVideoForEntry(sec.id, exIdx, "")} />
                  {poolOptions.length > 0 && (
                    <div className="sub-row">
                      <div className="muted" style={{ fontSize: 12, width: "100%" }}>Bothered by this one? Tap another exercise to swap it in:</div>
                      <div className="sub-pill-row">
                        {poolOptions.map((p) => (
                          <button key={p.name} className={`sub-pill ${p.name === displayName ? "active" : ""}`} onClick={() => substituteExercise(sec.id, exIdx, p.name)}>{p.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="set-grid-header"><span>Set</span><span>Weight</span><span>Reps</span><span>Rate of Perceived Exertion (fixed)</span><span>Done</span><span>Personal Record</span></div>
                {en.target.perSetTargets && (
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>Each set has its own target below — the weight naturally climbs as reps come down, ending on a true top single.</div>
                )}
                {(() => {
                  const isMainLift = sec.type === "strength" || sec.type === "power";
                  const priorBestForPct = isMainLift ? lastAllTimeBest(client, displayName) : null;
                  return en.sets.map((s, setIdx) => {
                    const perSet = en.target.perSetTargets ? en.target.perSetTargets[setIdx] : null;
                    const effectivePct = perSet?.pct1rm ?? en.target.pct1rmFlat;
                    const setFlagged = !!manualPRs[`${en.exerciseId}:${setIdx}`];
                    const setHasData = (Number(s.weight) || 0) > 0;
                    const targetWeight = effectivePct && priorBestForPct ? Math.round((priorBestForPct.e1rm * effectivePct) / 100) : null;
                    return (
                      <React.Fragment key={setIdx}>
                        <div className="set-grid-row">
                          <span className="set-num">{setIdx + 1}{perSet?.note ? <span className="set-note">{perSet.note}</span> : null}</span>
                          <input type="number" step="0.1" inputMode="decimal" placeholder="pounds" value={s.weight} onChange={(e) => updateSet(sec.id, exIdx, setIdx, "weight", e.target.value)} />
                          <input type="text" inputMode="text" placeholder={perSet ? String(perSet.reps) : String(en.target.reps)} value={s.reps} onChange={(e) => updateSet(sec.id, exIdx, setIdx, "reps", e.target.value)} />
                          <input type="number" value={s.rir !== "" ? rpeFromRir(s.rir) : ""} disabled />
                          <button className={`set-done ${s.done ? "done" : ""}`} onClick={() => markDone(sec.id, exIdx, setIdx)}><Check size={16} /></button>
                          <button className={`set-pr ${setFlagged ? "flagged" : ""}`} onClick={() => { if (!setHasData) { setPrHint(`${en.name} — set ${setIdx + 1}`); setTimeout(() => setPrHint(null), 3000); return; } togglePRFlag(sec.id, exIdx, setIdx); }} title={setHasData ? "Mark this set as a Personal Record" : "Enter a weight first, then tap to mark a Personal Record"}><Trophy size={15} /></button>
                        </div>
                        {effectivePct && (
                          <div className="pct-1rm-row">
                            Set {setIdx + 1}: {effectivePct}% of your One-Rep Max
                            {targetWeight
                              ? ` — try about ${targetWeight} lb`
                              : setIdx === 0
                                ? " — once you log this exercise once, future sessions will suggest an exact weight"
                                : ""}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            );
          })}
        </div>
      ))}

      {/* Cool-Down Mobility */}
      <div className="log-exercise">
        <SectionHeader title="Cool-Down Mobility" subtitle="Breathwork plus full-body stretch flow" complete={!!complete.cooldown} onToggleComplete={() => toggleComplete("cooldown")} expanded={!!expanded.cooldown} onToggleExpand={() => toggleExpand("cooldown")} />
        {expanded.cooldown && (
          <div style={{ marginTop: 10 }}>
            <p className="muted" style={{ marginBottom: 10 }}>Best done right after training, or later if you're pressed for time — mark it complete once you've done it.</p>
            <button className="btn-ghost wide" onClick={onStartMobility}>Begin cool-down mobility</button>
          </div>
        )}
      </div>

      <div className="log-exercise"><div className="log-exercise-head"><div className="log-exercise-name">Session Rate of Perceived Exertion</div></div><SliderRow label="Overall difficulty" value={rpe} max={10} onChange={setRpe} /></div>
      <div className="log-exercise"><div className="log-exercise-head"><div className="log-exercise-name">Notes</div></div><textarea className="notes-box" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How it felt, anything to flag…" /></div>
      <button className="btn-primary wide" style={{ margin: "16px 0 40px" }} onClick={finishWorkout}>Finish & save day</button>
    </ModalShell>
  );
}
function lastAllTimeBest(client, exerciseName) {
  let best = null;
  for (const log of client.logs) { const en = log.exercises.find((e) => e.name === exerciseName); if (!en) continue; const b = bestSetOf(en.sets); if (b && (!best || b.e1rm > best.e1rm)) best = { ...b, date: log.date }; }
  return best;
}

/* ============================== MOBILITY / RECOVERY SESSION ============================== */

function MobilitySession({ client, onClose, onSave, onUpdateProgram }) {
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
            <div className="log-exercise-head"><div className="log-exercise-name">Session Notes</div></div>
            <textarea className="notes-box" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did mobility feel? Anything tight, anything to flag…" />
          </div>
          <button className="btn-primary wide" onClick={() => { onSave({ id: uid(), date: todayStr(), totalSeconds, notes }); onClose(); }}>Save & finish</button>
        </div>
      </ModalShell>
    );
  }

  const seg = segments[idx];
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <ModalShell onClose={onClose} title="Recovery & Mobility" fullscreen>
      <div className="muted" style={{ marginBottom: 8 }}>Segment {idx + 1} of {segments.length} — {Math.round(elapsedBefore / 60)} of {Math.round(totalSeconds / 60)} minutes elapsed</div>
      <div className="card" style={{ textAlign: "center" }}>
        <div className="mobility-type-tag">{seg.type === "breath" ? "Breathwork" : "Stretch"}</div>
        <div className="log-exercise-name" style={{ fontSize: 20, marginTop: 6, marginBottom: 6 }}>{seg.name}</div>
        {seg.detail && <p className="muted" style={{ marginBottom: 10 }}>{seg.detail}</p>}
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}><VideoLinkBlock url={seg.videoUrl} onSave={(url) => setSegmentVideo(seg.id, url)} onDelete={() => setSegmentVideo(seg.id, "")} /></div>
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
    <div className="pad">
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
                  const lift = primaryLiftName(day, week, client.program, phase);
                  const resolvedSections = resolveDaySections(day, week, client.program, phase);
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
                            <div className="section-subheading" style={{ margin: "4px 0 2px" }}>{SECTION_LABELS[sec.type] || sec.name}</div>
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
  const [openPhase, setOpenPhase] = useState(client.program.phases[0]?.id);
  const [editingDay, setEditingDay] = useState(null);
  const [editingWarmup, setEditingWarmup] = useState(false);
  const [editingPools, setEditingPools] = useState(false);
  const perWeek = client.program.sessionsPerWeek || 3;
  const currentWeekNumber = Math.max(1, Math.floor((client.sessionsCompleted || 0) / perWeek) + 1);

  return (
    <div className="pad">
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
                    <button className="icon-btn small" onClick={() => setEditingDay({ phaseId: phase.id, dayId: day.id })}><Pencil size={14} /></button>
                  </div>
                  {day.intent && <div className="day-intent-preview">{day.intent}</div>}
                  {day.sections.map((sec) => {
                    const firstEx = sec.exercises[0];
                    const showsRecommended = (sec.type === "strength" || sec.type === "power") && firstEx?.rotatingPool;
                    const recommendedName = showsRecommended ? resolveExercise(firstEx, currentWeekNumber, client.program, phase).name : null;
                    return (
                    <div key={sec.id} style={{ marginBottom: 8 }}>
                      <div className="section-subheading">{recommendedName || sec.name}{recommendedName ? <span className="recommended-tag" style={{ marginLeft: 8 }}>Recommended this week</span> : null}</div>
                      {sec.exercises.map((e) => (
                        <div key={e.id} className="program-ex-row">
                          <span>
                            {e.rotatingPool
                              ? `${e.rotatingPool === "meLowerPool" ? "Max Effort Lower" : "Max Effort Upper"} — rotates through: ${(client.program.conjugate?.[e.rotatingPool] || []).map((p) => p.name).join(", ")}`
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
            <button className="icon-btn small" onClick={() => removeSection(sIdx)}><Trash2 size={14} /></button>
          </div>
          {sec.exercises.map((e, exIdx) => (
            <div className="edit-ex-card" key={e.id}>
              <div className="edit-ex-row">
                <input className="edit-input wide-input" value={e.name} onChange={(ev) => updateExField(sIdx, exIdx, "name", ev.target.value)} placeholder="Exercise name" />
                <button className="icon-btn small" onClick={() => removeExercise(sIdx, exIdx)}><Trash2 size={14} /></button>
              </div>
              {e.rotatingPool && <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>This normally rotates through the Max Effort {e.rotatingPool === "meLowerPool" ? "Lower" : "Upper"} pool. Renaming it locks in this exercise instead of rotating.</div>}
              <div className="edit-ex-row four">
                <LabeledInput label="Sets" value={e.sets} onChange={(v) => updateExField(sIdx, exIdx, "sets", Number(v))} type="number" />
                <LabeledInput label="Reps" value={e.reps} onChange={(v) => updateExField(sIdx, exIdx, "reps", v)} />
                <LabeledInput label="Reps in reserve" value={e.rir} onChange={(v) => updateExField(sIdx, exIdx, "rir", Number(v))} type="number" />
                <LabeledInput label="Rest" value={e.rest} onChange={(v) => updateExField(sIdx, exIdx, "rest", v)} />
              </div>
              {e.deWave ? <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Load is automatically set from this phase's Dynamic Effort percentage ({phase.dePercent || "—"}).</div>
                : <LabeledInput label="Load" value={e.load} onChange={(v) => updateExField(sIdx, exIdx, "load", v)} />}
              <LabeledInput label="Purpose" value={e.purpose} onChange={(v) => updateExField(sIdx, exIdx, "purpose", v)} />
              {!e.rotatingPool && <LabeledInput label="Video link" value={e.videoUrl} onChange={(v) => updateExField(sIdx, exIdx, "videoUrl", v)} />}
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
            <button className="icon-btn small" onClick={() => removeBlock(bIdx)}><Trash2 size={14} /></button>
          </div>
          {block.items.map((item, iIdx) => (
            <div key={item.id} className="edit-ex-card">
              <div className="edit-ex-row">
                <input className="edit-input" style={{ flex: 1 }} value={item.name} onChange={(e) => updateItemField(bIdx, iIdx, "name", e.target.value)} placeholder="Item" />
                <button className="icon-btn small" onClick={() => removeItem(bIdx, iIdx)}><Trash2 size={14} /></button>
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
      <div className="log-exercise-name" style={{ marginBottom: 8 }}>{label}</div>
      {conj[poolKey].map((item, idx) => (
        <div key={idx} className="edit-ex-card">
          <div className="edit-ex-row">
            <input className="edit-input" style={{ flex: 1 }} value={item.name} onChange={(e) => updatePoolItem(poolKey, idx, "name", e.target.value)} placeholder="Exercise" />
            <button className="icon-btn small" onClick={() => removePoolItem(poolKey, idx)}><Trash2 size={14} /></button>
          </div>
          <LabeledInput label="Video link" value={item.videoUrl} onChange={(v) => updatePoolItem(poolKey, idx, "videoUrl", v)} />
        </div>
      ))}
      <button className="btn-ghost" onClick={() => addPoolItem(poolKey)}><Plus size={14} /> Add to pool</button>
    </div>
  );

  return (
    <ModalShell onClose={onClose} title="Edit Max Effort Pools" fullscreen>
      <LabeledInput label="Rotate every (weeks)" type="number" value={conj.meRotationWeeks} onChange={(v) => setConj((prev) => ({ ...prev, meRotationWeeks: Number(v) }))} />
      {renderPool("meLowerPool", "Max Effort Lower")}
      {renderPool("meUpperPool", "Max Effort Upper")}
      <button className="btn-primary wide" style={{ marginTop: 14 }} onClick={save}>Save pools</button>
    </ModalShell>
  );
}
function LabeledInput({ label, value, onChange, type = "text", step, inputMode }) {
  return <label className="labeled-input"><span>{label}</span><input type={type} step={step} inputMode={inputMode} value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></label>;
}

/* ============================== HISTORY TAB ============================== */

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
    await onPersist({ ...client, logs: updatedLogs });
    setEditing(false);
    setSaved(true);
  };

  if (editing) {
    return (
      <div>
        <div className="history-date" style={{ marginBottom: 8 }}>Editing — Week {log.weekNumber}, Day {log.dayLabel}</div>
        {draft.map((e, exIdx) => (
          <div key={e.exerciseId} className="edit-ex-card">
            <div className="log-exercise-name" style={{ fontSize: 13.5, marginBottom: 6 }}>{e.name}</div>
            <div className="set-grid-header"><span>Set</span><span>Weight</span><span>Reps</span><span>Rate of Perceived Exertion</span></div>
            {e.sets.map((s, setIdx) => (
              <div className="set-grid-row" key={setIdx} style={{ gridTemplateColumns: "24px 1fr 1fr 1fr" }}>
                <span className="set-num">{setIdx + 1}</span>
                <input type="number" step="0.1" inputMode="decimal" placeholder="pounds" value={s.weight} onChange={(ev) => updateDraftSet(exIdx, setIdx, "weight", ev.target.value)} />
                <input type="text" placeholder="reps" value={s.reps} onChange={(ev) => updateDraftSet(exIdx, setIdx, "reps", ev.target.value)} />
                <input type="number" min="1" max="10" placeholder="RPE" value={s.rir !== "" && s.rir !== undefined ? rpeFromRir(s.rir) : ""} onChange={(ev) => updateDraftSet(exIdx, setIdx, "rir", ev.target.value === "" ? "" : String(10 - Number(ev.target.value)))} />
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
          <div className="muted" style={{ fontSize: 13 }}>{e.sets.map((s) => `${s.weight || 0} pounds × ${s.reps || 0} reps${s.rir !== "" ? `, Rate of Perceived Exertion ${rpeFromRir(s.rir)}` : ""}`).join("  —  ")}</div>
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

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedLogs = selectedDate ? (logsByDate[selectedDate] || []) : [];
  const selectedMobility = selectedDate ? (mobilityByDate[selectedDate] || []) : [];

  return (
    <div className="pad">
      {client.weeklySchedule && (
        <Card title="Your Weekly Training Schedule">
          {[["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]].map(([key, label]) => {
            const text = client.weeklySchedule[key];
            if (!text || !text.trim()) return null;
            const isOff = text.trim().toLowerCase() === "off";
            return (
              <div key={key} className="schedule-row">
                <div className="schedule-day">{label}</div>
                <div className={`schedule-detail ${isOff ? "off" : ""}`}>{text.split("\n").map((line, i) => <div key={i}>{line}</div>)}</div>
              </div>
            );
          })}
          <p className="muted" style={{ marginTop: 10, fontSize: 11.5 }}>Edit this any time in Settings.</p>
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
      {logs.length === 0 ? <EmptyState text="No workouts logged yet. Finish a session from Today to see it here." /> : (
        logs.map((log) => (
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
        ))
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
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>A running diary of your mat time — what you learned in class and what to drill next time. Nothing here is ever shared with your coach unless you show them directly.</p>

      {!adding && <button className="btn-primary wide" onClick={startAdd}>+ Add Today's Notes</button>}

      {adding && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="log-exercise-name" style={{ marginBottom: 8 }}>{editingId ? "Edit Entry" : "New Entry"}</div>
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
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
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
  const bwData = (client.bodyweightLog || []).map((b) => ({ date: fmtDate(b.date), weight: b.weight }));
  const readinessEntries = Object.values(client.readiness || {}).sort((a, b) => (a.date < b.date ? -1 : 1));
  const readinessData = readinessEntries.map((r) => ({ date: fmtDate(r.date), score: r.color === "GREEN" ? 3 : r.color === "YELLOW" ? 2 : 1 }));
  const sorenessData = readinessEntries.map((r) => ({ date: fmtDate(r.date), soreness: Number(r.soreness) }));

  if (bwData.length === 0 && readinessData.length === 0) return <div className="pad"><EmptyState text="Log a workout or a daily check-in to see progress charts." /></div>;

  return (
    <div className="pad">
      {bwData.length > 0 && (
        <Card title="Bodyweight">
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bwData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                <YAxis stroke="var(--text-dim)" fontSize={11} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                <Line type="monotone" dataKey="weight" stroke="var(--text)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <DetailBarToggle label="bodyweight" entries={bwData} dataKey="weight" domain={["auto", "auto"]} />
        </Card>
      )}

      {readinessData.length > 0 && (
        <Card title="Readiness">
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={readinessData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                <YAxis stroke="var(--text-dim)" fontSize={11} domain={[0, 3]} ticks={[1, 2, 3]} tickFormatter={(v) => ({ 1: "Red", 2: "Yellow", 3: "Green" }[v])} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                <Line type="stepAfter" dataKey="score" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <DetailBarToggle label="readiness" entries={readinessData} dataKey="score" domain={[0, 3]} />
        </Card>
      )}

      {sorenessData.length > 0 && (
        <Card title="Muscle Soreness">
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sorenessData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                <YAxis stroke="var(--text-dim)" fontSize={11} domain={[0, 5]} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                <Line type="monotone" dataKey="soreness" stroke="var(--amber)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>Every lift you've flagged as a Personal Record, most recent first. Tap a lift with more than one to see every earlier one too.</p>
      {names.map((name) => {
        const records = grouped[name];
        const mostRecent = records[0];
        const earlier = records.slice(1);
        const open = openName === name;
        return (
          <div key={name} className="pr-card-wrap">
            <button className="pr-card-v2" onClick={() => earlier.length > 0 && setOpenName(open ? null : name)}>
              <div className="pr-card-v2-top">
                <div className="pr-card-v2-name">{name}</div>
                {earlier.length > 0 && <ChevronRight size={18} className={open ? "chev-open" : ""} />}
              </div>
              <div className="pr-side-row" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                <Trophy size={17} color="var(--accent)" /><span>{mostRecent.weight} lb × {mostRecent.reps} reps</span>
              </div>
              <div className="pr-side-row"><CalendarDays size={13} color="var(--text-dim)" /><span className="muted">{fmtDate(mostRecent.date)} — most recent</span></div>
              {earlier.length > 0 && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{earlier.length} earlier Personal Record{earlier.length === 1 ? "" : "s"}</div>}
            </button>
            {open && earlier.length > 0 && (
              <div className="pr-history">
                {earlier.map((h) => (
                  <div key={h.id} className="pr-history-row-v2">
                    <div className="pr-history-weight">{h.weight} lb <span className="pr-history-x">×</span> {h.reps} reps</div>
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
  const canCreate = firstName.trim() && lastName.trim();

  return (
    <ModalShell onClose={onClose} title="Athletes / Clients">
      {clients.map((c) => (
        <div key={c.id} className="client-row">
          <button className={`client-select ${c.id === activeId ? "active" : ""}`} onClick={() => onSelect(c.id)}>{c.name}</button>
          {clients.length > 1 && <button className="icon-btn small" onClick={() => onDelete(c.id)}><Trash2 size={14} /></button>}
        </div>
      ))}
      {!adding ? <button className="btn-ghost wide" style={{ marginTop: 14 }} onClick={() => setAdding(true)}><Plus size={16} /> Add athlete</button> : (
        <div className="add-client-form">
          <LabeledInput label="First name" value={firstName} onChange={setFirstName} />
          <LabeledInput label="Last name" value={lastName} onChange={setLastName} />
          <LabeledInput label="Bodyweight (pounds)" type="number" step="0.1" inputMode="decimal" value={weight} onChange={setWeight} />
          <div className="edit-ex-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <LabeledInput label="Height — feet" type="number" value={heightFeet} onChange={setHeightFeet} />
            <LabeledInput label="Height — inches" type="number" value={heightInches} onChange={setHeightInches} />
          </div>
          <div className="radio-group">
            <label className={`radio-pill ${template === "bjj" ? "active" : ""}`}><input type="radio" checked={template === "bjj"} onChange={() => setTemplate("bjj")} />Conjugate Brazilian Jiu-Jitsu / Wrestling template</label>
            <label className={`radio-pill ${template === "blank" ? "active" : ""}`}><input type="radio" checked={template === "blank"} onChange={() => setTemplate("blank")} />Blank — build custom</label>
          </div>
          <button className="btn-primary wide" style={{ marginTop: 10 }} disabled={!canCreate}
            onClick={() => {
              onAdd({ firstName: firstName.trim(), lastName: lastName.trim(), weight: Number(weight) || 0, heightFeet: Number(heightFeet) || 0, heightInches: Number(heightInches) || 0 }, template === "bjj");
              setFirstName(""); setLastName(""); setWeight(""); setHeightFeet(""); setHeightInches(""); setAdding(false);
            }}>Create athlete</button>
        </div>
      )}
    </ModalShell>
  );
}

/* ============================== SHARED UI ============================== */

function Card({ title, subtitle, right, children }) {
  return <div className="card"><div className="card-head"><div><div className="card-title">{title}</div>{subtitle && <div className="muted" style={{ fontSize: 13 }}>{subtitle}</div>}</div>{right}</div>{children}</div>;
}
function StatChip({ label, value }) { return <div className="stat-chip"><div className="stat-chip-value">{value}</div><div className="stat-chip-label">{label}</div></div>; }
function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }
function ModalShell({ title, children, onClose, fullscreen, headerRight, headerLeftExtra }) {
  return (
    <div className={`modal-overlay ${fullscreen ? "fullscreen" : ""}`}>
      <div className="modal-box">
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="icon-btn" onClick={onClose}><ArrowLeft size={18} /></button>
            {headerLeftExtra}
          </div>
          <div className="modal-title">{title}</div>
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
      .app-shell { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; position: relative;
        background: var(--bg); color: var(--text); }
      .app-shell[data-theme="dark"] { --bg:#0c0c0d; --card:#18181a; --border:#2b2b2d; --text:#f2f0ec; --text-dim:#9a9a9c; --accent:#e0323f; --accent-text:#ffffff; --green:#4f9d5c; --amber:#d9a22b; --neon-gold:#f5e000; }
      .app-shell[data-theme="light"] { --bg:#f6f5f3; --card:#ffffff; --border:#e1dfda; --text:#141414; --text-dim:#68686a; --accent:#c81e2c; --accent-text:#ffffff; --green:#3f7d4a; --amber:#b9840f; --neon-gold:#c9b400; }
      .app-shell::before { content: ""; position: fixed; inset: 0; max-width: 480px; margin: 0 auto; background: radial-gradient(ellipse 100% 60% at 50% 0%, var(--belt-glow, transparent) 0%, transparent 85%); opacity: 0.38; pointer-events: none; z-index: 0; }
      .app-shell::after { content: ""; position: fixed; top: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; height: 6px; background: var(--belt-glow, transparent); opacity: 0.95; pointer-events: none; z-index: 6; box-shadow: 0 0 12px var(--belt-glow, transparent); }
      .app-shell > * { position: relative; z-index: 1; }
      * { box-sizing: border-box; }
      .scroll-area { flex: 1; overflow-y: auto; padding-bottom: 90px; }
      .pad { padding: 16px; }
      .brand-title { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 30px; letter-spacing: 0.02em; color: var(--accent); margin-bottom: 4px; line-height: 1.05; }
      .logo-block { position: relative; overflow: hidden; padding: 34px 18px; margin-bottom: 6px; border-radius: 16px; background: var(--card); border: 1px solid var(--border); }
      .logo-block .brand-title { font-size: 32px; margin-bottom: 0; }
      .sisyphus-mark { position: absolute; inset: 0; width: 100%; height: 100%; color: var(--accent); pointer-events: none; }
      .logo-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.35; pointer-events: none; }
      .program-choice-card { background: var(--card); border: 2px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 10px; cursor: pointer; }
      .program-choice-card.active { border-color: var(--accent); }
      .program-choice-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
      .topbar { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px 14px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 5; }
      .topbar-brand { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 17px; letter-spacing: 0.01em; color: var(--accent); line-height: 1.1; max-width: 220px; }
      .topbar-name-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
      .topbar-name-btn { background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border); }
      .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
      .dash-stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .dash-stat.wide { grid-column: 1 / -1; }
      .dash-stat-value { font-weight: 700; font-size: 14px; }
      .dash-stat-label { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
      .progress-bar-track { width: 100%; height: 10px; border-radius: 999px; background: var(--border); overflow: hidden; }
      .progress-bar-fill { height: 100%; background: var(--accent); border-radius: 999px; }
      .milestone-row { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; opacity: 0.6; }
      .milestone-row.achieved { opacity: 1; border-color: var(--green); }
      .milestone-emoji { font-size: 26px; flex-shrink: 0; }
      .milestone-name { font-weight: 600; font-size: 13.5px; }
      .icon-btn { background: var(--card); border: 1px solid var(--border); border-radius: 10px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: var(--text); cursor: pointer; }
      .icon-btn.small { width: 30px; height: 30px; }
      .bottom-nav { position: sticky; bottom: 0; display: flex; border-top: 1px solid var(--border); background: var(--bg); z-index: 10; }
      .nav-btn { flex: 1; background: none; border: none; color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 0 10px; font-size: 9px; cursor: pointer; }
      .nav-btn.active { color: var(--accent); }
      .stat-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
      .stat-chip { flex: 1 1 45%; min-width: 90px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; text-align: center; }
      .stat-chip-value { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 20px; letter-spacing: 0.02em; }
      .stat-chip-label { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
      .card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
      .card-title { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 18px; letter-spacing: 0.02em; }
      .muted { color: var(--text-dim); font-size: 14px; line-height: 1.4; }
      .pill { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; color: #ffffff; }
      .intent-box { background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid var(--accent); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--text); margin-bottom: 12px; line-height: 1.4; }
      .adjust-box { background: color-mix(in srgb, var(--amber) 14%, transparent); border: 1px solid var(--amber); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; color: var(--text); margin-bottom: 12px; line-height: 1.4; }
      .link-btn { background: none; border: none; color: var(--accent); text-decoration: underline; font-size: 12.5px; cursor: pointer; padding: 0; }
      .day-nav-row { display: flex; align-items: center; gap: 8px; }
      .day-nav-btn { background: var(--card); border: 1px solid var(--border); border-radius: 8px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: var(--text); cursor: pointer; flex-shrink: 0; }
      .day-nav-btn:disabled { opacity: 0.3; cursor: default; }
      .jump-picker { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-bottom: 12px; max-height: 240px; overflow-y: auto; }
      .jump-week-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 2px; border-bottom: 1px solid var(--border); }
      .jump-week-row:last-child { border-bottom: none; }
      .jump-week-label { font-size: 12px; color: var(--text-dim); }
      .jump-day-row { display: flex; gap: 6px; }
      .jump-day-btn { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 12px; cursor: pointer; }
      .jump-day-btn.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 700; }
      .jump-day-btn.is-today:not(.active) { border-color: var(--accent); color: var(--accent); }
      .day-intent-preview { font-size: 12.5px; color: var(--text-dim); font-style: italic; margin-bottom: 8px; }
      .section-preview-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
      .preview-toggle { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; color: var(--text); font-size: 13.5px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; cursor: pointer; margin-bottom: 8px; }
      .section-preview-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13.5px; border-bottom: 1px solid var(--border); }
      .section-preview-row:last-child { border-bottom: none; }
      .section-subheading { font-size: 11px; letter-spacing: 0.03em; color: var(--accent); margin: 8px 0 4px; }
      .btn-primary { background: var(--accent); color: var(--accent-text); border: none; border-radius: 10px; padding: 12px 18px; font-weight: 700; font-size: 15px; cursor: pointer; }
      .btn-primary.wide, .btn-ghost.wide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; }
      .btn-primary:disabled { opacity: 0.4; }
      .btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 11px 18px; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; }
      .program-actions { display: flex; gap: 8px; margin-bottom: 14px; }
      .program-actions .btn-ghost { flex: 1; justify-content: center; font-size: 13px; padding: 10px; margin-top: 0; }
      .pr-line { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 4px 0; }
      .slider-row { margin-bottom: 14px; }
      .slider-label { display: flex; justify-content: space-between; font-size: 13.5px; margin-bottom: 6px; }
      .slider-value { color: var(--accent); font-weight: 700; }
      input[type="range"] { width: 100%; accent-color: var(--accent); }
      .bw-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 14px; }
      .bw-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font-size: 14px; text-align: right; }
      .bjj-toggle { display: flex; align-items: center; gap: 8px; font-size: 13.5px; margin-bottom: 16px; cursor: pointer; }
      .bjj-toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 50; display: flex; align-items: flex-end; justify-content: center; }
      .modal-box { background: var(--bg); width: 100%; max-width: 480px; max-height: 88vh; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; overflow: hidden; }
      .modal-overlay.fullscreen .modal-box { max-height: 100vh; height: 100vh; border-radius: 0; }
      .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 8px; }
      .modal-title { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 18px; flex: 1; }
      .modal-content { padding: 16px; overflow-y: auto; flex: 1; }
      .progress-circle { position: relative; width: 42px; height: 42px; }
      .progress-circle-arc { stroke: var(--accent); transition: stroke-dashoffset 0.25s; }
      .progress-circle.amber .progress-circle-arc { stroke: var(--amber); }
      .progress-circle.green .progress-circle-arc { stroke: var(--green); }
      .progress-circle.neon .progress-circle-arc { stroke: var(--neon-gold); filter: drop-shadow(0 0 4px var(--neon-gold)); }
      .progress-circle-pct { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--text); }
      .rest-banner { display: flex; align-items: flex-start; gap: 8px; background: var(--accent); color: #fff; padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.4; margin-bottom: 14px; position: sticky; top: 0; z-index: 2; }
      .rest-banner span { flex: 1; }
      .rest-dismiss { background: rgba(255,255,255,0.2); border: none; border-radius: 999px; width: 22px; height: 22px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer; }
      .log-exercise { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .log-exercise-head { margin-bottom: 10px; }
      .log-exercise-name { font-weight: 700; font-size: 15.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .log-exercise-target-wrap { margin-bottom: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
      .section-ex-block:first-of-type .log-exercise-target-wrap { border-top: none; padding-top: 0; }
      .log-exercise-target { font-size: 12.5px; color: var(--text-dim); margin-top: 2px; }
      .rest-note-static { font-size: 12px; color: #4a9eff; margin-top: 3px; font-weight: 600; }
      .rename-input { flex: 1; background: var(--bg); border: 1px solid var(--accent); border-radius: 8px; padding: 6px 10px; color: var(--text); font-size: 14px; font-weight: 700; }
      .icon-btn-sm { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .icon-btn-sm:hover { color: var(--accent); }
      .log-exercise-cue { font-size: 12px; color: var(--accent); margin-top: 4px; font-style: italic; }
      .ex-name-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .recommended-tag { font-size: 10px; color: var(--green); border: 1px solid var(--green); border-radius: 999px; padding: 1px 7px; margin-left: 8px; vertical-align: 2px; }
      .last-logged { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
      .pct-1rm-row { font-size: 11.5px; color: var(--accent); margin: -3px 0 8px 2px; font-style: italic; }
      .ex-links-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      .video-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--accent); text-decoration: none; border: 1px solid var(--accent); border-radius: 999px; padding: 3px 9px; }
      .link-x-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 999px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; }
      .link-edit-btn { background: none; border: none; color: var(--text-dim); font-size: 11px; text-decoration: underline; cursor: pointer; }
      .add-link-btn { background: none; border: 1px dashed var(--border); border-radius: 999px; color: var(--text-dim); font-size: 11.5px; padding: 3px 10px; cursor: pointer; margin-top: 8px; }
      .video-edit-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
      .set-pr { background: var(--card); border: 1px solid var(--border); border-radius: 8px; height: 34px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; }
      .set-pr.flagged { background: var(--amber); border-color: var(--amber); color: #fff; }
      .sub-row { display: flex; flex-wrap: wrap; margin-top: 8px; gap: 6px; }
      .sub-pill-row { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
      .sub-pill { background: var(--bg); border: 1px solid var(--border); border-radius: 999px; color: var(--text); font-size: 11.5px; padding: 6px 11px; cursor: pointer; }
      .sub-pill.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 700; }
      .set-note { display: block; font-size: 8.5px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.02em; margin-top: 2px; }
      .section-header { width: 100%; background: none; border: none; color: var(--text); display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 0; }
      .section-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; cursor: pointer; }
      .section-check.checked { background: var(--green); border-color: var(--green); }
      .warmup-block { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
      .warmup-block-head { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
      .warmup-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; }
      .warmup-item input { margin-top: 3px; accent-color: var(--accent); }
      .warmup-item-name { font-size: 13.5px; }
      .set-grid-header, .set-grid-row { display: grid; grid-template-columns: 34px 1fr 1fr 1fr 32px 32px; gap: 5px; align-items: center; }
      .set-grid-header { font-size: 9.5px; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.02em; }
      .set-grid-row { margin-bottom: 6px; }
      .set-num { font-size: 13px; color: var(--text-dim); }
      .set-grid-row input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 4px; font-size: 12.5px; width: 100%; text-align: center; }
      .set-grid-row input:disabled { opacity: 0.55; background: var(--card); cursor: default; }
      .set-done { background: var(--card); border: 1px solid var(--border); border-radius: 8px; height: 34px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer; }
      .set-done.done { background: var(--green); color: #fff; border-color: var(--green); }
      .notes-box { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; color: var(--text); padding: 10px; font-size: 14px; font-family: inherit; resize: vertical; }
      .finish-summary { display: flex; flex-direction: column; gap: 12px; align-items: stretch; padding-top: 10px; }
      .finish-stat { text-align: center; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
      .finish-stat-value { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 30px; color: var(--accent); }
      .finish-stat-label { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
      .program-title { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 22px; margin-bottom: 14px; }
      .phase-block { margin-bottom: 10px; }
      .phase-header { width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; color: var(--text); }
      .phase-weeks { font-size: 11px; color: var(--accent); letter-spacing: 0.03em; }
      .phase-name { font-weight: 700; font-size: 15px; margin-top: 2px; }
      .chev-open { transform: rotate(90deg); transition: transform 0.15s; }
      .phase-body { padding: 12px 4px; }
      .day-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
      .day-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .day-badge { background: var(--accent); color: #fff; font-weight: 800; font-size: 12px; width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
      .day-name { font-weight: 600; font-size: 14px; flex: 1; }
      .program-ex-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; border-top: 1px solid var(--border); gap: 10px; }
      .program-ex-row:first-of-type { border-top: none; }
      .edit-ex-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
      .edit-ex-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
      .edit-ex-row.four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .edit-input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px; font-size: 13.5px; }
      .edit-input:disabled { opacity: 0.6; }
      .wide-input { flex: 1; }
      .labeled-input { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-dim); margin-bottom: 8px; }
      .labeled-input input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px; font-size: 13.5px; }
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
      .pr-big-number { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 34px; color: var(--accent); line-height: 1; }
      .pr-big-unit { font-size: 15px; margin-left: 3px; color: var(--text-dim); font-family: inherit; }
      .pr-big-label { font-size: 10.5px; color: var(--text-dim); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.03em; }
      .pr-side-stats { display: flex; flex-direction: column; gap: 6px; border-left: 1px solid var(--border); padding-left: 14px; flex: 1; }
      .pr-side-row { display: flex; align-items: center; gap: 6px; font-size: 13.5px; }
      .pr-history-row-v2 { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--border); }
      .pr-history-row-v2:last-child { border-bottom: none; }
      .pr-history-weight { font-weight: 700; font-size: 14px; }
      .pr-history-x { color: var(--text-dim); font-weight: 400; }
      .pr-history-date { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text-dim); }
      .pr-chart-wrap { background: var(--bg); border: 1px solid var(--border); border-top: none; border-radius: 0 0 12px 12px; padding: 10px 14px 14px; margin-top: -1px; }
      .pr-card-name { font-weight: 700; font-size: 14.5px; }
      .pr-history { background: var(--bg); border: 1px solid var(--border); border-top: none; border-radius: 0 0 12px 12px; padding: 8px 14px; margin-top: -1px; }
      .pr-history-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
      .pr-history-row:last-child { border-bottom: none; }
      .empty-state { text-align: center; color: var(--text-dim); padding: 60px 20px; font-size: 14px; }
      .client-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .client-select { flex: 1; text-align: left; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; color: var(--text); font-size: 14.5px; cursor: pointer; }
      .client-select.active { border-color: var(--accent); color: var(--accent); font-weight: 700; }
      .add-client-form { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
      .radio-group { display: flex; gap: 8px; }
      .radio-pill { flex: 1; border: 1px solid var(--border); border-radius: 10px; padding: 10px; text-align: center; font-size: 12.5px; cursor: pointer; color: var(--text-dim); display: flex; align-items: center; justify-content: center; }
      .radio-pill.active { border-color: var(--accent); color: var(--accent); }
      .radio-pill input { display: none; }
      .mobility-type-tag { display: inline-block; font-size: 11px; letter-spacing: 0.04em; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 2px 10px; }
      .mobility-timer { font-family: 'Bebas Neue', 'Oswald', sans-serif; font-size: 48px; color: var(--accent); }
      .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .schedule-row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
      .schedule-row:last-of-type { border-bottom: none; }
      .schedule-day { width: 76px; flex-shrink: 0; font-weight: 700; font-size: 12.5px; padding-top: 1px; }
      .schedule-detail { font-size: 12.5px; color: var(--text); line-height: 1.5; }
      .schedule-detail.off { color: var(--text-dim); font-style: italic; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .cal-grid-header { margin-bottom: 4px; }
      .cal-day-label { text-align: center; font-size: 10px; color: var(--text-dim); font-weight: 700; padding-bottom: 2px; }
      .cal-cell { aspect-ratio: 1; background: var(--card); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text); font-size: 12px; cursor: pointer; gap: 3px; padding: 0; }
      .cal-cell.empty { background: transparent; border: none; cursor: default; }
      .cal-cell.today { border-color: var(--accent); border-width: 2px; }
      .cal-cell.selected { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
      .cal-dot-row { display: flex; gap: 3px; }
      .cal-dot { width: 5px; height: 5px; border-radius: 50%; }
      .cal-dot.workout { background: var(--green); }
      .cal-dot.mobility { background: var(--amber); }
      .cal-cell.selected .cal-dot.workout, .cal-cell.selected .cal-dot.mobility { background: #ffffff; }
    `}</style>
  );
}

/* ============================== AUTH SCREEN ============================== */

function AuthScreen() {
  const [theme, setTheme] = useState("dark");
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrOk, setQrOk] = useState(true);
  const hasPaymentInfo = coachVenmo || coachCashApp;

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
        if (err) setError(err.message);
        else setInfo("Check your email to confirm your account, then sign in below.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(err.message);
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
          <GrapplingMark opacity={0.14} />
          <div className="brand-title" style={{ position: "relative" }}>KC Grappling Protocol</div>
        </div>
        <div className="program-title" style={{ fontSize: 20, marginBottom: 4 }}>{mode === "signup" ? "Create Your Account" : "Sign In"}</div>
        <p className="muted" style={{ marginBottom: 20 }}>
          {mode === "signup" ? "Your own account, your own data, saved permanently and available on any device." : "Welcome back."}
        </p>
        {mode === "signup" && hasPaymentInfo && (
          <div className="card" style={{ marginBottom: 18, textAlign: "center" }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Payment</div>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Please send payment before starting your program.</p>
            {qrOk && <img src="/payment-qr.png" alt="Payment QR code" style={{ width: 180, height: 180, objectFit: "contain", margin: "0 auto 12px", display: "block", borderRadius: 8, background: "#fff" }} onError={() => setQrOk(false)} />}
            {coachVenmo && <div style={{ fontSize: 13.5, marginBottom: 4 }}>Venmo: <strong>{coachVenmo}</strong></div>}
            {coachCashApp && <div style={{ fontSize: 13.5 }}>Cash App: <strong>{coachCashApp}</strong></div>}
          </div>
        )}
        <form onSubmit={submit}>
          <label className="labeled-input">
            <span><Mail size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="labeled-input">
            <span><Lock size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Password</span>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
          </label>
          {error && <div className="adjust-box" style={{ borderColor: "var(--accent)", marginBottom: 12 }}>{error}</div>}
          {info && <div className="adjust-box" style={{ borderColor: "var(--green)", marginBottom: 12 }}>{info}</div>}
          <button className="btn-primary wide" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create Account" : "Sign In"}</button>
        </form>
        <button className="btn-ghost wide" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setInfo(""); }}>
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
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
          This app needs a Supabase project connected before anyone can create an account. Add
          VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as environment variables in your Vercel
          project settings, then redeploy.
        </p>
      </div>
      <GlobalStyle />
    </div>
  );
}

export default function AppGate() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out, object = signed in

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabase) return <ConfigMissingScreen />;
  if (session === undefined) return null;
  if (!session) return <AuthScreen />;
  return <MainApp userId={session.user.id} onSignOut={() => supabase.auth.signOut()} />;
}
