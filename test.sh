#!/usr/bin/env bash
# ============================================================
#  Skynet Music — Feature Regression Tests
#  Tests every API endpoint and feature end-to-end.
#  Run from the project root: bash test.sh
#  Requires ADMIN_PASSWORD set in .env (or env).
#  UPDATE THIS FILE whenever a new API route or feature is added.
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

PASS=0; WARN=0; FAIL=0; FAILURES=()

pass() { printf "  ${GREEN}✓${NC} %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; WARN=$((WARN+1)); }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAIL=$((FAIL+1)); FAILURES+=("$1"); }
info() { printf "  ${DIM}·${NC} %s\n" "$1"; }
hdr()  { printf "\n${BOLD}${CYAN}── %s ${NC}\n" "$*"; }

# ── Load .env ────────────────────────────────────────────────
if [ -f .env ]; then
  set -a; source .env 2>/dev/null || true; set +a
fi

HTTPS_PORT=${HTTPS_PORT:-4000}
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
BASE="https://localhost:${HTTPS_PORT}"
COOKIE=$(mktemp); trap 'rm -f "$COOKIE"' EXIT
C="curl -sk --max-time 10"

printf "\n${BOLD}Skynet Music — Feature Regression Tests${NC}  $(date '+%Y-%m-%d %H:%M:%S')\n"
info "Target: ${BASE}"

if [ -z "${ADMIN_PASSWORD:-}" ]; then
  printf "\n  ${RED}✗ ADMIN_PASSWORD not set — cannot run tests. Add it to .env.${NC}\n\n"
  exit 1
fi

# ════════════════════════════════════════════════════════════
hdr "Auth"
# ════════════════════════════════════════════════════════════

LOGIN=$($C -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  -c "$COOKIE" 2>/dev/null)
if echo "$LOGIN" | grep -qE '"user"|"token"'; then
  pass "POST /api/auth/login → authenticated"
else
  fail "POST /api/auth/login → $(echo "$LOGIN" | grep -oP '"error":"\K[^"]+' || echo 'no response')"
  printf "\n  ${RED}Cannot continue without auth.${NC}\n\n"; exit 1
fi

ME=$($C -b "$COOKIE" "${BASE}/api/auth/me")
if echo "$ME" | grep -q '"username"'; then
  pass "GET /api/auth/me → user info returned"
else
  fail "GET /api/auth/me → unexpected: ${ME}"
fi

# ════════════════════════════════════════════════════════════
hdr "Health"
# ════════════════════════════════════════════════════════════

HEALTH=$($C "${BASE}/api/health")
if echo "$HEALTH" | grep -q '"ok"'; then
  pass "GET /api/health → ok"
else
  fail "GET /api/health → ${HEALTH:-no response}"
fi

# ════════════════════════════════════════════════════════════
hdr "Music Library"
# ════════════════════════════════════════════════════════════

SONGS=$($C -b "$COOKIE" "${BASE}/api/music")
if echo "$SONGS" | grep -q '^\['; then
  SONG_COUNT=$(echo "$SONGS" | python3 -c "import sys,json; a=json.load(sys.stdin); print(len(a))" 2>/dev/null || echo "?")
  if [ "$SONG_COUNT" = "0" ]; then
    warn "GET /api/music → library empty (0 songs) — stream/cover tests will be skipped"
  else
    pass "GET /api/music → ${SONG_COUNT} songs"
  fi
else
  fail "GET /api/music → not a JSON array"
  SONG_COUNT="0"
fi

if [ "${SONG_COUNT:-0}" != "0" ] && [ "${SONG_COUNT:-0}" != "?" ]; then
  FIRST_ID=$(echo "$SONGS" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'])" 2>/dev/null || echo "")
  HAS_COVER=$(echo "$SONGS" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0].get('has_cover','false'))" 2>/dev/null || echo "false")

  if [ -n "$FIRST_ID" ]; then
    STREAM_CODE=$($C -b "$COOKIE" -o /dev/null -w "%{http_code}" "${BASE}/api/music/${FIRST_ID}/stream")
    if [ "$STREAM_CODE" = "200" ] || [ "$STREAM_CODE" = "206" ]; then
      pass "GET /api/music/:id/stream → HTTP ${STREAM_CODE}"
    else
      fail "GET /api/music/:id/stream → HTTP ${STREAM_CODE}"
    fi

    if [ "$HAS_COVER" = "True" ] || [ "$HAS_COVER" = "true" ] || [ "$HAS_COVER" = "1" ]; then
      COVER_CODE=$($C -b "$COOKIE" -o /dev/null -w "%{http_code}" "${BASE}/api/music/${FIRST_ID}/cover")
      if [ "$COVER_CODE" = "200" ]; then
        pass "GET /api/music/:id/cover → HTTP 200"
      else
        fail "GET /api/music/:id/cover → HTTP ${COVER_CODE}"
      fi
    else
      info "GET /api/music/:id/cover → skipped (first song has no cover)"
    fi
  fi

  # Search
  FIRST_TITLE=$(echo "$SONGS" | python3 -c "import sys,json; a=json.load(sys.stdin); print((a[0].get('title','') or '')[:4])" 2>/dev/null || echo "")
  if [ -n "$FIRST_TITLE" ]; then
    SEARCH_RESP=$($C -b "$COOKIE" "${BASE}/api/music?search=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${FIRST_TITLE}'))" 2>/dev/null || echo "$FIRST_TITLE")")
    if echo "$SEARCH_RESP" | grep -q '^\['; then
      pass "GET /api/music?search=… → returns results"
    else
      fail "GET /api/music?search=… → unexpected response"
    fi
  fi
fi

# Scan endpoint (just check it responds, don't trigger a full scan)
SCAN_CODE=$($C -b "$COOKIE" -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/music/scan")
if [ "$SCAN_CODE" = "200" ] || [ "$SCAN_CODE" = "202" ]; then
  pass "POST /api/music/scan → HTTP ${SCAN_CODE}"
else
  fail "POST /api/music/scan → HTTP ${SCAN_CODE}"
fi

# ════════════════════════════════════════════════════════════
hdr "Home Feed & Collections"
# ════════════════════════════════════════════════════════════

HOME=$($C -b "$COOKIE" "${BASE}/api/home")
if [ -n "$HOME" ] && [ "$HOME" != "null" ]; then
  pass "GET /api/home → responding"
else
  fail "GET /api/home → empty/null"
fi

FEATURED=$($C -b "$COOKIE" "${BASE}/api/featured")
if echo "$FEATURED" | grep -q '^\['; then
  FEAT_COUNT=$(echo "$FEATURED" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
  pass "GET /api/featured → ${FEAT_COUNT} collection(s)"
else
  warn "GET /api/featured → unexpected response (may be empty)"
fi

MIXES=$($C -b "$COOKIE" "${BASE}/api/mixes")
if echo "$MIXES" | grep -q '^\['; then
  MIX_COUNT=$(echo "$MIXES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
  pass "GET /api/mixes → ${MIX_COUNT} mix(es)"
else
  warn "GET /api/mixes → unexpected response (may be empty)"
fi

# ════════════════════════════════════════════════════════════
hdr "User Data (Likes & Playlists)"
# ════════════════════════════════════════════════════════════

LIKES=$($C -b "$COOKIE" "${BASE}/api/me/data/likes")
if echo "$LIKES" | grep -qE '^\{|^\[|null'; then
  pass "GET /api/me/data/likes → accessible"
else
  fail "GET /api/me/data/likes → unexpected: ${LIKES}"
fi

PLAYLISTS_RESP=$($C -b "$COOKIE" "${BASE}/api/me/data/playlists")
if echo "$PLAYLISTS_RESP" | grep -qE '^\{|^\[|null'; then
  pass "GET /api/me/data/playlists → accessible"
else
  fail "GET /api/me/data/playlists → unexpected: ${PLAYLISTS_RESP}"
fi

# Like/unlike a song (round-trip test)
if [ -n "${FIRST_ID:-}" ]; then
  # Get current likes
  CURRENT_LIKES=$(echo "$LIKES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('data',[]) if isinstance(d,dict) else []))" 2>/dev/null || echo "[]")
  # Add the song
  NEW_LIKES=$(python3 -c "import json,sys; likes=json.loads('${CURRENT_LIKES}'); likes.append('${FIRST_ID}') if '${FIRST_ID}' not in likes else None; print(json.dumps(likes))" 2>/dev/null || echo "[]")
  LIKE_CODE=$($C -b "$COOKIE" -o /dev/null -w "%{http_code}" -X PUT "${BASE}/api/me/data/likes" \
    -H "Content-Type: application/json" -d "{\"data\":${NEW_LIKES}}")
  if [ "$LIKE_CODE" = "200" ]; then
    pass "PUT /api/me/data/likes → like saved (HTTP 200)"
    # Restore original
    $C -b "$COOKIE" -X PUT "${BASE}/api/me/data/likes" \
      -H "Content-Type: application/json" -d "{\"data\":${CURRENT_LIKES}}" >/dev/null
  else
    fail "PUT /api/me/data/likes → HTTP ${LIKE_CODE}"
  fi
fi

# ════════════════════════════════════════════════════════════
hdr "Stats"
# ════════════════════════════════════════════════════════════

STATS=$($C -b "$COOKIE" "${BASE}/api/me/stats")
if echo "$STATS" | grep -q '"totals"'; then
  PLAYS=$(echo "$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totals',{}).get('total_plays',0))" 2>/dev/null || echo "?")
  pass "GET /api/me/stats → ${PLAYS} total plays"
else
  fail "GET /api/me/stats → unexpected: ${STATS}"
fi

LIB_STATS=$($C -b "$COOKIE" "${BASE}/api/me/stats/library")
if [ -n "$LIB_STATS" ] && [ "$LIB_STATS" != "null" ]; then
  pass "GET /api/me/stats/library → responding"
else
  fail "GET /api/me/stats/library → empty/null"
fi

if [ -n "${FIRST_ID:-}" ]; then
  PLAY_CODE=$($C -b "$COOKIE" -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/me/stats/play" \
    -H "Content-Type: application/json" -d "{\"songId\":\"${FIRST_ID}\",\"durationSeconds\":30}")
  if [ "$PLAY_CODE" = "200" ] || [ "$PLAY_CODE" = "204" ]; then
    pass "POST /api/me/stats/play → HTTP ${PLAY_CODE}"
  else
    fail "POST /api/me/stats/play → HTTP ${PLAY_CODE}"
  fi
fi

# ════════════════════════════════════════════════════════════
hdr "YouTube Search & Download"
# ════════════════════════════════════════════════════════════

info "YouTube search may take ~20s (goes through VPN)…"
YT=$($C --max-time 30 -b "$COOKIE" "${BASE}/api/youtube/search?q=test&limit=1")
if echo "$YT" | grep -qE '^\[|\{\}'; then
  YT_COUNT=$(echo "$YT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
  pass "GET /api/youtube/search → ${YT_COUNT} result(s)"
else
  warn "GET /api/youtube/search → unexpected (VPN may be slow): ${YT:0:80}"
fi

YT_STATUS=$($C -b "$COOKIE" "${BASE}/api/youtube/download/status/nonexistent-id")
if [ "$YT_STATUS" = "404" ] || echo "$YT_STATUS" | grep -q '"error"'; then
  pass "GET /api/youtube/download/status/:id → 404 for unknown job"
else
  warn "GET /api/youtube/download/status/:id → unexpected: ${YT_STATUS}"
fi

# ════════════════════════════════════════════════════════════
hdr "Radio / Last.fm"
# ════════════════════════════════════════════════════════════

if [ -n "${LASTFM_API_KEY:-}" ]; then
  # Verify key is inside the container
  BACKEND_KEY=$(docker exec -i "$(docker ps -q --filter 'label=com.docker.compose.service=backend' | head -1)" \
    sh -c 'echo "$LASTFM_API_KEY"' 2>/dev/null | tr -d '\r\n')
  if [ "$BACKEND_KEY" = "$LASTFM_API_KEY" ]; then
    pass "LASTFM_API_KEY present inside backend container"
  else
    fail "LASTFM_API_KEY mismatch or missing in container — re-run bash deploy.sh"
  fi

  SUGG=$($C --max-time 15 -b "$COOKIE" "${BASE}/api/radio/suggestions?artist=Radiohead&title=Creep")
  if echo "$SUGG" | grep -q '^\['; then
    SUGG_COUNT=$(echo "$SUGG" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    pass "GET /api/radio/suggestions → ${SUGG_COUNT} suggestion(s)"
  else
    fail "GET /api/radio/suggestions → unexpected: ${SUGG:0:120}"
  fi

  # Start a radio download and verify jobId returned
  DL_RESP=$($C -b "$COOKIE" -X POST "${BASE}/api/radio/download" \
    -H "Content-Type: application/json" \
    -d '{"artist":"Radiohead","title":"Creep"}')
  JOB_ID=$(echo "$DL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobId',''))" 2>/dev/null || echo "")
  if [ -n "$JOB_ID" ]; then
    pass "POST /api/radio/download → jobId: ${JOB_ID:0:16}…"

    STATUS=$($C -b "$COOKIE" "${BASE}/api/radio/status/${JOB_ID}")
    if echo "$STATUS" | grep -q '"status"'; then
      JOB_STATUS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?")
      pass "GET /api/radio/status/:id → status=${JOB_STATUS}"
    else
      fail "GET /api/radio/status/:id → unexpected: ${STATUS}"
    fi
  else
    fail "POST /api/radio/download → no jobId returned: ${DL_RESP}"
  fi
else
  warn "LASTFM_API_KEY not set — radio tests skipped"
fi

# ════════════════════════════════════════════════════════════
hdr "Import"
# ════════════════════════════════════════════════════════════

IMP=$($C -b "$COOKIE" "${BASE}/api/import/status")
if [ "$IMP" = "null" ]; then
  pass "GET /api/import/status → no active job (null)"
elif echo "$IMP" | grep -q '"status"'; then
  IMP_S=$(echo "$IMP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?")
  warn "GET /api/import/status → active job detected (status: ${IMP_S})"
else
  fail "GET /api/import/status → unexpected: ${IMP}"
fi

# ════════════════════════════════════════════════════════════
hdr "Queue & Player (API layer)"
# ════════════════════════════════════════════════════════════

# These are client-side features; verify the data they depend on is healthy
if [ "${SONG_COUNT:-0}" != "0" ] && [ "${SONG_COUNT:-0}" != "?" ]; then
  pass "Library has ${SONG_COUNT} songs — queue, shuffle, radio all have data to work with"
  # Verify all songs have valid IDs (queue pipeline depends on this)
  BAD=$(echo "$SONGS" | python3 -c "
import sys,json
a=json.load(sys.stdin)
bad=[s for s in a if not s.get('id')]
print(len(bad))
" 2>/dev/null || echo "?")
  if [ "$BAD" = "0" ]; then
    pass "All songs have valid IDs (queue/radio pipeline OK)"
  else
    fail "${BAD} songs missing IDs — queue pipeline will break"
  fi
else
  warn "No songs in library — queue, shuffle, radio cannot be tested"
fi

# ════════════════════════════════════════════════════════════
hdr "Auth Cleanup"
# ════════════════════════════════════════════════════════════

LOGOUT_CODE=$($C -b "$COOKIE" -c "$COOKIE" -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/auth/logout")
if [ "$LOGOUT_CODE" = "200" ] || [ "$LOGOUT_CODE" = "204" ]; then
  pass "POST /api/auth/logout → HTTP ${LOGOUT_CODE}"
else
  warn "POST /api/auth/logout → HTTP ${LOGOUT_CODE}"
fi

# Confirm session is gone
AUTHED_AFTER=$($C -b "$COOKIE" -o /dev/null -w "%{http_code}" "${BASE}/api/music")
if [ "$AUTHED_AFTER" = "401" ]; then
  pass "Session invalidated after logout (401)"
else
  warn "Session still active after logout? Got HTTP ${AUTHED_AFTER}"
fi

# ════════════════════════════════════════════════════════════
hdr "Summary"
# ════════════════════════════════════════════════════════════

TOTAL=$((PASS + WARN + FAIL))
printf "\n  ${GREEN}✓ %d passed${NC}  ${YELLOW}⚠ %d warnings${NC}  ${RED}✗ %d failed${NC}  (%d total)\n\n" \
  "$PASS" "$WARN" "$FAIL" "$TOTAL"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf "${RED}${BOLD}Failed:${NC}\n"
  for f in "${FAILURES[@]}"; do printf "  ${RED}✗${NC} %s\n" "$f"; done
  printf "\n"; exit 1
fi

if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  printf "${GREEN}${BOLD}All feature tests passed.${NC}\n\n"
elif [ "$FAIL" -eq 0 ]; then
  printf "${YELLOW}${BOLD}Tests passed with ${WARN} warning(s).${NC}\n\n"
fi
