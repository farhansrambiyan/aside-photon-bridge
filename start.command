#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
NODE="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo 'Install Node.js 22+ or set NODE_BIN to its absolute path.'; exit 1; fi
mkdir -p logs
chmod 700 logs
if ! "$NODE" --env-file-if-exists=.env src/doctor.mjs > logs/startup-check.log 2>&1; then
  cat logs/startup-check.log
  echo 'Bridge not started. Resolve the above check and run again.'
  exit 1
fi
cat logs/startup-check.log
exec "$NODE" --env-file-if-exists=.env src/photon.mjs
