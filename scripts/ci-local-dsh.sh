#!/usr/bin/env bash
# Place the pinned DSH distribution for scripts/ci-local.sh. Run from the
# repository root. GitHub Actions keys its cache by the lockfile hash; this
# does the same locally: an existing node_modules is reused only when the
# previous `npm ci` finished for exactly this lockfile.
set -euo pipefail

# The release under test comes from the fixture manifest, the same place CI
# reads it, so a version bump moves the install directory everywhere at once.
dsh_version=$(node -p "require('./.github/ci/dsh/package.json').dependencies['@deepseek-ai/dsh']")
dsh="tmp/dsh-integration/dsh-$dsh_version"
lock=.github/ci/dsh/package-lock.json
marker="$dsh/.ci-local-lock-sha256"
hash=$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex'))" "$lock")

mkdir -p "$dsh"
cp .github/ci/dsh/package.json "$lock" "$dsh/"
if [ -d "$dsh/node_modules" ] && [ "$(cat "$marker" 2>/dev/null)" = "$hash" ]; then
  echo "DSH: lockfile $hash の配置を再利用します"
  exit 0
fi
# Drop the marker first: an interrupted or failed install must not look complete.
rm -f "$marker"
npm ci --prefix "$dsh" --ignore-scripts --no-audit --no-fund
printf '%s\n' "$hash" > "$marker"
