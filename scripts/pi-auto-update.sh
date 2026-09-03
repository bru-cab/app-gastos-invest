#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${DEPLOY_BRANCH:-main}"
LOG_PREFIX="[pi-auto-update]"

cd "$APP_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "$LOG_PREFIX skipping: $APP_DIR is not a git checkout"
  exit 0
fi

git fetch origin "$BRANCH" --quiet

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$BRANCH")"

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "$LOG_PREFIX no changes"
  exit 0
fi

echo "$LOG_PREFIX updating $LOCAL_HEAD -> $REMOTE_HEAD"
git reset --hard "origin/$BRANCH"
npm ci
npm run build
"$APP_DIR/start.sh"
echo "$LOG_PREFIX deployed $REMOTE_HEAD"
