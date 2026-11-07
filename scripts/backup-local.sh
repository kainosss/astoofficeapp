#!/usr/bin/env bash
# Local backup: SQL dump of the local D1 database plus a git bundle of the full repository history.
# Backups are written to ./backups (git-ignored). Nothing is sent to GitHub or Cloudflare.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
if [ -d .wrangler/state ]; then
  npx wrangler d1 export asto-office-db --local --output "backups/asto-office-db-$STAMP.sql"
  echo "Database exported to backups/asto-office-db-$STAMP.sql"
fi
git bundle create "backups/asto-office-repo-$STAMP.bundle" --all
echo "Repository bundle written to backups/asto-office-repo-$STAMP.bundle"
