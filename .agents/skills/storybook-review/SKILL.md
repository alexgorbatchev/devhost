---
name: storybook-review
description: Use when asked to review Storybook stories or Storybook testing coverage in this repository, especially `*.stories.*` files. Apply `.agents/skills/storybook/SKILL.md` as the rubric and write the review to `.reviews/storybook.md`.
---

# Storybook Review

Read `storybook/SKILL.md` first. Treat every rule in that skill as the review rubric.

Do not modify the reviewed Storybook files while reviewing unless the user explicitly asks for fixes.

Write the final review to `.reviews/storybook.md`. Create `.reviews/` if it does not exist. Overwrite the file on each fresh review so it only contains the current result.

Capture the current git SHA before the review begins and preserve that exact SHA in the report.

Prefer file citations as `path:line`. If exact line numbers are unavailable, cite the file path.

Use these review sections:

- `Coverage`
- `Play Tests`
- `Reuse`
- `Browser Environment`

Section rules:

- `Status` is `PASS` only when every reviewed file satisfies that section.
- `Status` is `FAIL` when any reviewed file has one or more unresolved issues in that section.
- `Evidence` must cite the relevant files and explain the observed behavior.
- `Recommendations` must be exactly `None` on `PASS`.
- `Recommendations` must be concrete, imperative remediations on `FAIL`.

Overall rules:

- `Overall` is `PASS` only if every section is `PASS`. Otherwise `FAIL`.
- Generate `## Action checklist` from the `Recommendations` text of every failing section, in section order.
- If a failing section needs multiple concrete fixes, split them into multiple checklist items.
- Keep checklist items specific and actionable. Name the missing state, the missing or weak `play` test, the duplicated setup that should be extracted, the hard-coded timeout that must be removed, or the browser-environment violation that must be corrected.
- Include the affected file path in each checklist item when more than one file is reviewed.
- Do not generate checklist items for passing sections.
- If every section passes, write exactly `- [x] No action items.`
- Keep the report factual. Do not add praise, scoring, or optional suggestions outside the required format.
- Return Markdown only.

Use this exact report shape:

```md
# Storybook Review

Git SHA: <exact git SHA captured before the review>
Overall: <PASS|FAIL>
Files reviewed: <comma-separated list of reviewed files>
Reference rubric: `.agents/skills/storybook/SKILL.md`
Summary: <short summary>

## Action checklist

- [ ] <one checklist item per concrete remediation, in failing-section order; if none, write exactly `- [x] No action items.`>

## Coverage

Status: <PASS|FAIL>
Evidence: <file-specific evidence with citations>
Recommendations: <None or concrete remediation>

## Play Tests

Status: <PASS|FAIL>
Evidence: <file-specific evidence with citations>
Recommendations: <None or concrete remediation>

## Reuse

Status: <PASS|FAIL>
Evidence: <file-specific evidence with citations>
Recommendations: <None or concrete remediation>

## Browser Environment

Status: <PASS|FAIL>
Evidence: <file-specific evidence with citations>
Recommendations: <None or concrete remediation>
```
