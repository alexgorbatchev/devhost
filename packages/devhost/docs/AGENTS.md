# Documentation directory guidelines

Local rules for authoring documentation inside `packages/devhost/docs/`.

## Local purpose

This directory is strictly for internal technical design documentation, conceptual architecture guides, and deep-dive feature specs (e.g., architecture flows, Mermaid sequence diagrams).

## Local boundaries

- **Always:** Use `README.md` in the package root for user-facing CLI usage, public manifest contracts, and general marketing copy.
- **Always:** Use this `docs/` folder for implementation-level diagrams and decisions that describe _how_ things work under the hood.
- **Never:** Put user-facing setup tutorials or getting-started guides here. Those belong in the `README.md` and the demo app.
- **Never:** Duplicate the public API manifest schema here.

## Done policy

- **Done:** Documentation work here is complete only when the content lives in the correct place (`README.md` vs `docs/`), referenced docs stay in sync, and the root/workspace done policy is satisfied.
- **Done:** If related public docs, diagrams, or AGENTS updates are still pending or blocked, report the work as incomplete instead of done.

## Internal references

- `annotations/queue.md` — Explains the server-owned durable queue architecture for terminal sessions, including the Mermaid flow for agent `SetAgentStatus` OSC lifecycle.
