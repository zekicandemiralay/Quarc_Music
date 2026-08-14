#!/usr/bin/env bash
# ============================================================
#  Quarc Music — YouTube/VPN Auto-Heal (unified)
#
#  Single self-healing loop. Used to be split across this script (rotates
#  VPN_COUNTRY on a failed real-download test) and a separate
#  gluetun-watchdog.sh (rotates on gluetun's own unhealthy status) running
#  on different cron cadences with different cooldowns — two independent
#  loops mutating the same VPN_COUNTRY value with no shared state let them
#  race each other, which is itself a source of instability rather than a
#  fix. Merged into one script, one state file, one cooldown.
#
#  Two failure signals, checked in order:
#   1. FAST: gluetun's own Docker healthcheck reports unhealthy — the
#      tunnel itself is down. Caught almost instantly (one docker inspect),
#      without waiting for a full download test.
#   2. DEEP: gluetun reports healthy, but a real download+extraction still
#      fails — catches "tunnel is up but YouTube is blocking us anyway"
#      (bot-check, region block, etc.), which the healthcheck can't see
#      since it only pings 1.1.1.1, not YouTube. This is the check that
#      caught the Aug 2026 outage the healthcheck alone stayed green
#      through for hours.
#
#  A YouTube bot-check error rotates VPN_COUNTRY (a same-region restart
#  doesn't fix it — confirmed in production: Netherlands got broadly
#  blocked while Germany worked immediately with nothing else changed). An
#  unhealthy tunnel or a generic/transient download failure just restarts
#  gluetun on the same country.
#
#  The deep check itself is wrapped in `timeout` (inside the container, so
#  it reliably kills the actual yt-dlp process, not just this script's
#  local wait) — a stalled VPN proxy can hang a raw yt-dlp call forever
#  with no error, which used to mean autoheal could miss every cron cycle
#  indefinitely instead of ever detecting anything.
#
#  Run via cron every 5 minutes:
#    */5 * * * * cd /path/to/Quarc_Music && bash autoheal.sh >> autoheal.log 2>&1
#
#  gluetun-watchdog.sh is retired — do not also cron that one, it would
#  reintroduce the exact race this merge fixes.
# ============================================================

cd "$(dirname "$0")" || exit 1

COOLDOWN_SECONDS=1800   # don't act more than once per 30 min
STATE_FILE=".autoheal_last_restart"
ENV_FILE=".env"
# Must be countries the current VPN plan can actually reach. ProtonVPN's
# FREE tier only has servers in 10 countries total (Canada, Japan, Mexico,
# Netherlands, Norway, Poland, Romania, Singapore, Switzerland, US) —
# picked 4 of those, skipping Netherlands (Surfshark's NL pool got broadly
# YouTube-blocklisted earlier — different provider/IPs, but no reason to
# tempt it) and US (the most commonly VPN-abused exit pool). On a paid
# Proton plan (FREE_ONLY removed from docker-compose.yml), this can widen
# to any of Proton's 145+ countries.
COUNTRIES=(Switzerland Norway Poland Romania)
ts() { date '+%Y-%m-%d %H:%M:%S'; }

