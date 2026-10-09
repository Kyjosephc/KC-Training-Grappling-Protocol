#!/bin/sh
# Weekly sets by movement pattern, per program. Not a pass/fail — a readout, for
# when you want to see what a program is actually asking for before changing it.
# Run:  sh scripts/program-balance.sh  [A|B|D]
set -e
cd "$(dirname "$0")/.."
cp src/App.jsx src/_b.jsx
printf '\nexport const __t = { buildProgramVariant, positionAtIndex, SECTION_LABELS };\n' >> src/_b.jsx
node_modules/.bin/esbuild src/_b.jsx --bundle --outfile=.balance.cjs --format=cjs --loader:.js=jsx \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"","VITE_SUPABASE_ANON_KEY":"","VITE_COACH_USER_ID":"c"}' \
  --external:react --external:react-dom --external:lucide-react --external:recharts --log-level=error
node scripts/program-balance.cjs "$@"
rm -f src/_b.jsx .balance.cjs
