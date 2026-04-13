#!/usr/bin/env bash
set -euo pipefail

tsgo --project tsconfig.json
bun vitest run -c vitest.storybook.config.ts
