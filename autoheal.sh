#!/usr/bin/env bash
# ============================================================
#  Quarc Music — YouTube Download Auto-Heal
#
#  Periodically verifies yt-dlp downloads actually work through the VPN
#  (not just search — see check.sh for why that distinction matters), and
#  restarts gluetun if they don't, with a cooldown to avoid restart loops.
#
#  Only ever restarts gluetun itself (docker compose restart gluetun), never
#  the whole stack — a plain restart of one service doesn't retrigger the
#  dependency health-check chain the way `up -d --build` does, so backend
#  and frontend are left alone.
#
#  Run via cron, e.g. every 15 minutes:
#    */15 * * * * cd /path/to/Quarc_Music && bash autoheal.sh >> autoheal.log 2>&1
# ============================================================

cd "$(dirname "$0")" || exit 1

COOLDOWN_SECONDS=3600   # don't restart gluetun more than once per hour
STATE_FILE=".autoheal_last_restart"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

PROJECT=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/_/g')
BACKEND_CID=$(docker ps -q \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=backend" | head -1)

if [ -z "$BACKEND_CID" ]; then
  echo "[$(ts)] backend container not found — skipping check"
  exit 0
fi

# Same real download+extraction the app performs in production — flat-playlist
# search doesn't need YouTube's JS challenge, so it can look healthy while
# actual downloads are silently blocked; this catches that specifically.
docker exec "$BACKEND_CID" sh -c '
  rm -f /tmp/autoheal_test.mp3 /tmp/autoheal_err.log
  yt-dlp --proxy http://gluetun:8888 --js-runtimes node \
    -x --audio-format mp3 --no-warnings \
    -o "/tmp/autoheal_test.%(ext)s" \
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
    > /tmp/autoheal_err.log 2>&1
'
DL_OK=$(docker exec "$BACKEND_CID" sh -c 'test -s /tmp/autoheal_test.mp3 && echo yes || echo no')
docker exec "$BACKEND_CID" rm -f /tmp/autoheal_test.mp3 2>/dev/null

if [ "$DL_OK" = "yes" ]; then
  echo "[$(ts)] OK — download test passed"
  exit 0
fi

echo "[$(ts)] FAIL — download test failed:"
docker exec "$BACKEND_CID" tail -5 /tmp/autoheal_err.log 2>/dev/null

LAST=0
if [ -f "$STATE_FILE" ]; then
  LAST=$(cat "$STATE_FILE" 2>/dev/null)
  [ -z "$LAST" ] && LAST=0
fi
NOW=$(date +%s)
ELAPSED=$((NOW - LAST))

if [ "$ELAPSED" -lt "$COOLDOWN_SECONDS" ]; then
  echo "[$(ts)] Skipping gluetun restart — last restart ${ELAPSED}s ago (cooldown ${COOLDOWN_SECONDS}s)"
  exit 1
fi

echo "[$(ts)] Restarting gluetun..."
docker compose restart gluetun
echo "$NOW" > "$STATE_FILE"
echo "[$(ts)] gluetun restarted — will re-verify next run"
