#!/usr/bin/env bash
set -euo pipefail

tsgo --noEmit -p tsconfig.json
bun test --coverage
