#!/usr/bin/env bash
# Usage:
#   bash deploy.sh          — rebuild both frontend and backend
#   bash deploy.sh frontend — rebuild frontend only
#   bash deploy.sh backend  — rebuild backend only

set -e

TARGET=${1:-all}

pull_latest() {
  echo "Pulling latest code..."
  git pull
}

build() {
  local svc=$1
  echo "Building $svc..."
  docker compose up -d --build --no-deps "$svc"
  echo "$svc updated."
}

# yt-dlp is installed as an early Dockerfile layer that only depends on the
# base image, so a normal --build never invalidates it — it silently stays
# pinned to whatever version was baked in the very first time the image was
# built. YouTube's bot-detection changes constantly and yt-dlp ships fixes
# for it just as often ("Sign in to confirm you're not a bot" is the classic
# symptom of falling behind), so force a fresh upgrade inside the running
# container on every backend deploy instead of relying on a full rebuild.
upgrade_ytdlp() {
  echo "Upgrading yt-dlp in the running backend container..."
  docker compose exec -T backend pip3 install --break-system-packages --upgrade yt-dlp
}

pull_latest

case "$TARGET" in
  frontend) build frontend ;;
  backend)  build backend; upgrade_ytdlp ;;
  all)      build backend; upgrade_ytdlp; build frontend ;;
  *)        echo "Usage: bash deploy.sh [frontend|backend|all]"; exit 1 ;;
esac

echo "Done. Gluetun untouched."
