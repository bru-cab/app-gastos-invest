#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/bin:/bin:/home/pi/.local/bin:$PATH"

cd "$APP_DIR"

pkill -f "scripts/sync-server.mjs" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://localhost:8787" 2>/dev/null || true
pkill -f "localtunnel --port 8787" 2>/dev/null || true
pkill -f "lt --port 8787" 2>/dev/null || true

sleep 1

: > server.log
: > tunnel.log

nohup node scripts/sync-server.mjs >> server.log 2>&1 &

if [[ -n "${NGROK_AUTHTOKEN:-}" ]]; then
  if [[ -n "${NGROK_URL:-}" ]]; then
    nohup npx --yes ngrok http 8787 --authtoken "${NGROK_AUTHTOKEN}" --url "${NGROK_URL}" >> tunnel.log 2>&1 &
  else
    nohup npx --yes ngrok http 8787 --authtoken "${NGROK_AUTHTOKEN}" >> tunnel.log 2>&1 &
  fi
elif [[ -n "${PUBLIC_TUNNEL_DOMAIN:-}" ]]; then
  nohup npx --yes localtunnel --port 8787 --subdomain "${PUBLIC_TUNNEL_DOMAIN}" >> tunnel.log 2>&1 &
else
  nohup cloudflared tunnel --url http://localhost:8787 --no-autoupdate >> tunnel.log 2>&1 &
fi
