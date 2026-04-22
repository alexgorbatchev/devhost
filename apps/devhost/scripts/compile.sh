#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/.." && pwd)"

mkdir -p "$app_dir/dist"
bun run "$app_dir/scripts/buildDevtoolsBundle.ts"

cd "$app_dir"
go build -trimpath -o ./dist/devhost ./cmd/devhost
