#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() {
  printf '[curb] %s\n' "$1"
}

fail() {
  printf '[curb] %s\n' "$1" >&2
  printf 'Press any key to close...'
  read -r -n 1 _
  exit 1
}

load_homebrew() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_node() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  load_homebrew

  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return
  fi

  log "Node.js was not found. Installing it first..."

  if ! command -v brew >/dev/null 2>&1; then
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  load_homebrew
  brew install node
}

if ! ensure_node; then
  fail "Failed to install Node.js."
fi

cd "$ROOT_DIR"
if ! node "$ROOT_DIR/scripts/launch-curb.mjs"; then
  fail "Launcher failed."
fi
