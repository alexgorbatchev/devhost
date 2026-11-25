---
name: devhost-rust-parity
description: Use Rust Anything to record and replay Go Devhost behavior while implementing or verifying a Rust port ticket.
---

# Devhost Rust parity

Follow the [port workflow](../../../docs/internal/references/rust-port-parity.md) for building, recording, and replaying the active slice. Use its verified Go revision and a separate scratch directory for the recording.

Use the `rust-anything` MCP server or CLI to record and replay the Go behavior against `apps/devhost/rust`. Record only cases in the active slice. Keep generated bridges, front doors, and fallback dispatch out of the port. Preserve the existing ticket scope, test budget, and worktree ownership.

If the MCP server is unavailable, run the equivalent CLI command. If replay fails, inspect the recorded and actual outputs, fix the Rust behavior, and replay the affected case. Record the exact Git revisions and results in the ticket.
