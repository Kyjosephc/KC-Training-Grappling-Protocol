#!/bin/sh
# Two athletes through the whole app, screens mounted and clicked.
# Run:  sh scripts/verify-journey.sh
set -e
cd "$(dirname "$0")/.."
# Clean up on every exit path. Without the trap, a failing check leaves the
# temporary copy of the source behind for the next commit to pick up.
# The cleanup must never decide the exit code. These files are gitignored and a
# failure to remove one (a read-only checkout, a locked file, a sandbox that
# refuses deletes) says nothing about whether the checks passed — but with
# `set -e` it used to fail the whole run after every check had already passed.
trap 'rm -f src/_j.jsx .journey.cjs || true' EXIT INT TERM
cp src/App.jsx src/_j.jsx
printf '\nexport const __t = { OnboardingScreen, TodayTab, DaySessionScreen, SettingsModal, CoachDashboard, ProgressTab, CommunityTab, BJJNotesTab, VerdictCard, strengthVerdict, suggestFromHistory, freeSessionsUsed, buildClient, positionAtIndex, buildProgramVariant, PROGRAM_VARIANT_LABELS, sessionShape, MENTAL_COACHING_LIBRARY, mentalTipFor, mentalTipsForSession , snapRead, snapWrite, snapClearAll, queueRead, queuePut, queueDrop, pendingWriteCount, OfflineBanner , resolveDaySections, totalSessionsIn , needsWeight , hasMeaningfulMax , bestSetOf , lastAllTimeBest , COMMUNITY_CHANNELS, CHANNEL_GROUPS, channelsInGroup, groupOfChannel , matchSnippet, clipsForPicker, TECHNIQUE_TERMS, vocabForChannel, roomsMatchingTerm, ROOM_ALIASES , isMissingSavesTable, isRefusedSave , canMarkPR , PRsTab, bodyweightOn, prBodyweight, prBodyweightNote , relLuminance, contrastRatio, inkOn, BELT_THEME, beltVars , TutorialModal , noMaxGuidance , INJURY_AREAS, lookupVideo , est1RM, leaderboardTotalsFor, adjustSectionsForReadiness , clipThumb, isClip, clipTileWho, clipCountsFrom, groupClipCount , weekStart, weekStartISO, feedScope, feedWindow, seenPatch, channelMeta, lastSeenMap, groupLabel, THIS_WEEK, ALL_ROOMS, VIRTUAL_CHANNELS, isVirtualChannel, isWeekRoom , clipCountsFrom, groupClipCount, shownByRoomIn, shownPatch, unseenRows };\n' >> src/_j.jsx
node_modules/.bin/esbuild src/_j.jsx --bundle --outfile=.journey.cjs --format=cjs --loader:.js=jsx \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"","VITE_SUPABASE_ANON_KEY":"","VITE_COACH_USER_ID":"coach-1","VITE_COACH_VENMO":"kylecox","VITE_COACH_CASHAPP":"kylecox"}' \
  --external:react --external:react-dom --external:lucide-react --external:recharts --log-level=error
node scripts/verify-journey.cjs
