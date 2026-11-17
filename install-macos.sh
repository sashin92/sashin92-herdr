#!/bin/sh
# Installs this Herdr setup on macOS. Safe to run again: it changes only what differs.
#   ./install-macos.sh             install
#   ./install-macos.sh --dry-run   say what would change
#   ./install-macos.sh --no-app    files, keys and settings only
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS. Use install-linux.sh or install-windows.ps1." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is needed (it comes with the Xcode command line tools: xcode-select --install)." >&2
  exit 1
fi

exec python3 "$(cd "$(dirname "$0")" && pwd)/scripts/install.py" --platform macos "$@"
