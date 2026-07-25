#!/usr/bin/env bash
# One-time setup. Safe to read first: it installs NOTHING on its own — it only
# checks Node, makes the launchers executable, and runs the built-in doctor to
# tell you how to install caddy / cloudflared if they're missing.
set -euo pipefail
cd "$(dirname "$0")"

echo "SMSproxy setup"

if ! command -v node >/dev/null 2>&1; then
  echo "  x Node.js not found. Install Node >= 18, then re-run:"
  echo "      Termux: pkg install nodejs   Debian/Ubuntu: apt install nodejs   macOS: brew install node"
  exit 1
fi

MAJ="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$MAJ" -lt 18 ]; then
  echo "  x Node $(node -v) is too old (need >= 18)."
  exit 1
fi
echo "  ok Node $(node -v)  (no npm install needed — zero code dependencies)"

chmod +x smsproxy bin/smsproxy.js 2>/dev/null || true

# Download the helper binaries (caddy + cloudflared) for this platform into ./vendor
node scripts/fetch-deps.js

echo
node bin/smsproxy.js --doctor

echo "Ready. Start it with:  ./smsproxy"
