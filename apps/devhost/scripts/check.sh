#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd -- "$script_dir/.." && pwd)"

cd "$package_dir"

bun run "$package_dir/scripts/buildDevtoolsBundle.ts"
go vet ./...
go test ./...
