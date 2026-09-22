#!/bin/sh
# Start full DragTable stack (Postgres + API + Web)
set -e
cd "$(dirname "$0")/.."
docker compose up --build "$@"
