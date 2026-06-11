#!/bin/bash
# Pings GitHub to run the "Build & deploy to GitHub Pages" workflow via
# workflow_dispatch. Meant to be run every 30 min by launchd (see
# ~/Library/LaunchAgents/com.siri4eu.deploy-trigger.plist) so the site
# refreshes on time even when GitHub drops scheduled cron slots —
# dispatch-triggered runs are never dropped.
#
# The GitHub token is read from the macOS Keychain. To install it, create a
# fine-grained PAT (repo tommfr38/sirivseu, Actions: read/write) and run:
#   security add-generic-password -s siri4eu-deploy -a github -w '<PAT>' -U
set -u

REPO="tommfr38/sirivseu"
WORKFLOW="deploy.yml"
KEYCHAIN_SERVICE="siri4eu-deploy"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

TOKEN=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  log "no token in keychain (service '$KEYCHAIN_SERVICE'); skipping — GitHub's own cron remains the fallback"
  exit 0
fi

BODY=$(mktemp)
HTTP=$(curl -sS --max-time 30 -o "$BODY" -w '%{http_code}' -X POST \
  -H 'Accept: application/vnd.github+json' \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" \
  -d '{"ref":"main"}') || { log "curl failed (offline?)"; rm -f "$BODY"; exit 0; }

if [ "$HTTP" = "204" ]; then
  log "dispatched deploy OK"
else
  log "dispatch failed (HTTP $HTTP): $(cat "$BODY")"
fi
rm -f "$BODY"
