#!/bin/bash
set -Eeuo pipefail

WORKSPACE_PATH="${WORKSPACE_PATH:-$(pwd)}"

cd "${WORKSPACE_PATH}"

echo "🔍 Running validate..."
pnpm validate
echo "✅ Validate passed!"
