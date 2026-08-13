#!/usr/bin/env bash
# ============================================================
#  DEPRECATED — merged into autoheal.sh.
#
#  This script used to rotate VPN_COUNTRY independently whenever gluetun
#  went unhealthy, on its own 5-minute cron cadence with no cooldown —
#  running alongside autoheal.sh's separate download-test-triggered
#  rotation (its own 15-minute cadence, 1-hour cooldown). Two uncoordinated
#  loops writing the same VPN_COUNTRY value with no shared state could race
#  each other, which is itself a source of instability.
#
#  autoheal.sh now does everything this script did (gluetun-health check)
#  PLUS the deeper real-download check, sharing one cooldown/state file, so
#  the two can't fight. If this is still in crontab, remove it — leaving
#  both installed reintroduces the exact race this merge fixes.
#
#  This stub deliberately does nothing but say so, in case it's still
#  scheduled somewhere.
# ============================================================
echo "$(date '+%Y-%m-%d %H:%M:%S') — gluetun-watchdog.sh is deprecated and now a no-op. Remove it from crontab; autoheal.sh covers this (run it every 5 min instead)." >> "$(dirname "$0")/gluetun-watchdog.log"
exit 0
