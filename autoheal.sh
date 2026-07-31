#!/usr/bin/env bash
# ============================================================
#  Quarc Music — YouTube Download Auto-Heal
#
#  Periodically verifies yt-dlp downloads actually work through the VPN
#  (not just search — see check.sh for why that distinction matters).
#
#  Two distinct failure modes get two distinct remedies:
#   - A YouTube bot-check ("Sign in to confirm you're not a bot", 429 Too
#     Many Requests, LOGIN_REQUIRED) means the tunnel itself is fine but
#     the current VPN_COUNTRY's exit IP pool is blocklisted — confirmed in
#     production: Netherlands got broadly blocked while Germany worked
#     immediately with nothing else changed. Restarting gluetun on the SAME
#     country doesn't fix this; rotating VPN_COUNTRY does (same list
#     gluetun-watchdog.sh uses for its own, different trigger — that script
#     reacts to the tunnel/healthcheck itself failing, which this scenario
#     doesn't: gluetun stays perfectly healthy throughout).
#   - Anything else (timeout, connection reset, etc.) is treated as a
#     transient hiccup — a plain gluetun restart (same country) is the
#     less disruptive fix and was the previously-approved behavior.
#
#  Both share one cooldown/state file so they can't fire back-to-back.
#  Never touches backend/frontend — only ever gluetun.
#
#  Run via cron, e.g. every 15 minutes:
#    */15 * * * * cd /path/to/Quarc_Music && bash autoheal.sh >> autoheal.log 2>&1
# ============================================================

cd "$(dirname "$0")" || exit 1

COOLDOWN_SECONDS=3600   # don't act more than once per hour
STATE_FILE=".autoheal_last_restart"
ENV_FILE=".env"
COUNTRIES=(Germany Sweden Switzerland Finland)
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
    --extractor-args "youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416" \
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

ERR_LOG=$(docker exec "$BACKEND_CID" cat /tmp/autoheal_err.log 2>/dev/null)
echo "[$(ts)] FAIL — download test failed:"
echo "$ERR_LOG" | tail -5

LAST=0
if [ -f "$STATE_FILE" ]; then
  LAST=$(cat "$STATE_FILE" 2>/dev/null)
  [ -z "$LAST" ] && LAST=0
fi
NOW=$(date +%s)
ELAPSED=$((NOW - LAST))

if [ "$ELAPSED" -lt "$COOLDOWN_SECONDS" ]; then
  echo "[$(ts)] Skipping recovery action — last one was ${ELAPSED}s ago (cooldown ${COOLDOWN_SECONDS}s)"
  exit 1
fi

if echo "$ERR_LOG" | grep -qiE "sign in to confirm|429 Too Many Requests|LOGIN_REQUIRED"; then
  CURRENT=$(grep '^VPN_COUNTRY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
  NEXT=""
  for i in "${!COUNTRIES[@]}"; do
    if [ "${COUNTRIES[$i]}" = "$CURRENT" ]; then
      NEXT="${COUNTRIES[$(( (i + 1) % ${#COUNTRIES[@]} ))]}"
      break
    fi
  done
  [ -z "$NEXT" ] && NEXT="${COUNTRIES[0]}"

  echo "[$(ts)] YouTube bot-check detected — rotating VPN_COUNTRY ${CURRENT:-unknown} → ${NEXT}..."
  sed -i "s/^VPN_COUNTRY=.*/VPN_COUNTRY=${NEXT}/" "$ENV_FILE"
  docker compose up -d gluetun
  echo "$NOW" > "$STATE_FILE"
  echo "[$(ts)] gluetun restarted on ${NEXT} — will re-verify next run"
else
  echo "[$(ts)] Restarting gluetun (same region)..."
  docker compose restart gluetun
  echo "$NOW" > "$STATE_FILE"
  echo "[$(ts)] gluetun restarted — will re-verify next run"
fi
