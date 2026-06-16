#!/usr/bin/env bash
# ============================================================
#  Quarc Music — Data Restore
#  Run on the NEW server from the Quarc_Music directory:
#    bash restore.sh ./backup_20240101_120000
#
#  Restores .env and music.db into a fresh deployment.
# ============================================================
set -e

BACKUP_DIR="$1"

if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
  echo "Usage: bash restore.sh <backup-dir>"
  echo "  e.g. bash restore.sh ./backup_20240101_120000"
  exit 1
fi

if [ ! -f "$BACKUP_DIR/music.db" ] || [ ! -f "$BACKUP_DIR/.env" ]; then
  echo "ERROR: backup directory must contain music.db and .env"
  exit 1
fi

echo "Restoring from $BACKUP_DIR ..."

# 1. Restore .env (keeps JWT_SECRET, all secrets intact)
echo "  · Restoring .env ..."
cp "$BACKUP_DIR/.env" .env

# 2. Start backend to create the volume, then immediately stop it
echo "  · Initializing Docker volume ..."
docker compose up -d backend 2>/dev/null || true
sleep 3
docker compose stop backend

# 3. Restore the database
echo "  · Restoring music.db ..."
BACKEND=$(docker ps -aq --filter "label=com.docker.compose.service=backend" | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not found. Run 'docker compose up -d backend' first."
  exit 1
fi
docker cp "$BACKUP_DIR/music.db" "$BACKEND:/app/data/music.db"

# 4. Start everything
echo "  · Starting all services ..."
bash deploy.sh

echo ""
echo "Restore complete. Check status: bash check.sh"
echo ""
echo "If your music files are at a different path on this server,"
echo "update MUSIC_DIR in .env and run: bash deploy.sh backend"
