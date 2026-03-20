#!/bin/bash
set -e

EXT_DIR="$HOME/.pi/agent/extensions"
INSTALL_DIR="$EXT_DIR/pi-gemini-cli-search"

if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
  npm install
else
  echo "Installing pi-gemini-cli-search..."
  mkdir -p "$EXT_DIR"
  cd "$EXT_DIR"
  git clone https://github.com/skdev-ai/pi-gemini-cli-search.git
  cd pi-gemini-cli-search
  npm install
fi

echo ""
echo "Done! Start GSD and run /gcs install-a2a to set up the A2A server."
