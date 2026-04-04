#!/usr/bin/env bash
set -euo pipefail

# Detect OS
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
if [[ "$OS" == "darwin" ]]; then
  OS="darwin"
elif [[ "$OS" == "linux" ]]; then
  OS="linux"
elif [[ "$OS" == *"mingw"* || "$OS" == *"cygwin"* || "$OS" == *"msys"* ]]; then
  OS="windows"
else
  echo "Unsupported OS: $OS"
  exit 1
fi

# Detect Architecture
ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then
  ARCH="amd64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
  ARCH="arm64"
elif [[ "$ARCH" == *"arm"* ]]; then
  ARCH="arm"
else
  echo "Unsupported Architecture: $ARCH"
  exit 1
fi

DEST_DIR="node_modules/.bin"
mkdir -p "$DEST_DIR"

DEST_FILE="$DEST_DIR/caddy"
if [[ "$OS" == "windows" ]]; then
  DEST_FILE="$DEST_FILE.exe"
fi

echo "Downloading Caddy for $OS-$ARCH..."
URL="https://caddyserver.com/api/download?os=${OS}&arch=${ARCH}"

curl -sL "$URL" -o "$DEST_FILE"
chmod +x "$DEST_FILE"

echo "Caddy downloaded to $DEST_FILE"
