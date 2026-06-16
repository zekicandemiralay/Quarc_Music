#!/usr/bin/env bash
# ============================================================
#  Quarc Music — Data Backup
#  Run on the OLD server from the project directory:
#    bash backup.sh
#
#  Creates: ./backup_YYYYMMDD_HHMMSS/
#    music.db     — full SQLite database (users, playlists,
#                   listening history, song metadata)
#    .env         — all secrets and config
#
#  Music files are NOT included here (too large).
#  See MIGRATION.md for how to transfer them separately.
# ============================================================
set -e

BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR ..."

# Find the running backend container (works regardless of project name)
BACKEND=$(docker ps -q --filter "label=com.docker.compose.service=backend" | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not running. Start it first: docker compose up -d backend"
  exit 1
fi

# SQLite database
echo "  · Exporting music.db ..."
docker cp "$BACKEND:/app/data/music.db" "$BACKUP_DIR/music.db"

# .env
echo "  · Copying .env ..."
cp .env "$BACKUP_DIR/.env"

# Summary
DB_SIZE=$(du -sh "$BACKUP_DIR/music.db" | awk '{print $1}')
echo ""
echo "Backup complete: $BACKUP_DIR"
echo "  music.db : $DB_SIZE"
echo ""
echo "Next: copy this folder to the new server."
echo "  scp -r $BACKUP_DIR user@new-server:~/Quarc_Music/"
echo ""
echo "Music files: rsync your MUSIC_DIR separately — see MIGRATION.md"
