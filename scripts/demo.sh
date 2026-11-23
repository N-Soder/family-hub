#!/bin/sh
# `npm run demo`: a fresh made-up household on http://localhost:5173, without Tesserae.
# Ignores .env so it never touches a real setup. Data lives in data/demo.db (recreated each run).
set -e
cd "$(dirname "$0")/.."
export FAMILY_HUB_DEMO=1 DATABASE_PATH=./data/demo.db CALENDAR_DIR=./data/demo-calendar BACKUP_DIR=./data/demo-backups
export ADMIN_PIN="${DEMO_PIN:-123456}" TZ_HOUSEHOLD="${TZ_HOUSEHOLD:-Australia/Perth}"
unset TESSERAE_URL TESSERAE_ADMIN_PASSWORD TESSERAE_PUSH_TOKEN TESSERAE_MCP_TOKEN CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD
rm -rf data/demo.db data/demo.db-wal data/demo.db-shm data/demo-calendar data/demo-backups
npx tsx scripts/demo.ts
echo
echo "  Planner:   http://localhost:5173/planner   (PIN $ADMIN_PIN)"
echo "  Kid view:  http://localhost:5173/planner/kids"
echo "  Wall:      http://localhost:5173/sim       (Direct tab; calendar panels need Tesserae)"
echo
exec npx vite dev "$@"
