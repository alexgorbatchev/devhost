#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd -- "$script_dir/.." && pwd)"

cd "$package_dir"

tsgo --noEmit -p tsconfig.json
bun test --coverage
bun vitest run -c vitest.storybook.config.ts
