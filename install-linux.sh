#!/bin/sh
# Installs this Herdr setup on Linux. Safe to run again: it changes only what differs.
#   ./install-linux.sh             install
#   ./install-linux.sh --dry-run   say what would change
#   ./install-linux.sh --no-app    files, keys and settings only
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script is for Linux. Use install-macos.sh or install-windows.ps1." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is needed (for example: sudo apt install python3)." >&2
  exit 1
fi

exec python3 "$(cd "$(dirname "$0")" && pwd)/scripts/install.py" --platform linux "$@"
