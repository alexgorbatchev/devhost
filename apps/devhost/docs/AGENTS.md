# Documentation directory guidelines

Local rules for authoring documentation inside `apps/devhost/docs/`.

## Local purpose

This directory feeds the public docs site beyond the landing page and manifest reference.

- `guides/` holds deeper user-facing docs that would make `README.md` too large.
- `architecture/` holds technical design docs, architecture flows, and implementation-level deep dives.

`packages/docs/sync.ts` mirrors those folders into the public docs site's matching sections.

## Local boundaries

- **Always:** Use `README.md` in the package root for the landing page, installation, the smallest working quick start, and general product copy.
- **Always:** Use `guides/` for operational detail, caveats, and feature docs that are still user-facing.
- **Always:** Use `architecture/` for implementation-level diagrams and decisions that describe _how_ things work under the hood.
- **Always:** Keep Markdown here publishable through Astro/Starlight without repository-private assumptions when the content is meant to ship publicly.
- **Never:** Duplicate the manifest reference from `devhost.example.toml` here.
- **Never:** Hand-edit generated docs under `packages/docs/src/content/docs/`.

## Done policy

- **Done:** Documentation work here is complete only when the content lives in the correct place (`README.md` vs `guides/` vs `architecture/`), referenced docs stay in sync, and the root/workspace done policy is satisfied.
- **Done:** If related public docs, diagrams, or AGENTS updates are still pending or blocked, report the work as incomplete instead of done.

## Internal references

- `architecture/annotations/queue.md` — Explains the server-owned durable queue architecture for terminal sessions, including the Mermaid flow for agent `SetAgentStatus` OSC lifecycle.
