# docs/internal contributor notes

Local rules and conventions for internal-only documentation, runbooks, procedures, and engineering designs in `docs/internal/`.

## Purpose

`docs/internal/` houses the active repository of internal-only documentation for the team and organization, including runbooks, onboarding, designs, and maintained references. It is separated from public-facing user documentation.

## Metadata Frontmatter Contract

Every Markdown file under `docs/internal/` must begin with a YAML frontmatter block containing exactly these required keys:

```yaml
---
created_on: YYYY-MM-DD HH:MM
last_modified: YYYY-MM-DD HH:MM
status: current
---
```

- **Timestamp format:** Use exactly `YYYY-MM-DD HH:MM` (e.g. `2026-06-03 18:45`).
- **Initial Setup:** When creating a new file, set both `created_on` and `last_modified` to the same current timestamp.
- **Updates:** When editing an existing file, preserve `created_on` exactly and update only `last_modified` to the current timestamp.
- **Status values:** Use exactly `current` (for active, maintained source of truth) or `archived` (for superseded or historical documents). Do not introduce any custom lifecycle states like `draft` or `deprecated`.

## Archival and Promotion Rules

When an engineering design has been implemented or a runbook is superseded:

- **Move to nearest `archived/` folder:** Instead of deleting historical docs or mixing active and stale content together, move the document into the nearest `archived/` directory relative to its collection root.
  - E.g. `docs/internal/eng-designs/auto-shutdown-idle-timeout.md` -> `docs/internal/eng-designs/archived/auto-shutdown-idle-timeout.md`.
- **Set `status` to `archived`:** Update the YAML frontmatter's `status` value to `archived` and update the `last_modified` timestamp.
- **Do not leave duplicate files:** Never leave duplicate active files at the old location; move them completely and update any relative links pointing to them.

## File Conventions

- **Naming:** Filenames must use lowercase `kebab-case` naming (e.g. `deploy-runbook.md`).
- **Organization:** Put related documents into folders (e.g., `docs/internal/eng-designs/` or `docs/internal/references/`). Create new subdirectories only when introducing a multiple-file active collection.

## Shared boundaries

- **Always:** Ground all claims and instructions in current repository evidence (code, build scripts, package manifests). Mark unknowns explicitly instead of guessing.
- **Always:** Omit or sanitize secrets, private keys, raw tokens, or unredacted credentials from all files.
- **Never:** Use custom, unapproved lifecycle status values in frontmatter.
- **Never:** Move active files into `archived/` folders, or let stale documents remain in active folders.
