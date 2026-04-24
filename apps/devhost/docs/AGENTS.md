# Documentation directory guidelines

Local rules for authoring documentation inside `apps/devhost/docs/`.

## Local purpose

This directory is for technical design documentation, conceptual architecture guides, and deep-dive feature specs (e.g., architecture flows, Mermaid sequence diagrams). `packages/docs/sync.ts` mirrors these Markdown pages into the public docs site's Architecture section.

## Local boundaries

- **Always:** Use `README.md` in the package root for user-facing CLI usage, public manifest contracts, and general product copy.
- **Always:** Use this `docs/` folder for implementation-level diagrams and decisions that describe _how_ things work under the hood.
- **Always:** Keep Markdown here publishable through Astro/Starlight without repository-private assumptions when the content is meant to ship publicly.
- **Never:** Put basic getting-started tutorials here. Those belong in `README.md` and the generated docs landing page.
- **Never:** Duplicate the manifest reference from `devhost.example.toml` here.

## Done policy

- **Done:** Documentation work here is complete only when the content lives in the correct place (`README.md` vs `docs/`), referenced docs stay in sync, and the root/workspace done policy is satisfied.
- **Done:** If related public docs, diagrams, or AGENTS updates are still pending or blocked, report the work as incomplete instead of done.

## Internal references

- `annotations/queue.md` — Explains the server-owned durable queue architecture for terminal sessions, including the Mermaid flow for agent `SetAgentStatus` OSC lifecycle.
