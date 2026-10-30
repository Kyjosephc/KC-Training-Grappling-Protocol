// =============================================================================
// CALENDAR DATES — one definition, shared
// =============================================================================
// Every date this app stores is a local calendar date, never a UTC one.
// new Date().toISOString() rolls over to the next day for anyone west of UTC
// once it is evening locally — all of the US — which silently files workouts,
// bodyweight, check-ins and streaks under tomorrow.
//
// This lives in its own module because it was defined correctly in App.jsx and
// then re-implemented incorrectly in RulesGame.jsx, where an evening round was
// stamped tomorrow and the day streak could never count. A helper this easy to
// get wrong is a helper that gets imported, not copied.
// =============================================================================

export const toLocalDateStr = (d) => {
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
};

export const todayStr = () => toLocalDateStr(new Date());

// Yesterday on the athlete's own calendar. Subtracting 86,400,000 from the
// clock and then taking a date is not the same thing across a daylight-saving
// boundary, where a local day is 23 or 25 hours long.
export const yesterdayStr = (from = new Date()) => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  return toLocalDateStr(d);
};
