---
name: policy-audit
description: Strict repository policy audit for tests, CI, pre-commit, AGENTS, and deploy or release enforcement. Use when asked to verify whether a repository's checked-in code, scripts, workflows, and docs actually define and enforce those policies, or when producing a formal audit report at `.review/policy.md`.
---

# Policy Audit

Use this skill for evidence-based repository policy audits that must follow a fixed rubric and produce a strict Markdown report.

## Workflow

1. Read `references/policy-rubric.md` before auditing anything. That file is the authoritative rubric.
2. Capture the current git SHA before the audit begins.
3. Inspect the repository conservatively and prefer checked-in evidence over convention.
4. Follow wrapper commands until the real validation, test, CI, hook, and deploy or release paths are clear.
5. Run canonical validation and test commands in a read-only manner whenever feasible.
6. Create `.review/` if it does not exist, then write the final Markdown report to `.review/policy.md`.
7. Return the same Markdown report with no extra commentary.

## Reference

- `references/policy-rubric.md` contains the exact audit rules, discovery scope, required checks, and output format. Do not deviate from it.
