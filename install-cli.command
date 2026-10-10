#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# Download the official installer at setup time; no proprietary CLI is distributed.
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT
curl -fsSL https://releases.aside.com/install.sh -o "$installer"
echo 'Reviewing the official installer is recommended. Saved at:' "$installer"
read -r -p 'Run the official Aside CLI installer? [y/N] ' answer
case "$answer" in y|Y) ;; *) exit 0 ;; esac
export ASIDE_CLI_INSTALL_DIR="$PWD/cli"
export ASIDE_CLI_BIN_DIR="$PWD/bin"
bash "$installer"
