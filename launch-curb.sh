#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() {
  printf '[curb] %s\n' "$1"
}

fail() {
  printf '[curb] %s\n' "$1" >&2
  exit 1
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return
  fi

  log "Node.js was not found. Installing it first..."

  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm nodejs npm
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper --non-interactive install nodejs npm
  else
    fail "Unable to install Node.js automatically. Install Node.js 20+ and re-run this launcher."
  fi
}

ensure_node

cd "$ROOT_DIR"
if ! node "$ROOT_DIR/scripts/launch-curb.mjs"; then
  fail "Launcher failed."
fi
