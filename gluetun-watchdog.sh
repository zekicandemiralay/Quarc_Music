#!/usr/bin/env bash
# Rotates VPN_COUNTRY when gluetun is unhealthy.
# Add to crontab:  */5 * * * * bash ~/Quarc_Music/gluetun-watchdog.sh

COUNTRIES=(Germany Sweden Switzerland Finland)
ENV_FILE="$(dirname "$0")/.env"
LOG="$HOME/gluetun-watchdog.log"
COMPOSE_DIR="$(dirname "$0")"

# Exit silently if gluetun is healthy or not running
HEALTH=$(docker inspect quarc_music-gluetun-1 --format='{{.State.Health.Status}}' 2>/dev/null || echo "missing")
[ "$HEALTH" = "healthy" ] && exit 0
[ "$HEALTH" = "missing" ] && exit 0

# Read current country from .env
CURRENT=$(grep '^VPN_COUNTRY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')

# Find the next country in the rotation
NEXT=""
for i in "${!COUNTRIES[@]}"; do
  if [ "${COUNTRIES[$i]}" = "$CURRENT" ]; then
    NEXT="${COUNTRIES[$(( (i + 1) % ${#COUNTRIES[@]} ))]}"
    break
  fi
done
[ -z "$NEXT" ] && NEXT="${COUNTRIES[0]}"

# Update .env and restart
sed -i "s/^VPN_COUNTRY=.*/VPN_COUNTRY=${NEXT}/" "$ENV_FILE"
cd "$COMPOSE_DIR" && docker compose up -d gluetun >> "$LOG" 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') — unhealthy (was: ${CURRENT:-unknown}) → rotating to: ${NEXT}" >> "$LOG"
