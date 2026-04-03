#!/usr/bin/env bash
set -euo pipefail

bun --bun oxfmt --check .
bun --bun oxlint .

cd devhost
bun run check

cd ../test
bun run check
