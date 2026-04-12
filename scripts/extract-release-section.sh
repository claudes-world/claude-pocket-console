#!/usr/bin/env bash
# Extract a single release section from CHANGELOG.md
# Usage: scripts/extract-release-section.sh <version> [<changelog-path>]
set -euo pipefail
VERSION="${1:?version required (e.g. 1.10.0, no v prefix)}"

# Validate semver format (no v prefix) — prevents path traversal via /tmp filename
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "ERROR: version must be semver format (e.g. 1.10.0)" >&2
  exit 1
fi

FILE="${2:-CHANGELOG.md}"
OUT="/tmp/release-notes-${VERSION}.md"

# Escape dots so awk treats them as literal characters, not regex wildcards
ESC_VERSION=$(echo "$VERSION" | sed 's/\./\\./g')

awk -v v="$ESC_VERSION" '
  $0 ~ "^## \\[" v "\\]" { found=1; next }
  found && /^## \[/ { exit }
  found { print }
' "$FILE" > "$OUT"

# Validate: non-empty and has at least one bullet point
if [ ! -s "$OUT" ] || ! grep -q '^- ' "$OUT"; then
  echo "ERROR: extracted notes for $VERSION are empty or malformed" >&2
  exit 2
fi

echo "$OUT"