PROJECT=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/_/g')
BACKEND_CID=$(docker ps -q \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=backend" | head -1)
GLUETUN_CID=$(docker ps -q \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=gluetun" | head -1)

if [ -z "$BACKEND_CID" ] || [ -z "$GLUETUN_CID" ]; then
  echo "[$(ts)] backend/gluetun container not found — skipping check"
  exit 0
fi

cooldown_ok() {
  local last=0
  [ -f "$STATE_FILE" ] && last=$(cat "$STATE_FILE" 2>/dev/null)
  [ -z "$last" ] && last=0
  local elapsed=$(( $(date +%s) - last ))
  if [ "$elapsed" -lt "$COOLDOWN_SECONDS" ]; then
    echo "[$(ts)] Skipping recovery action — last one was ${elapsed}s ago (cooldown ${COOLDOWN_SECONDS}s)"
    return 1
  fi
  return 0
}
mark_acted() { date +%s > "$STATE_FILE"; }

rotate_country() {
  local current next
  current=$(grep '^VPN_COUNTRY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
  next=""
  for i in "${!COUNTRIES[@]}"; do
    if [ "${COUNTRIES[$i]}" = "$current" ]; then
      next="${COUNTRIES[$(( (i + 1) % ${#COUNTRIES[@]} ))]}"
      break
    fi
  done
  [ -z "$next" ] && next="${COUNTRIES[0]}"
  echo "[$(ts)] Rotating VPN_COUNTRY ${current:-unknown} → ${next}..."
  sed -i "s/^VPN_COUNTRY=.*/VPN_COUNTRY=${next}/" "$ENV_FILE"
  docker compose up -d gluetun
  mark_acted
  echo "[$(ts)] gluetun restarted on ${next} — will re-verify next run"
}

restart_same_country() {
  echo "[$(ts)] Restarting gluetun (same region)..."
  docker compose restart gluetun
  mark_acted
  echo "[$(ts)] gluetun restarted — will re-verify next run"
}

# ── Fast path: gluetun's own healthcheck ────────────────────────────────
HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "$GLUETUN_CID" 2>/dev/null || echo "none")
if [ "$HEALTH" = "unhealthy" ]; then
  # AUTH_FAILED means the VPN provider is rejecting the OpenVPN credentials
  # themselves — every server on the account shares the same credentials, so
  # rotating VPN_COUNTRY hits a different server but the exact same rejection
  # every time (confirmed in production, Aug 2026, with Surfshark — the same
  # logic applies to any provider). This is NOT the "blocked/unhealthy
  # tunnel" scenario rotation exists for. Nothing this script can do fixes a
  # wrong password or an expired subscription — just say so clearly and
  # stop, instead of burning cooldown cycles on a rotation that can't help.
  if docker logs "$GLUETUN_CID" --since 10m 2>&1 | grep -q 'AUTH_FAILED'; then
    echo "[$(ts)] FAIL — gluetun unhealthy: AUTH_FAILED (bad VPN credentials or expired subscription, not a blocked server)."
    echo "[$(ts)] Rotating VPN_COUNTRY will NOT fix this — update VPN_USER/VPN_PASSWORD in .env from your VPN provider's dashboard (and check the subscription is active), then: docker compose up -d gluetun"
    exit 1
  fi
  echo "[$(ts)] FAIL — gluetun reports unhealthy (tunnel down)"
  cooldown_ok && rotate_country
  exit 0
fi

# ── Deep path: does a real download actually work? ──────────────────────
# Same real download+extraction the app performs in production — flat-playlist
# search doesn't need YouTube's JS challenge, so it can look healthy while
# actual downloads are silently blocked; this catches that specifically.
#
# Deliberately NOT a viral video (Rick Astley's dQw4w9WgXcQ used to be here) —
# it's served from YouTube's edge caches and skips most of the bot-check/
# PO-token gauntlet, so this canary stayed green through hours of real
# production failures on ordinary videos. Matches the video check.sh uses.
#
# `timeout 75` runs INSIDE the container so it kills the actual yt-dlp
# process on a stall — a dead-but-still-accepting-connections proxy can hang
# yt-dlp forever with no error otherwise, which used to mean this whole
# script (and every cron cycle after it) could hang along with it.
docker exec "$BACKEND_CID" sh -c '
  rm -f /tmp/autoheal_test.mp3 /tmp/autoheal_err.log
  timeout 75 yt-dlp --proxy http://gluetun:8888 --js-runtimes node \
    --extractor-args "youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416" \
    --socket-timeout 30 \
    -x --audio-format mp3 --no-warnings \
    -o "/tmp/autoheal_test.%(ext)s" \
    "https://www.youtube.com/watch?v=zMaNfqfsMtE" \
    > /tmp/autoheal_err.log 2>&1
'
DL_OK=$(docker exec "$BACKEND_CID" sh -c 'test -s /tmp/autoheal_test.mp3 && echo yes || echo no' 2>/dev/null || echo no)
docker exec "$BACKEND_CID" rm -f /tmp/autoheal_test.mp3 2>/dev/null

if [ "$DL_OK" = "yes" ]; then
  echo "[$(ts)] OK — download test passed"
  exit 0
fi

ERR_LOG=$(docker exec "$BACKEND_CID" cat /tmp/autoheal_err.log 2>/dev/null)
echo "[$(ts)] FAIL — download test failed:"
echo "$ERR_LOG" | tail -5

cooldown_ok || exit 1

if echo "$ERR_LOG" | grep -qiE "sign in to confirm|429 Too Many Requests|LOGIN_REQUIRED"; then
  rotate_country
else
  restart_same_country
fi
