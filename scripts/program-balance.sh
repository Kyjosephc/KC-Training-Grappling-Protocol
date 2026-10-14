#!/bin/sh
# Weekly sets by movement pattern, per program. Not a pass/fail — a readout, for
# when you want to see what a program is actually asking for before changing it.
# Run:  sh scripts/program-balance.sh  [A|B|C|D]
set -e
cd "$(dirname "$0")/.."
# Clean up on every exit path. Without the trap, a failing check leaves the
# temporary copy of the source behind for the next commit to pick up.
trap 'rm -f src/_b.jsx .balance.cjs' EXIT INT TERM
cp src/App.jsx src/_b.jsx
printf '\nexport const __t = { buildProgramVariant, positionAtIndex, SECTION_LABELS, PROGRAM_VARIANT_LABELS, resolveDaySections, resolveOptsFor, sessionShape };\n' >> src/_b.jsx
node_modules/.bin/esbuild src/_b.jsx --bundle --outfile=.balance.cjs --format=cjs --loader:.js=jsx \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"","VITE_SUPABASE_ANON_KEY":"","VITE_COACH_USER_ID":"c"}' \
  --external:react --external:react-dom --external:lucide-react --external:recharts --log-level=error
node scripts/program-balance.cjs "$@"
