#!/usr/bin/env bash
# Serve the app locally. Usage: ./run.sh [port]   (default 8000)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
IP="$(ipconfig getifaddr en0 2>/dev/null)"
echo "Regatta app:  http://localhost:$PORT"
[ -n "$IP" ] && echo "On your LAN:  http://$IP:$PORT  (phone on same Wi-Fi; no offline install over http)"
echo "Ctrl+C to stop"
(sleep 1; open "http://localhost:$PORT" 2>/dev/null) &
exec python3 -m http.server "$PORT"
