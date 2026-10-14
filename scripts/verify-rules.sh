#!/bin/sh
# Everything that has to be true about the Rules game before it ships.
#   1. verify.mjs  — the rulebook data and every generated question
#   2. verify-game.cjs — the screens an athlete actually taps through
# Run:  sh scripts/verify-rules.sh
set -e
cd "$(dirname "$0")/.."
# Clean up on every exit path. Without the trap, a failing check leaves the
# temporary copy of the source behind for the next commit to pick up.
trap 'rm -f .rg.cjs .eng.cjs' EXIT INT TERM
echo "=== rules data + question bank ==="
node src/rules/verify.mjs
echo
echo "=== the game, rendered and played ==="
node_modules/.bin/esbuild src/RulesGame.jsx --bundle --outfile=.rg.cjs --format=cjs \
  --loader:.js=jsx --external:react --external:react-dom --external:lucide-react --log-level=error
node_modules/.bin/esbuild src/rules/engine.js --bundle --outfile=.eng.cjs --format=cjs --log-level=error
node scripts/verify-game.cjs
