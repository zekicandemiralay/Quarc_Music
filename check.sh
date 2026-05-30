#!/usr/bin/env bash
# ============================================================
#  Skynet Music — Full System Diagnostic
#  Run from the project root: bash check.sh
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

PASS=0; WARN=0; FAIL=0; FAILURES=()

ok()   { printf "  ${GREEN}✓${NC} %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; WARN=$((WARN+1)); }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAIL=$((FAIL+1)); FAILURES+=("$1"); }
info() { printf "  ${DIM}·${NC} %s\n" "$1"; }
hdr()  { printf "\n${BOLD}${CYAN}── %s ${NC}\n" "$*"; }

# ── Load .env ────────────────────────────────────────────────────────────
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
else
  warn "No .env file found in current directory"
fi

HTTPS_PORT=${HTTPS_PORT:-443}
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
BASE="https://localhost:${HTTPS_PORT}"
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

# Resolve container IDs scoped to THIS compose project (avoids matching other projects on the same host)
PROJECT=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/_/g')
cid() { docker ps -q \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=$1" | head -1; }
dexec() { local c; c=$(cid "$1"); shift; [ -n "$c" ] && docker exec -i "$c" "$@" || echo ""; }

printf "\n${BOLD}Skynet Music — System Diagnostic${NC}  $(date '+%Y-%m-%d %H:%M:%S')\n"
if ! docker info &>/dev/null 2>&1; then
  printf "  ${RED}✗ Docker not accessible — re-run as root: sudo bash check.sh${NC}\n\n"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════
hdr "System Resources"
# ════════════════════════════════════════════════════════════════════════

# CPU load
LOAD=$(awk '{print $1}' /proc/loadavg)
CORES=$(nproc)
LOAD_INT=$(echo "$LOAD" | cut -d. -f1)
if   [ "$LOAD_INT" -ge "$((CORES * 2))" ]; then fail "CPU load ${LOAD} is critical (${CORES} cores)"
elif [ "$LOAD_INT" -ge "$CORES"         ]; then warn "CPU load ${LOAD} elevated (${CORES} cores)"
else ok "CPU load ${LOAD} (${CORES} cores)"; fi

# RAM
MEM_TOTAL=$(awk '/MemTotal/{print $2}'     /proc/meminfo)
MEM_AVAIL=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
MEM_PCT=$(( (MEM_TOTAL - MEM_AVAIL) * 100 / MEM_TOTAL ))
MEM_USED_MB=$(( (MEM_TOTAL - MEM_AVAIL) / 1024 ))
MEM_TOTAL_MB=$(( MEM_TOTAL / 1024 ))
if   [ "$MEM_PCT" -gt 90 ]; then fail "RAM ${MEM_PCT}% used (${MEM_USED_MB}/${MEM_TOTAL_MB} MB)"
elif [ "$MEM_PCT" -gt 75 ]; then warn "RAM ${MEM_PCT}% used (${MEM_USED_MB}/${MEM_TOTAL_MB} MB)"
else ok "RAM ${MEM_PCT}% used (${MEM_USED_MB}/${MEM_TOTAL_MB} MB)"; fi

# Disk (project dir)
DISK_PCT=$(df -h . | awk 'NR==2{gsub(/%/,""); print $5}')
DISK_FREE=$(df -h . | awk 'NR==2{print $4}')
if   [ "$DISK_PCT" -gt 95 ]; then fail "Disk ${DISK_PCT}% full — only ${DISK_FREE} free"
elif [ "$DISK_PCT" -gt 85 ]; then warn "Disk ${DISK_PCT}% full — ${DISK_FREE} free"
else ok "Disk ${DISK_PCT}% used, ${DISK_FREE} free"; fi

# ════════════════════════════════════════════════════════════════════════
hdr "Docker Containers"
# ════════════════════════════════════════════════════════════════════════

for svc in gluetun backend frontend; do
  # Use compose service label — works regardless of project name
  CID=$(docker ps -q --filter "label=com.docker.compose.service=${svc}" | head -1)
  if [ -z "$CID" ]; then
    # Also check stopped containers
    CID_ANY=$(docker ps -aq --filter "label=com.docker.compose.service=${svc}" | head -1)
    [ -n "$CID_ANY" ] && fail "$svc: exists but is stopped/exited" \
                      || fail "$svc: container not found (never started?)"
    continue
  fi
  STATE=$(docker inspect --format '{{.State.Status}}' "$CID" 2>/dev/null || echo "unknown")
  HEALTH=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID" 2>/dev/null || echo "none")
  if [ "$STATE" = "running" ]; then
    if   [ "$HEALTH" = "unhealthy" ]; then fail "$svc: running but UNHEALTHY"
    elif [ "$HEALTH" = "starting"  ]; then warn "$svc: running — health check still starting"
    else ok "$svc: running [health: ${HEALTH}]"; fi
  else
    fail "$svc: state=${STATE}"
  fi
done

info "All running containers:"
docker ps --format "  · {{.Names}}\t{{.Status}}" 2>/dev/null | head -10

# ════════════════════════════════════════════════════════════════════════
hdr "VPN (Gluetun)"
# ════════════════════════════════════════════════════════════════════════

# Check TCP reachability of gluetun proxy from backend using node (no curl in container)
VPN_REACH=$(dexec backend node -e "
  const net = require('net');
  const s = net.connect(8888, 'gluetun');
  s.on('connect', () => { console.log('ok'); s.destroy(); process.exit(0); });
  s.on('error',   () => { console.log('fail'); process.exit(1); });
  setTimeout(() => { console.log('fail'); process.exit(1); }, 8000);
" 2>/dev/null || echo "fail")
if [ "$VPN_REACH" = "ok" ]; then
  ok "VPN proxy (gluetun:8888) reachable from backend — full test via yt-dlp below"
else
  fail "VPN proxy (gluetun:8888) unreachable from backend"
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Network & HTTPS"
# ════════════════════════════════════════════════════════════════════════

# HTTPS frontend
HTTPS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 \
  "${BASE}/" 2>/dev/null || echo 0)
if [ "$HTTPS_CODE" = "200" ]; then
  ok "HTTPS:${HTTPS_PORT} serving frontend (200)"
else
  fail "HTTPS:${HTTPS_PORT} not responding (got: ${HTTPS_CODE})"
fi

# SSL cert expiry
CERT_EXP=$(echo | openssl s_client -connect "localhost:${HTTPS_PORT}" \
  -servername localhost 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "")
if [ -n "$CERT_EXP" ]; then
  EXP_EPOCH=$(date -d "$CERT_EXP" +%s 2>/dev/null || echo 0)
  DAYS=$(( (EXP_EPOCH - $(date +%s)) / 86400 ))
  if   [ "$DAYS" -lt 7  ]; then fail "SSL cert expires in ${DAYS} days! Renew now."
  elif [ "$DAYS" -lt 30 ]; then warn "SSL cert expires in ${DAYS} days"
  else ok "SSL cert valid for ${DAYS} more days"; fi
else
  warn "Could not read SSL certificate (self-signed or nginx not up)"
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Backend API"
# ════════════════════════════════════════════════════════════════════════

# Public health endpoint
HEALTH_RESP=$(curl -sk --max-time 5 "${BASE}/api/health" 2>/dev/null || echo "")
if echo "$HEALTH_RESP" | grep -q '"ok"'; then
  ok "GET /api/health → ok"
else
  fail "GET /api/health → ${HEALTH_RESP:-no response}"
fi

# Auth
AUTHED=false
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  LOGIN_RESP=$(curl -sk --max-time 10 \
    -X POST "${BASE}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    -c "$COOKIE" 2>/dev/null || echo "")
  if echo "$LOGIN_RESP" | grep -qE '"user"|"token"'; then
    ok "POST /api/auth/login → authenticated as '${ADMIN_USERNAME}'"
    AUTHED=true
  else
    ERR=$(echo "$LOGIN_RESP" | grep -oP '"error":"\K[^"]+' || echo "check password")
    warn "Login failed (${ERR}) — skipping authenticated checks"
  fi
else
  warn "ADMIN_PASSWORD not set in .env — skipping authenticated API checks"
fi

if $AUTHED; then
  # Music library
  SONGS_RESP=$(curl -sk --max-time 10 -b "$COOKIE" "${BASE}/api/music" 2>/dev/null || echo "ERR")
  if echo "$SONGS_RESP" | grep -q '^\['; then
    SONG_COUNT=$(echo "$SONGS_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    if   [ "$SONG_COUNT" = "0" ]; then warn "GET /api/music → library is empty"
    elif [ "$SONG_COUNT" = "?" ]; then warn "GET /api/music → response parse error"
    else ok "GET /api/music → ${SONG_COUNT} songs in library"; fi
  else
    fail "GET /api/music → bad response"
  fi

  # Import status
  IMP_RESP=$(curl -sk --max-time 5 -b "$COOKIE" "${BASE}/api/import/status" 2>/dev/null || echo "ERR")
  if [ "$IMP_RESP" = "null" ]; then
    ok "GET /api/import/status → no active job"
  elif echo "$IMP_RESP" | grep -q '"status"'; then
    IMP_STATUS=$(echo "$IMP_RESP" | grep -oP '"status":"\K[^"]+' | head -1 || echo "?")
    IMP_DONE=$(echo "$IMP_RESP" | grep -oP '"done":\K\d+' | head -1 || echo "?")
    IMP_TOTAL=$(echo "$IMP_RESP" | grep -oP '"total":\K\d+' | head -1 || echo "?")
    warn "GET /api/import/status → active job (status: ${IMP_STATUS}, ${IMP_DONE}/${IMP_TOTAL} done)"
  else
    fail "GET /api/import/status → unexpected: ${IMP_RESP}"
  fi

  # User stats
  STATS_RESP=$(curl -sk --max-time 5 -b "$COOKIE" "${BASE}/api/me/stats" 2>/dev/null || echo "")
  if echo "$STATS_RESP" | grep -q '"totals"'; then
    PLAYS=$(echo "$STATS_RESP" | grep -oP '"total_plays":\K\d+' | head -1 || echo "?")
    ok "GET /api/me/stats → ${PLAYS} total plays recorded"
  else
    fail "GET /api/me/stats → bad response"
  fi

  # Home feed
  HOME_RESP=$(curl -sk --max-time 5 -b "$COOKIE" "${BASE}/api/home" 2>/dev/null || echo "")
  [ -n "$HOME_RESP" ] && ok "GET /api/home → responding" || fail "GET /api/home → no response"

  # YouTube search (direct, no VPN — tests the youtube route itself)
  YT_ROUTE=$(curl -sk --max-time 10 -b "$COOKIE" \
    "${BASE}/api/youtube/search?q=test&limit=1" 2>/dev/null || echo "")
  if echo "$YT_ROUTE" | grep -qE '^\[|\{\}'; then
    ok "GET /api/youtube/search → endpoint reachable"
  else
    warn "GET /api/youtube/search → unexpected response (yt-dlp may be slow)"
  fi
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Database"
# ════════════════════════════════════════════════════════════════════════

DB_RESULT=$(dexec backend node -e "
  try {
    const { getDb } = require('/app/src/db');
    const db = getDb();
    const songs     = db.prepare('SELECT COUNT(*) as c FROM songs').get().c;
    const users     = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const downloads = db.prepare('SELECT COUNT(*) as c FROM downloads').get().c;
    const pending   = db.prepare(\"SELECT COUNT(*) as c FROM downloads WHERE status='pending' OR status='downloading'\").get().c;
    const wal       = Object.values(db.prepare('PRAGMA journal_mode').get())[0];
    console.log(JSON.stringify({ songs, users, downloads, pending, wal }));
  } catch(e) {
    console.log(JSON.stringify({ error: e.message }));
  }
" 2>/dev/null || echo '{"error":"exec failed"}')

if echo "$DB_RESULT" | grep -q '"error"'; then
  ERR=$(echo "$DB_RESULT" | grep -oP '"error":"\K[^"]+' || echo "unknown")
  fail "Database check failed: ${ERR}"
else
  DB_SONGS=$(echo "$DB_RESULT" | grep -oP '"songs":\K\d+'     || echo "?")
  DB_USERS=$(echo "$DB_RESULT" | grep -oP '"users":\K\d+'     || echo "?")
  DB_DL=$(echo "$DB_RESULT"    | grep -oP '"downloads":\K\d+' || echo "?")
  DB_PEND=$(echo "$DB_RESULT"  | grep -oP '"pending":\K\d+'   || echo "0")
  DB_WAL=$(echo "$DB_RESULT"   | grep -oP '"wal":"\K[^"]+'    || echo "?")
  ok "DB accessible — ${DB_SONGS} songs, ${DB_USERS} users, ${DB_DL} downloads"
  DB_SIZE_HUMAN=$(dexec backend du -sh /app/data/music.db 2>/dev/null | awk '{print $1}' || echo "?")
  info "DB size: ${DB_SIZE_HUMAN}"
  [ "$DB_WAL" = "wal" ] && ok "SQLite WAL mode enabled" || warn "SQLite journal mode: ${DB_WAL} (expected wal)"
  [ "${DB_PEND:-0}" -gt 10 ] && warn "${DB_PEND} downloads stuck in pending/downloading state" || true
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Duplicate Songs"
# ════════════════════════════════════════════════════════════════════════

DUPE_RESULT=$(dexec backend node -e "
  try {
    const { getDb } = require('/app/src/db');
    const db = getDb();
    function norm(s) {
      return (s || '').replace(/ı/g, 'i')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim();
    }
    const all = db.prepare('SELECT id, title, artist FROM songs').all();
    const groups = {};
    for (const s of all) {
      const key = norm(s.title) + '||' + norm(s.artist || '');
      (groups[key] = groups[key] || []).push(s);
    }
    const dupes = Object.values(groups).filter(g => g.length > 1);
    const extra = dupes.reduce((n, g) => n + g.length - 1, 0);
    console.log(JSON.stringify({ groups: dupes.length, extra }));
  } catch(e) {
    console.log(JSON.stringify({ error: e.message }));
  }
" 2>/dev/null || echo '{"error":"exec failed"}')

if echo "$DUPE_RESULT" | grep -q '"error"'; then
  warn "Could not check duplicates: $(echo "$DUPE_RESULT" | grep -oP '"error":"\K[^"]+' || echo "unknown")"
else
  DUPE_GROUPS=$(echo "$DUPE_RESULT" | grep -oP '"groups":\K\d+' || echo "0")
  DUPE_EXTRA=$(echo "$DUPE_RESULT"  | grep -oP '"extra":\K\d+'  || echo "0")
  if [ "${DUPE_GROUPS:-0}" -gt 0 ]; then
    warn "${DUPE_GROUPS} duplicate group(s) found — ${DUPE_EXTRA} extra song(s) to remove → run: bash dedupe.sh"
  else
    ok "No duplicate songs found"
  fi
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Music Library (Disk)"
# ════════════════════════════════════════════════════════════════════════

FILE_COUNT=$(dexec backend \
  find /music -type f \( -name "*.mp3" -o -name "*.flac" -o -name "*.wav" \
    -o -name "*.m4a" -o -name "*.ogg" -o -name "*.opus" -o -name "*.aac" \) \
  2>/dev/null | wc -l || echo "?")
if   [ "$FILE_COUNT" = "0" ]; then warn "No audio files found in /music"
elif [ "$FILE_COUNT" = "?" ]; then warn "Could not count files in /music"
else ok "${FILE_COUNT} audio files on disk"; fi

# Writable check
if dexec backend sh -c 'touch /music/.skynet_write_test && rm /music/.skynet_write_test' 2>/dev/null; then
  ok "Music directory is writable"
else
  fail "Music directory is NOT writable — downloads will fail"
fi

# Disk space for music
MDISK_PCT=$(dexec backend df /music 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}' || echo "")
MDISK_FREE=$(dexec backend df -h /music 2>/dev/null | awk 'NR==2{print $4}' || echo "?")
if [ -z "$MDISK_PCT" ]; then
  info "Music disk: could not read"
elif [ "$MDISK_PCT" -gt 95 ] 2>/dev/null; then fail "Music disk ${MDISK_PCT}% full — only ${MDISK_FREE} free"
elif [ "$MDISK_PCT" -gt 85 ] 2>/dev/null; then warn "Music disk ${MDISK_PCT}% used — ${MDISK_FREE} free"
else info "Music disk: ${MDISK_PCT}% used, ${MDISK_FREE} free"; fi

# ════════════════════════════════════════════════════════════════════════
hdr "yt-dlp"
# ════════════════════════════════════════════════════════════════════════

YTVER=$(dexec backend yt-dlp --version 2>/dev/null | tr -d '\r\n' || echo "")
if [ -n "$YTVER" ]; then
  ok "yt-dlp installed — version ${YTVER}"
else
  fail "yt-dlp not found in backend container"
fi

info "Testing YouTube search via VPN proxy (may take ~20s)..."
YT_RESULT=$(dexec backend yt-dlp \
  --proxy http://gluetun:8888 \
  "ytsearch1:Rick Astley Never Gonna Give You Up" \
  --dump-json --flat-playlist --no-warnings \
  --socket-timeout 15 2>/dev/null | head -1 || echo "")
YT_ID=$(echo "$YT_RESULT" | grep -oP '"id":\s*"\K[^"]+' | head -1 || echo "")
if [ -n "$YT_ID" ]; then
  ok "YouTube search OK via VPN — got video ID: ${YT_ID}"
else
  fail "YouTube search failed — VPN down, or YouTube blocking yt-dlp"
fi

info "YTDLP_RATE_LIMIT: ${YTDLP_RATE_LIMIT:-unlimited (not set)}"
[ -n "${YTDLP_PROXY:-}" ] && info "YTDLP_PROXY: ${YTDLP_PROXY}" || true

# ════════════════════════════════════════════════════════════════════════
hdr "Last.fm / Radio"
# ════════════════════════════════════════════════════════════════════════

if [ -n "${LASTFM_API_KEY:-}" ]; then
  # 1. Verify the key made it into the backend container
  BACKEND_FM_KEY=$(dexec backend sh -c 'echo "$LASTFM_API_KEY"' 2>/dev/null | tr -d '\r\n')
  if [ -z "$BACKEND_FM_KEY" ]; then
    fail "LASTFM_API_KEY is set in .env but NOT present inside the backend container — re-run: bash deploy.sh"
  elif [ "$BACKEND_FM_KEY" != "$LASTFM_API_KEY" ]; then
    fail "LASTFM_API_KEY mismatch: .env has '${LASTFM_API_KEY}' but backend has '${BACKEND_FM_KEY}'"
  else
    ok "LASTFM_API_KEY present inside backend container"
  fi

  # 2. Test the key against Last.fm directly from the host
  FM_RESP=$(curl -s --max-time 10 \
    "http://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=Radiohead&track=Creep&api_key=${LASTFM_API_KEY}&format=json&limit=1" \
    2>/dev/null || echo "")
  if echo "$FM_RESP" | grep -q '"similartracks"'; then
    ok "Last.fm API key valid — similar tracks returned"
  else
    FM_ERR=$(echo "$FM_RESP" | grep -oP '"message":"\K[^"]+' || echo "unexpected response")
    fail "Last.fm API error: ${FM_ERR}"
  fi

  # 3. Test the /api/radio/suggestions endpoint through the app
  if $AUTHED; then
    RADIO_RESP=$(curl -sk --max-time 15 -b "$COOKIE" \
      "${BASE}/api/radio/suggestions?artist=Radiohead&title=Creep" 2>/dev/null || echo "")
    if echo "$RADIO_RESP" | grep -q '\['; then
      SUGG_COUNT=$(echo "$RADIO_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
      ok "GET /api/radio/suggestions → ${SUGG_COUNT} suggestion(s) returned"
    else
      fail "GET /api/radio/suggestions → unexpected: ${RADIO_RESP:-no response}"
    fi
  fi
else
  warn "LASTFM_API_KEY not set in .env — Radio will use library-only fallback"
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Tailscale"
# ════════════════════════════════════════════════════════════════════════

if command -v tailscale &>/dev/null; then
  TS_IP=$(tailscale ip 2>/dev/null | head -1 || echo "?")
  TS_STATE="unknown"
  if tailscale status &>/dev/null; then TS_STATE="Running"; fi
  if [ "$TS_STATE" = "Running" ]; then
    ok "Tailscale running — this node: ${TS_IP}"
  else
    warn "Tailscale state: ${TS_STATE}"
  fi
  # Show peer summary
  tailscale status 2>/dev/null | grep -vE '^#|^$' | \
    awk '{printf "  · %-18s  %-8s  %s\n", $2, $4, $5}' | head -8
else
  warn "Tailscale not installed on this host"
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Recent Errors in Logs (last 1h)"
# ════════════════════════════════════════════════════════════════════════

for svc in backend frontend gluetun; do
  C=$(cid "$svc")
  ERR_N=0
  if [ -n "$C" ]; then
    ERR_N=$(docker logs "$C" --since 1h 2>&1 \
      | grep -iE '\b(error|fatal|exception|crash|panic)\b' | wc -l)
    ERR_N=${ERR_N:-0}
  fi
  if   [ "$ERR_N" -gt 20 ]; then fail  "$svc: ${ERR_N} error lines in last hour"
  elif [ "$ERR_N" -gt 5  ]; then warn  "$svc: ${ERR_N} error lines in last hour"
  else ok "$svc: ${ERR_N} error lines in last hour"; fi
done

# Show last few actual errors from backend if any
BC=$(cid backend)
if [ -n "$BC" ]; then
  BACKEND_ERRS=$(docker logs "$BC" --since 1h 2>&1 \
    | grep -iE '\b(error|fatal)\b' | tail -5 || echo "")
  if [ -n "$BACKEND_ERRS" ]; then
    info "Last backend errors:"
    while IFS= read -r line; do info "  $line"; done <<< "$BACKEND_ERRS"
  fi
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Summary"
# ════════════════════════════════════════════════════════════════════════

TOTAL=$((PASS + WARN + FAIL))
printf "\n  ${GREEN}✓ %d passed${NC}  ${YELLOW}⚠ %d warnings${NC}  ${RED}✗ %d failed${NC}  (%d total checks)\n\n" \
  "$PASS" "$WARN" "$FAIL" "$TOTAL"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf "${RED}${BOLD}Failed checks:${NC}\n"
  for f in "${FAILURES[@]}"; do
    printf "  ${RED}✗${NC} %s\n" "$f"
  done
  printf "\n"
  exit 1
fi

if   [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  printf "${GREEN}${BOLD}All systems healthy.${NC}\n\n"
elif [ "$FAIL" -eq 0 ]; then
  printf "${YELLOW}${BOLD}System OK with ${WARN} warning(s).${NC}\n\n"
fi
