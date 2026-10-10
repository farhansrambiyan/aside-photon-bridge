#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
printf 'Photon → Aside bridge setup\nCredentials stay only in this Mac’s private .env file.\n'
if [ -f .env ]; then
  read -r -p 'An .env file exists. Replace it? [y/N] ' overwrite
  case "$overwrite" in y|Y) ;; *) echo 'Keeping existing configuration.'; exit 0 ;; esac
fi
read -r -p 'Photon Spectrum project ID: ' project
read -r -s -p 'Photon Spectrum project secret (hidden): ' secret
printf '\n'
read -r -p 'Your allowed Photon sender ID (usually your +countrycode phone number): ' owner
read -r -p 'Allowed space ID (optional, press Enter to skip): ' space
read -r -p 'Aside account ID [u0]: ' account
account="${account:-u0}"
if [ -z "$project" ] || [ -z "$secret" ] || [ -z "$owner" ]; then echo 'Project, secret and owner are required.'; exit 1; fi
# Restrict dotenv syntax so typed values cannot inject additional variables.
for value in "$project" "$secret" "$owner" "$space" "$account"; do
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* || "$value" == *'"'* || "$value" == *"'"* || "$value" == *'`'* ]]; then echo 'Unsupported character in configuration. Nothing saved.'; exit 1; fi
done
printf 'SPECTRUM_PROJECT_ID="%s"\nSPECTRUM_PROJECT_SECRET="%s"\nALLOWED_SENDERS="%s"\nALLOWED_SPACES="%s"\nASIDE_ACCOUNT="%s"\nASIDE_TIMEOUT_MS=1200000\n' "$project" "$secret" "$owner" "$space" "$account" > .env
chmod 600 .env
unset secret
printf '\nSaved. Next: npm run doctor, then npm start.\n'
