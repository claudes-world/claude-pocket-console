#!/usr/bin/env bash
# Extract a single release section from CHANGELOG.md
# Usage: scripts/extract-release-section.sh <version> [<changelog-path>]
set -euo pipefail
VERSION="${1:?version required (e.g. 1.10.0, no v prefix)}"
FILE="${2:-CHANGELOG.md}"
OUT="/tmp/release-notes-${VERSION}.md"

awk -v v="$VERSION" '
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
