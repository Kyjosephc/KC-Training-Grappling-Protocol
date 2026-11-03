#!/bin/sh
# Every screen, mounted and interrogated for accessibility.
# Run:  sh scripts/verify-a11y.sh
set -e
cd "$(dirname "$0")/.."
# Clean up on every exit path. Without the trap, a failing check leaves the
# temporary copy of the source behind for the next commit to pick up.
# The cleanup must never decide the exit code. These files are gitignored and a
# failure to remove one (a read-only checkout, a locked file, a sandbox that
# refuses deletes) says nothing about whether the checks passed — but with
# `set -e` it used to fail the whole run after every check had already passed.
trap 'rm -f src/_a.jsx .a11y.cjs || true' EXIT INT TERM
cp src/App.jsx src/_a.jsx
printf '\nexport const __t = { OnboardingScreen, AuthScreen, WaiverModal, TutorialModal, TodayTab, DaySessionScreen, MobilitySession, ProgressTab, PRsTab, HistoryTab, ScheduleTab, ProgramTab, BJJNotesTab, AccomplishmentsPage, OneRepMaxCalculator, SettingsModal, BottomNav, CommunityTab, LeaderboardTab, CoachDashboard, buildClient };\n' >> src/_a.jsx
node_modules/.bin/esbuild src/_a.jsx --bundle --outfile=.a11y.cjs --format=cjs --loader:.js=jsx \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"","VITE_SUPABASE_ANON_KEY":"","VITE_COACH_USER_ID":"coach-1","VITE_COACH_VENMO":"kylecox","VITE_COACH_CASHAPP":"kylecox"}' \
  --external:react --external:react-dom --external:lucide-react --external:recharts --log-level=error
node scripts/verify-a11y.cjs
