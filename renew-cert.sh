#!/usr/bin/env bash
# Keeps the HTTPS certificate from quietly expiring.
#
# The cert is issued by Tailscale for the machine's ts.net name and lives in
# /var/lib/tailscale/certs, bind-mounted read-only into the frontend nginx
# container (see docker-compose.yml). Tailscale certs are short-lived — a few
# months — and nothing renews them on its own. When one lapses, every client
# fails to connect with a TLS error, which looks like the server being down;
# check.sh warns from 30 days out, but only if someone happens to run it.
#
# Two things people miss when renewing by hand, both handled below:
#   * `tailscale cert <domain>` writes into the CURRENT DIRECTORY unless told
#     otherwise, so run from the wrong place and nginx keeps serving the old
#     file while a fresh one sits somewhere useless.
#   * nginx reads the certificate once at startup. New files on disk change
#     nothing until it reloads.
#
#  Run via cron once a day (renewal is a daily concern, not a 5-minute one):
#    17 4 * * * cd /path/to/Quarc_Music && bash renew-cert.sh >> renew-cert.log 2>&1
#
#  This is safe to run alongside autoheal.sh — they share no state and touch
#  nothing in common (autoheal owns the VPN and containers, this owns the
#  cert), so the race that retired gluetun-watchdog.sh doesn't apply here.
#
#  Needs root for `tailscale cert`. Either put the line in root's crontab
#  (sudo crontab -e) or give the user passwordless sudo for tailscale; the
#  script handles both and says which is missing.
#
#  Usage:
#    bash renew-cert.sh            — renew if inside the window
#    bash renew-cert.sh --force    — renew regardless of days remaining
#    bash renew-cert.sh --dry-run  — report only, change nothing
set -u

cd "$(dirname "$0")" || exit 1

DOMAIN="${CERT_DOMAIN:-quarcnet0.tail84500c.ts.net}"
CERT_DIR="${CERT_DIR:-/var/lib/tailscale/certs}"
RENEW_WITHIN_DAYS="${RENEW_WITHIN_DAYS:-30}"

CRT="${CERT_DIR}/${DOMAIN}.crt"
KEY="${CERT_DIR}/${DOMAIN}.key"

FORCE=0; DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown argument: $arg"; exit 2 ;;
  esac
done

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*"; }

# Read expiry from the file rather than by connecting to nginx: this must
# still work when nginx is down, which is exactly when an expired cert is the
# likeliest cause.
days_left() {
  [ -r "$CRT" ] || return 1
  local end epoch
  end=$(openssl x509 -enddate -noout -in "$CRT" 2>/dev/null | cut -d= -f2) || return 1
  [ -n "$end" ] || return 1
  epoch=$(date -d "$end" +%s 2>/dev/null) || return 1
  echo $(( (epoch - $(date +%s)) / 86400 ))
}

# tailscale needs root; run directly if we already are, else non-interactive
# sudo. -n rather than a prompt because cron has no terminal to answer one.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi
}

DAYS=$(days_left) || DAYS=""

if [ -z "$DAYS" ]; then
  log "Could not read ${CRT} — treating as needing a certificate."
  DAYS=-1
else
  log "Certificate for ${DOMAIN} has ${DAYS} day(s) left."
fi

if [ "$FORCE" -ne 1 ] && [ "$DAYS" -ge "$RENEW_WITHIN_DAYS" ]; then
  log "Nothing to do (renews inside ${RENEW_WITHIN_DAYS} days)."
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN — would renew ${DOMAIN} into ${CERT_DIR} and reload nginx."
  exit 0
fi

log "Renewing certificate for ${DOMAIN}..."
# Explicit paths: without them tailscale writes into the working directory and
# nginx never sees the new cert.
if ! as_root tailscale cert --cert-file "$CRT" --key-file "$KEY" "$DOMAIN"; then
  status=$?
  log "FAILED to renew (exit ${status})."
  if [ "$(id -u)" -ne 0 ]; then
    log "If this was a sudo password prompt, cron cannot answer one — either move this"
    log "line to root's crontab (sudo crontab -e), or allow passwordless sudo for tailscale."
  fi
  exit 1
fi

NEW_DAYS=$(days_left) || NEW_DAYS=""
log "Renewed. Certificate now has ${NEW_DAYS:-unknown} day(s) left."

# nginx read the old certificate at startup and will keep serving it until
# told otherwise, so a renewal without this looks like it did nothing.
log "Reloading nginx so it picks up the new certificate..."
if docker compose exec -T frontend nginx -s reload 2>/dev/null; then
  log "nginx reloaded."
elif docker compose restart frontend >/dev/null 2>&1; then
  log "nginx reload failed; restarted the frontend container instead."
else
  log "WARNING: renewed on disk, but nginx is still serving the OLD certificate."
  log "Run: docker compose restart frontend"
  exit 1
fi

log "Done."
