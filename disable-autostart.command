#!/bin/bash
set -euo pipefail
launchctl bootout "gui/$(id -u)/local.aside.photon-bridge" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/local.aside.photon-bridge.plist"
echo 'Autostart disabled. Close any manually opened bridge terminal separately.'
