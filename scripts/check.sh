#!/usr/bin/env bash
set -euo pipefail

bun --bun oxfmt --write .
bun --bun oxlint .

tsgo --noEmit -p tsconfig.json
bun test --coverage
vitest run --config ./vitest.storybook.config.ts

(cd www && bun run check)
