#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
caddy run --config Caddyfile --adapter caddyfile
