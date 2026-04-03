#!/usr/bin/env bash
set -euo pipefail

tsgo --project tsconfig.json
vitest run --config ./vitest.storybook.config.ts
