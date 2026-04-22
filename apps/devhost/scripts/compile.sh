#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/.." && pwd)"
build_version="$(cd -- "$app_dir" && bun -e 'const metadata = await Bun.file("./metadata.json").json(); console.log(metadata.version)')"
build_version_variable="github.com/alexgorbatchev/devhost/apps/devhost/internal/version.buildVersion"

mkdir -p "$app_dir/dist"
bun run "$app_dir/scripts/buildDevtoolsBundle.ts"

cd "$app_dir"
go build -trimpath -ldflags "-X ${build_version_variable}=${build_version}" -o ./dist/devhost ./cmd/devhost
