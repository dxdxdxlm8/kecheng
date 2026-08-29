#!/bin/bash
set -Eeuo pipefail

WORKSPACE_PATH="${WORKSPACE_PATH:-$(pwd)}"

cd "${WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
