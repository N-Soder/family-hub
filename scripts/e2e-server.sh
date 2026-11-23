#!/bin/sh
# Starts the production build on :4173 with a throwaway database for Playwright.
# With E2E_TESSERAE=1 it also connects to the local Tesserae (as device sim-e2e).
set -e
cd "$(dirname "$0")/.."
export DATABASE_PATH=./data/e2e.db
rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm
export ADMIN_PIN=246810 PORT=4173 TZ_HOUSEHOLD=Australia/Perth
if [ "$E2E_TESSERAE" = "1" ]; then
  set -a; . ./.env; set +a
  export DATABASE_PATH=./data/e2e.db ADMIN_PIN=246810 PORT=4173
  export SIM_DEVICE_ID=sim-e2e APP_BASE_URL_FOR_TESSERAE=http://host.docker.internal:4173 TESSERAE_AUTO_BOOTSTRAP=true
else
  unset TESSERAE_URL
fi
npx tsx scripts/seed.ts
exec node build
