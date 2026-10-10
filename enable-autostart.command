#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
NODE="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo 'Install Node.js 22+ or set NODE_BIN to its absolute path.'; exit 1; fi
exec "$NODE" --env-file=.env src/install-service.mjs
