#!/usr/bin/env bash
set -euo pipefail

# Resolve the extracted archive directory so the helper works from any current directory.
ARCHIVE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$ARCHIVE_ROOT/module1_pass8_e2e"
BACKEND_ROOT="$PROJECT_ROOT/marketplace-backend"
FRONTEND_ROOT="$PROJECT_ROOT/marketplace-frontend"

# Generate and verify the backend lockfile only when the committed lockfile is still missing.
if [[ ! -f "$BACKEND_ROOT/package-lock.json" ]]; then
  echo "==> Generating backend package-lock.json"
  (cd "$BACKEND_ROOT" && npm run deps:lock)
fi
(cd "$BACKEND_ROOT" && npm run deps:verify-lock)

# Generate and verify the frontend lockfile only when the committed lockfile is still missing.
if [[ ! -f "$FRONTEND_ROOT/package-lock.json" ]]; then
  echo "==> Generating frontend package-lock.json"
  (cd "$FRONTEND_ROOT" && npm run deps:lock)
fi
(cd "$FRONTEND_ROOT" && npm run deps:verify-lock)

# Run the project's permanent final release gate without weakening or bypassing any required stage.
cd "$PROJECT_ROOT"
node scripts/run-current-release-gate.mjs
