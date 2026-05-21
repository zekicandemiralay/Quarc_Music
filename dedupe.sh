#!/usr/bin/env bash
# ============================================================
#  Skynet Music — Duplicate Song Cleaner
#  Usage:
#    bash dedupe.sh            — show duplicates, ask for confirmation
#    bash dedupe.sh --dry-run  — show what would be removed, do nothing
#    bash dedupe.sh --fix      — remove without prompting
# ============================================================

DRY_RUN=false
AUTO_FIX=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --fix)     AUTO_FIX=true ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

cid()   { docker ps -q --filter "label=com.docker.compose.service=$1" | head -1; }

printf "\n${BOLD}Skynet Music — Duplicate Cleaner${NC}  $(date '+%Y-%m-%d %H:%M:%S')\n\n"

if ! docker info &>/dev/null 2>&1; then
  printf "  ${RED}✗ Docker not accessible — re-run as root: sudo bash dedupe.sh${NC}\n\n"
  exit 1
fi

BACKEND=$(cid backend)
if [ -z "$BACKEND" ]; then
  printf "  ${RED}✗ Backend container not running${NC}\n\n"
  exit 1
fi

# ── Step 1: detect duplicates ──────────────────────────────────────────────
printf "  Scanning library for duplicates...\n\n"

DUPE_JSON=$(docker exec -i "$BACKEND" node -e "
const { getDb } = require('./src/db');
const fs = require('fs');
const db = getDb();

function norm(s) {
  return (s || '').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

const all = db.prepare('SELECT * FROM songs ORDER BY rowid ASC').all();

const groups = {};
for (const song of all) {
  const key = norm(song.title) + '||' + norm(song.artist || '');
  (groups[key] = groups[key] || []).push(song);
}

const dupes = Object.values(groups)
  .filter(g => g.length > 1)
  .map(group => {
    // Prefer: file exists on disk, then larger file size, then earlier rowid
    const withInfo = group.map(song => {
      let size = 0;
      let exists = false;
      try {
        exists = fs.existsSync(song.filepath);
        if (exists) size = fs.statSync(song.filepath).size;
      } catch {}
      return { ...song, _size: size, _exists: exists };
    });
    withInfo.sort((a, b) => {
      if (a._exists && !b._exists) return -1;
      if (!a._exists && b._exists) return 1;
      return b._size - a._size;
    });
    return { keep: withInfo[0], remove: withInfo.slice(1) };
  });

console.log(JSON.stringify(dupes));
" 2>/dev/null || echo "[]")

if [ -z "$DUPE_JSON" ] || [ "$DUPE_JSON" = "[]" ]; then
  printf "  ${GREEN}✓ No duplicate songs found — library is clean!${NC}\n\n"
  exit 0
fi

DUPE_GROUPS=$(echo "$DUPE_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "?")
REMOVE_TOTAL=$(echo "$DUPE_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(sum(len(g['remove']) for g in d))" 2>/dev/null || echo "?")

printf "  ${YELLOW}⚠ ${DUPE_GROUPS} duplicate groups found — ${REMOVE_TOTAL} song(s) to remove${NC}\n\n"

# ── Display each group ─────────────────────────────────────────────────────
echo "$DUPE_JSON" | python3 - <<'PYEOF'
import sys, json

dupes = json.load(sys.stdin)
for i, g in enumerate(dupes, 1):
    k = g['keep']
    exists_mark = '✓' if k.get('_exists') else '✗'
    size_kb = k.get('_size', 0) // 1024
    print(f"  Group {i}: \"{k['title']}\" — {k['artist'] or 'Unknown'}")
    print(f"    KEEP   [{exists_mark}] {size_kb:>6}KB  {k['filepath']}")
    for r in g['remove']:
        ex = '✓' if r.get('_exists') else '✗ (missing)'
        sz = r.get('_size', 0) // 1024
        print(f"    REMOVE [{ex}] {sz:>6}KB  {r['filepath']}")
    print()
PYEOF

if $DRY_RUN; then
  printf "  ${CYAN}Dry run — nothing was changed.${NC}\n\n"
  exit 0
fi

# ── Confirm ────────────────────────────────────────────────────────────────
if ! $AUTO_FIX; then
  printf "  ${YELLOW}This will:${NC}\n"
  printf "    • Delete ${REMOVE_TOTAL} file(s) from disk\n"
  printf "    • Remove their rows from the database\n"
  printf "    • Update playlists and liked songs to use the kept song\n\n"
  printf "  Proceed? [y/N] "
  read -r CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    printf "\n  Aborted — nothing was changed.\n\n"
    exit 0
  fi
  printf "\n"
fi

# ── Step 2: execute cleanup (pass JSON via stdin) ──────────────────────────
printf "  Removing duplicates...\n"

RESULT=$(echo "$DUPE_JSON" | docker exec -i "$BACKEND" node -e "
const { getDb } = require('./src/db');
const fs = require('fs');
const db = getDb();

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  let dupes;
  try { dupes = JSON.parse(Buffer.concat(chunks).toString()); }
  catch(e) { console.log(JSON.stringify({ error: 'Bad JSON input: ' + e.message })); return; }

  let filesRemoved = 0, dbRemoved = 0, refsUpdated = 0;
  const errors = [];

  // Wrap everything in a transaction for atomicity
  const run = db.transaction(() => {
    for (const group of dupes) {
      const keepId = group.keep.id;

      for (const song of group.remove) {
        // Delete file from disk
        try {
          if (fs.existsSync(song.filepath)) { fs.unlinkSync(song.filepath); filesRemoved++; }
        } catch(e) { errors.push('file:' + song.filepath + ':' + e.message); }

        // Remove from songs table
        try { db.prepare('DELETE FROM songs WHERE id = ?').run(song.id); dbRemoved++; }
        catch(e) { errors.push('db:' + song.id + ':' + e.message); }

        // Update listening_history to the kept song
        try { db.prepare('UPDATE listening_history SET song_id = ? WHERE song_id = ?').run(keepId, song.id); }
        catch {}

        // Update all users' playlists and liked_songs
        try {
          const users = db.prepare('SELECT DISTINCT user_id FROM user_data').all();
          for (const { user_id } of users) {
            // Playlists
            const plRow = db.prepare(
              'SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?'
            ).get(user_id, 'playlists');
            if (plRow) {
              let pls = JSON.parse(plRow.data_json);
              let changed = false;
              for (const pl of pls) {
                const idx = pl.songs.indexOf(song.id);
                if (idx === -1) continue;
                if (!pl.songs.includes(keepId)) {
                  pl.songs[idx] = keepId;   // replace with kept ID
                } else {
                  pl.songs.splice(idx, 1);  // already has kept ID — just remove
                }
                changed = true;
                refsUpdated++;
              }
              if (changed) {
                db.prepare(
                  'UPDATE user_data SET data_json = ? WHERE user_id = ? AND data_key = ?'
                ).run(JSON.stringify(pls), user_id, 'playlists');
              }
            }

            // Liked songs
            const likedRow = db.prepare(
              'SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?'
            ).get(user_id, 'liked_songs');
            if (likedRow) {
              let liked = JSON.parse(likedRow.data_json);
              const idx = liked.indexOf(song.id);
              if (idx !== -1) {
                if (!liked.includes(keepId)) liked[idx] = keepId;
                else liked.splice(idx, 1);
                db.prepare(
                  'UPDATE user_data SET data_json = ? WHERE user_id = ? AND data_key = ?'
                ).run(JSON.stringify(liked), user_id, 'liked_songs');
                refsUpdated++;
              }
            }
          }
        } catch(e) { errors.push('refs:' + song.id + ':' + e.message); }
      }
    }
  });

  try { run(); }
  catch(e) { errors.push('transaction:' + e.message); }

  console.log(JSON.stringify({ filesRemoved, dbRemoved, refsUpdated, errors }));
});
" 2>/dev/null || echo '{"error":"exec failed"}')

if echo "$RESULT" | grep -q '"error":"exec'; then
  printf "  ${RED}✗ Cleanup failed — exec error${NC}\n\n"
  exit 1
fi

FILES=$(echo "$RESULT" | grep -oP '"filesRemoved":\K\d+' || echo "?")
ROWS=$(echo  "$RESULT" | grep -oP '"dbRemoved":\K\d+'    || echo "?")
REFS=$(echo  "$RESULT" | grep -oP '"refsUpdated":\K\d+'  || echo "?")
ERR_N=$(echo "$RESULT" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(len(d.get('errors',[])))" 2>/dev/null || echo "0")

printf "  ${GREEN}✓ Done:${NC} ${FILES} file(s) deleted, ${ROWS} DB rows removed, ${REFS} playlist/liked ref(s) updated\n"

if [ "${ERR_N:-0}" -gt 0 ]; then
  printf "  ${YELLOW}⚠ ${ERR_N} error(s) — details:${NC}\n"
  echo "$RESULT" | python3 -c \
    "import sys,json; [print('    •',e) for e in json.load(sys.stdin).get('errors',[])]" 2>/dev/null || true
fi

printf "\n  ${DIM}Tip: run 'bash check.sh' to confirm the library is clean.${NC}\n\n"
