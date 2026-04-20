#!/usr/bin/env bun

console.error(
  "bin/devhost.ts is no longer a supported runtime entrypoint. Use go run ./cmd/devhost or the built ./dist/devhost binary.",
);
process.exit(1);
