#!/bin/sh
# Two athletes through the whole app, screens mounted and clicked.
# Run:  sh scripts/verify-journey.sh
set -e
cd "$(dirname "$0")/.."
cp src/App.jsx src/_j.jsx
printf '\nexport const __t = { OnboardingScreen, TodayTab, DaySessionScreen, SettingsModal, CoachDashboard, ProgressTab, CommunityTab, VerdictCard, strengthVerdict, suggestFromHistory, freeSessionsUsed, buildClient, positionAtIndex, buildProgramVariant, PROGRAM_VARIANT_LABELS };\n' >> src/_j.jsx
node_modules/.bin/esbuild src/_j.jsx --bundle --outfile=.journey.cjs --format=cjs --loader:.js=jsx \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"","VITE_SUPABASE_ANON_KEY":"","VITE_COACH_USER_ID":"coach-1","VITE_COACH_VENMO":"kylecox","VITE_COACH_CASHAPP":"kylecox"}' \
  --external:react --external:react-dom --external:lucide-react --external:recharts --log-level=error
node scripts/verify-journey.cjs
rm -f src/_j.jsx .journey.cjs
