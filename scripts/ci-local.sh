#!/usr/bin/env bash
# Run the same gates as .github/workflows/pr-checks.yml, in the same order and
# with the same environment variables. Usage: bash scripts/ci-local.sh
#
#   E2E_CONFIG   Playwright config (default e2e/playwright.config.ts). Use the
#                alternative-port config from docs/development.md when 5191 is busy.
#   CI_BASE      Base for the whitespace check (default origin/main).
#
# This script does not change tracked files, global tools or system packages.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

strip=--experimental-strip-types
ci_pnpm=11.17.0
e2e_config=${E2E_CONFIG:-e2e/playwright.config.ts}
base=${CI_BASE:-origin/main}

echo '==> 1/8 dependencies'
local_pnpm=$(pnpm --version)
[ "$local_pnpm" = "$ci_pnpm" ] || echo "!! pnpm $local_pnpm (CI は $ci_pnpm)。結果が CI とずれたら版をそろえて再実行してください。"
pnpm install --frozen-lockfile

echo '==> 2/8 pinned DSH distribution'
bash scripts/ci-local-dsh.sh
NODE_OPTIONS=$strip node scripts/check-ci-dsh.ts

echo '==> 3/8 typecheck'
pnpm typecheck

echo '==> 4/8 unit (zero skips, TZ=Asia/Tokyo as in CI)'
mkdir -p tmp/ci
: > tmp/ci/unit-summary.json
set +e
NODE_OPTIONS=$strip TZ=Asia/Tokyo node $strip --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=./scripts/ci-summary-reporter.ts \
  --test-reporter-destination=tmp/ci/unit-summary.json tests/*.test.ts
status=$?
set -e
NODE_OPTIONS=$strip node scripts/check-ci-test-results.ts tmp/ci/unit-summary.json "$status"

echo '==> 5/8 unit in UTC (advisory)'
NODE_OPTIONS=$strip TZ=UTC node $strip --test tests/*.test.ts >tmp/ci/unit-utc.log 2>&1 ||
  echo '!! TZ=UTC で失敗するテストがあります（CI でも advisory）。詳細は tmp/ci/unit-utc.log'

echo '==> 6/8 build / pack'
NODE_OPTIONS=$strip pnpm build
NODE_OPTIONS=$strip pnpm check:pack

echo '==> 7/8 browser (?mock, zero skips)'
# GitHub runners also get system packages through --with-deps; locally that needs
# sudo, so only the browser build is installed here. M3E_CHROMIUM_PATH skips it.
[ -n "${M3E_CHROMIUM_PATH:-}" ] || pnpm exec playwright install chromium
rm -f tmp/e2e-report.json
set +e
CI=1 TZ=Asia/Tokyo pnpm exec playwright test -c "$e2e_config"
status=$?
set -e
node $strip scripts/check-ci-e2e-results.ts tmp/e2e-report.json "$status"

echo '==> 8/8 whitespace'
git fetch -q origin main 2>/dev/null || echo "!! origin/main を取得できませんでした。手元の $base と比べます。"
git diff --check "$(git merge-base "$base" HEAD)" HEAD
git diff --check

echo 'OK: CI と同じゲートをすべて通過しました。'
