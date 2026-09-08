#!/usr/bin/env bash
# Pull the latest code and restart the bot. Run as a sudo-capable user.
#   ./deploy/update.sh
set -euo pipefail

APP_DIR=/opt/guessjockey
APP_USER=guessjockey
SERVICE=guessjockey

echo "==> Fetching latest code"
sudo -u "$APP_USER" -H git -C "$APP_DIR" pull --ff-only

echo "==> Installing dependencies"
sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm ci --omit=dev"

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

sleep 2
sudo systemctl --no-pager --lines=20 status "$SERVICE" || true
echo "==> Done. Follow logs with:  journalctl -u $SERVICE -f"
