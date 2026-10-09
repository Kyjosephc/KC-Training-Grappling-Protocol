#!/bin/sh
# The payment path, exercised. Everything that has to be true about who gets
# asked for money, who does not, and what a paid athlete keeps.
# Run:  sh scripts/verify-payment.sh
set -e
cd "$(dirname "$0")/.."
cp src/App.jsx src/_v.jsx
printf '\nexport const __t = { freeSessionsUsed, FREE_SESSION_LIMIT, positionAtIndex, buildClient, buildProgramVariant };\n' >> src/_v.jsx
node_modules/.bin/esbuild src/_v.jsx --bundle --outfile=.pay.cjs --format=cjs --loader:.js=jsx \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"https://p.supabase.co","VITE_SUPABASE_ANON_KEY":"k","VITE_COACH_USER_ID":"coach-1"}' \
  --external:react --external:react-dom --external:recharts --log-level=error
node scripts/verify-payment.cjs
rm -f src/_v.jsx .pay.cjs
