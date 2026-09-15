#!/usr/bin/env bash
# Open the global and cwd Whisper prompt files for manual review.
set -euo pipefail

skill_dir="$(cd "$(dirname "$0")/.." && pwd)"
cwd="${1:-$PWD}"

paths="$(node "$skill_dir/scripts/prepare.mjs" --paths --cwd "$cwd")"
global="${paths%%$'\n'*}"
local="${paths#*$'\n'}"
local="${local%%$'\n'*}"

mkdir -p "$(dirname "$local")"
touch "$global" "$local"

if [[ "$(uname -s)" == Darwin ]]; then
  open -t "$global" "$local"
elif [[ -n "${VISUAL:-}" ]]; then
  $VISUAL "$global" "$local" &
elif [[ -n "${EDITOR:-}" ]]; then
  $EDITOR "$global" "$local" &
else
  echo "Open these files for review:"
  echo "  $global"
  echo "  $local"
  exit 0
fi

echo "Opened:"
echo "  $global"
echo "  $local"
