# Repository Policy Audit

Git SHA: a28f2eacb7774d0c96acc3a80782e50f2a20e8e6
Overall: FAIL
Repo kind: monorepo
Detected stacks: Bun, TypeScript, React, Storybook, Vitest browser mode, Playwright, GitHub Actions, Husky, nano-staged, Railway, npm publish
Files examined: `AGENTS.md`, `package.json`, `README.md`, `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.husky/pre-commit`, `packages/devhost/AGENTS.md`, `packages/devhost/package.json`, `packages/devhost/scripts/check.sh`, `packages/devhost/vitest.storybook.config.ts`, `packages/devhost/.storybook/main.ts`, `packages/devhost/src/devtools/AGENTS.md`, `packages/devhost/src/devtools/features/AGENTS.md`, `packages/devhost/docs/AGENTS.md`, `packages/devhost/README.md`, `packages/www/AGENTS.md`, `packages/www/package.json`, `packages/www/scripts/check.sh`, `packages/www/vitest.storybook.config.ts`, `packages/www/.storybook/main.ts`, `packages/www/DEPLOY.md`, `scripts/deployWwwRailway.ts`, `.agents/skills/policy-audit/SKILL.md`, `.agents/skills/policy-audit/references/policy-rubric.md`
Summary: Bun monorepo shipping the `devhost` CLI and a Railway-hosted demo app; automated tests, CI, pre-commit, and shipping automation exist, but the current validation path is red and the AGENTS and release documentation are incomplete or stale.

## Action checklist

- [ ] Update `AGENTS.md` so its repo-wide validation guidance matches the actual scripts, including that workspace `check` already runs Storybook/Vitest browser coverage.
- [ ] Add mandatory documentation-maintenance rules in the root and `packages/www` AGENTS files requiring updates to repo-wide validation docs, `packages/www/DEPLOY.md`, and other user-facing or contributor-facing contracts when workflows or behavior change.
- [ ] Update the AGENTS test-running instructions so they describe the real root and workspace validation paths, including that workspace `check` scripts already run Storybook/Vitest browser tests.
- [ ] Add concrete AGENTS shipping instructions for the Railway deploy and the tag-driven npm release, or explicitly inherit `packages/www/DEPLOY.md` and `.github/workflows/publish.yml` as the authoritative procedures.
- [ ] Add explicit done policy to the AGENTS files stating when agents may claim completion and when they must report incomplete work, failed checks, missing required updates, skipped required steps, or blockers instead.
- [ ] Add the repository-local skills folder path to the root AGENTS file, or state the exact path to use when local skills are added.
- [ ] Correct stale AGENTS statements about Storybook coverage being outside `bun run check`, `packages/www` check being TypeScript-only, and `packages/devhost` devtools being Preact-based.
- [ ] Add checked-in release documentation for the CLI's tag-driven npm publish flow, or expand existing docs so both the Railway deploy and npm release procedures are fully documented end to end.

## Automated tests exist

Status: PASS
Evidence: Non-trivial shipped code exists in `packages/devhost/bin/devhost.ts:1-3`, `packages/devhost/src/main.ts:1-10`, and `packages/www/src/server.ts:1-42`. Automated tests exist as Bun tests, for example `packages/devhost/src/devtools/features/annotationQueue/__tests__/AnnotationQueuePanel.test.tsx:1-91`, and as Storybook `play` tests, for example `packages/devhost/src/devtools/stories/App.stories.tsx:1-29` and `packages/www/src/app/stories/App.stories.tsx:1-42`, owned by `packages/devhost/.storybook/main.ts:12-14`, `packages/www/.storybook/main.ts:12-14`, `packages/devhost/vitest.storybook.config.ts:15-38`, and `packages/www/vitest.storybook.config.ts:16-38`.
Recommendations: None

## All discovered tests are exercised

Status: PASS
Evidence: The discovered automated test artifacts are the `bun:test` files under `packages/devhost/src/**/__tests__/*.test.ts(x)` such as `packages/devhost/src/devtools/features/annotationQueue/__tests__/AnnotationQueuePanel.test.tsx:1-91`, plus Storybook story files matched by `packages/devhost/.storybook/main.ts:12-14` and `packages/www/.storybook/main.ts:12-14`. The canonical root path is `package.json:7`, which resolves to `packages/devhost/scripts/check.sh:9-11` and `packages/www/scripts/check.sh:4-5`. Command `bun run check` exited 1; stdout showed formatting failures in `POLICY-REVIEW.md`, `POLICY.md`, and `POLICY_V2.md` (`/tmp/devhost-policy-audit-current.iT2xjA/root-check.stdout:1-8`) and stderr showed the expanded root script stopped before workspace checks (`/tmp/devhost-policy-audit-current.iT2xjA/root-check.stderr:1-3`). The resolved underlying test commands were then executed directly: command `bun test --coverage --coverage-dir "/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-coverage"` passed 239 tests across 72 files, with reporter output on stderr (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-test.stderr:119-122`); command `CI=1 STORYBOOK_DISABLE_TELEMETRY=1 XDG_CACHE_HOME="/tmp/devhost-policy-audit-current.iT2xjA/xdg-cache-seq2" bun vitest run -c vitest.storybook.config.ts --no-cache --attachmentsDir "/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2-attachments"` exercised the `packages/devhost` Storybook tests and failed with `2 failed | 11 passed (13)` files and `3 failed | 47 passed (50)` tests on stdout plus standard Vitest failure output on stderr (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2.stdout:2-13`, `/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2.stderr:1-80`); command `CI=1 STORYBOOK_DISABLE_TELEMETRY=1 XDG_CACHE_HOME="/tmp/devhost-policy-audit-current.iT2xjA/xdg-cache" bun vitest run -c vitest.storybook.config.ts --no-cache --attachmentsDir "/tmp/devhost-policy-audit-current.iT2xjA/www-vitest-attachments"` passed 19 files and 22 tests in `packages/www`, with reporter output on stdout (`/tmp/devhost-policy-audit-current.iT2xjA/www-vitest.stdout:2-8`). Every discovered test family is exercised by one of the real commands in the checked-in validation path.
Recommendations: None

## All discovered test systems are exercised

Status: PASS
Evidence: The active test systems with owned tests are Bun's `bun:test` runner for `packages/devhost/src/**/__tests__/*.test.ts(x)` files importing `bun:test`, such as `packages/devhost/src/devtools/features/annotationQueue/__tests__/AnnotationQueuePanel.test.tsx:1`, and the two Storybook/Vitest browser configurations in `packages/devhost/vitest.storybook.config.ts:15-38` and `packages/www/vitest.storybook.config.ts:16-38`. Command `bun test --coverage --coverage-dir "/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-coverage"` passed, with reporter output on stderr (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-test.stderr:119-122`); command `CI=1 STORYBOOK_DISABLE_TELEMETRY=1 XDG_CACHE_HOME="/tmp/devhost-policy-audit-current.iT2xjA/xdg-cache-seq2" bun vitest run -c vitest.storybook.config.ts --no-cache --attachmentsDir "/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2-attachments"` exercised the `packages/devhost` Storybook test system and failed with standard Vitest reporter output (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2.stdout:2-13`, `/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2.stderr:1-80`); command `CI=1 STORYBOOK_DISABLE_TELEMETRY=1 XDG_CACHE_HOME="/tmp/devhost-policy-audit-current.iT2xjA/xdg-cache" bun vitest run -c vitest.storybook.config.ts --no-cache --attachmentsDir "/tmp/devhost-policy-audit-current.iT2xjA/www-vitest-attachments"` passed for `packages/www` (`/tmp/devhost-policy-audit-current.iT2xjA/www-vitest.stdout:2-8`). No other active owned test systems were found.
Recommendations: None

## A test runner is configured

Status: PASS
Evidence: The repository defines concrete executable test entrypoints at `package.json:7`, `packages/devhost/scripts/check.sh:9-11`, and `packages/www/scripts/check.sh:4-5`. The Storybook browser test runners are concretely configured by `packages/devhost/vitest.storybook.config.ts:15-38` and `packages/www/vitest.storybook.config.ts:16-38`, not just by dependency declarations.
Recommendations: None

## Test runs are free of unexpected output noise

Status: PASS
Evidence: Command `bun test --coverage --coverage-dir "/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-coverage"` emitted only Bun reporter output: stdout contained the Bun header (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-test.stdout:1`) and stderr contained the coverage table and pass summary (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-bun-test.stderr:1-122`). Command `CI=1 STORYBOOK_DISABLE_TELEMETRY=1 XDG_CACHE_HOME="/tmp/devhost-policy-audit-current.iT2xjA/xdg-cache" bun vitest run -c vitest.storybook.config.ts --no-cache --attachmentsDir "/tmp/devhost-policy-audit-current.iT2xjA/www-vitest-attachments"` emitted only the normal Vitest summary on stdout and no stderr (`/tmp/devhost-policy-audit-current.iT2xjA/www-vitest.stdout:2-8`, `/tmp/devhost-policy-audit-current.iT2xjA/www-vitest.stderr`). The failing `packages/devhost` Storybook run emitted standard Vitest failure reporting rather than incidental application noise (`/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2.stdout:2-13`, `/tmp/devhost-policy-audit-current.iT2xjA/devhost-vitest-seq2.stderr:1-80`). No passing run emitted incidental logs, browser-console chatter, warnings, or stack traces.
Recommendations: None

## A root-level validation entrypoint exists

Status: PASS
Evidence: The canonical root validation command is `bun run check` from `package.json:7`, and root agent docs also name it at `AGENTS.md:7-13` and `AGENTS.md:31-33`. Command `bun run check` was executed; stdout showed the real format check running (`/tmp/devhost-policy-audit-current.iT2xjA/root-check.stdout:1-8`) and stderr showed the expanded script and failure propagation (`/tmp/devhost-policy-audit-current.iT2xjA/root-check.stderr:1-3`).
Recommendations: None

## A root AGENTS file exists

Status: PASS
Evidence: The repository has a root `AGENTS.md` at `AGENTS.md:1-47`.
Recommendations: None

## Root agent docs describe repo-wide checks

Status: FAIL
Evidence: The root AGENTS file does describe repo-wide checks at `AGENTS.md:7-13` and `AGENTS.md:31-38`, but it materially contradicts the checked-in validation path by saying Storybook is out-of-band from `bun run check` and should be run manually when in scope (`AGENTS.md:25`). In reality, the workspace `check` scripts already run Storybook/Vitest browser tests through `packages/devhost/scripts/check.sh:11` and `packages/www/scripts/check.sh:5`, and those scripts are included by the root `check` script in `package.json:7`.
Recommendations: Update `AGENTS.md` so its repo-wide validation guidance matches the actual scripts, including that workspace `check` already runs Storybook/Vitest browser coverage.

## Agent instructions include success checks

Status: PASS
Evidence: The agent docs define concrete success checks and completion gates with named commands and required doc-sync outcomes at `AGENTS.md:7-13`, `AGENTS.md:31-38`, `packages/devhost/AGENTS.md:7-22`, `packages/devhost/AGENTS.md:26-50`, and `packages/www/AGENTS.md:7-27`. Those instructions name exact commands such as `bun run check`, `bun test`, and `bun run storybook`, and they also define concrete completion conditions such as keeping `README.md`, `AGENTS.md`, `devhost.example.toml`, and `packages/www/src/app/App.tsx` in sync after relevant behavior changes.
Recommendations: None

## Agent instructions include verification steps

Status: PASS
Evidence: The root and workspace AGENTS files include concrete verification steps with exact commands at `AGENTS.md:8-13`, `AGENTS.md:31-38`, `packages/devhost/AGENTS.md:26-50`, and `packages/www/AGENTS.md:7-20`. Those steps tell contributors or agents what to run locally for repo-wide validation, package-local validation, tests, and Storybook coverage.
Recommendations: None

## Agent instructions use strong, reinforcing validation language

Status: PASS
Evidence: The AGENTS files use strong mandatory language around required validation and contributor behavior, including `Always`, `Never`, `must`, and `CRITICAL` at `AGENTS.md:31-37`, `packages/devhost/AGENTS.md:7-20`, and `packages/www/AGENTS.md:25-27`. The validation language is not limited to weak phrasing like `should` or `if needed`.
Recommendations: None

## Agent instructions require documentation maintenance

Status: FAIL
Evidence: `packages/devhost/AGENTS.md:7-22` gives strong documentation-maintenance rules for that workspace, but the repository-wide coverage is only partial. The root AGENTS file contains no comparable mandatory rule to keep repo-wide command, workflow, or policy docs current when they change (`AGENTS.md:1-47`), and `packages/www/AGENTS.md:29-35` references `DEPLOY.md` without requiring that file to be updated when deploy behavior changes even though the deploy contract is documented in `packages/www/DEPLOY.md:1-176`.
Recommendations: Add mandatory documentation-maintenance rules in the root and `packages/www` AGENTS files requiring updates to repo-wide validation docs, `packages/www/DEPLOY.md`, and other user-facing or contributor-facing contracts when workflows or behavior change.

## Agent instructions explain how to run tests

Status: FAIL
Evidence: The AGENTS files do name concrete test and validation commands at `AGENTS.md:8`, `packages/devhost/AGENTS.md:32-50`, and `packages/www/AGENTS.md:7-20`, but that guidance is stale and inconsistent with the repository. The root AGENTS file says Storybook is outside `bun run check` (`AGENTS.md:25`), the `devhost` workspace AGENTS file says the package `check` script runs only the native TypeScript check and coverage test suite and that Storybook should be run separately (`packages/devhost/AGENTS.md:50`), and the demo app AGENTS file says `bun run check` currently runs only package TypeScript validation (`packages/www/AGENTS.md:20`). The real scripts contradict that guidance because `packages/devhost/scripts/check.sh:9-11` and `packages/www/scripts/check.sh:4-5` both run Storybook/Vitest browser tests as part of `check`.
Recommendations: Update the AGENTS test-running instructions so they describe the real root and workspace validation paths, including that workspace `check` scripts already run Storybook/Vitest browser tests.

## Agent instructions explain how to deploy or release

Status: FAIL
Evidence: The repository ships code through the Railway deploy path in `packages/www/DEPLOY.md:12-152` and `scripts/deployWwwRailway.ts:35-56`, and through the npm publish path in `.github/workflows/publish.yml:37-105`. The AGENTS files provide only partial shipping guidance: the root file says not to publish from the repo root and lists `.github/workflows/publish.yml` as a reference (`AGENTS.md:34-47`), while the demo app AGENTS file only lists `DEPLOY.md` in its references (`packages/www/AGENTS.md:29-35`). The reviewed AGENTS files do not directly tell the agent the deploy or release entrypoints, nor do they clearly state that those referenced files are the authoritative inherited procedures.
Recommendations: Add concrete AGENTS shipping instructions for the Railway deploy and the tag-driven npm release, or explicitly inherit `packages/www/DEPLOY.md` and `.github/workflows/publish.yml` as the authoritative procedures.

## Agent instructions define when work is done

Status: FAIL
Evidence: The AGENTS files contain required actions such as `Always: run bun run check` and documentation-sync rules (`AGENTS.md:31-38`, `packages/devhost/AGENTS.md:7-22`, `packages/www/AGENTS.md:23-27`), but none of the reviewed AGENTS files define when an agent may say work is done or when it must instead report incomplete work, failed verification, missing documentation updates, skipped required steps, pending deploy or release work, or blockers. No such done policy appears in `AGENTS.md:1-47`, `packages/devhost/AGENTS.md:1-95`, `packages/www/AGENTS.md:1-35`, `packages/devhost/src/devtools/AGENTS.md:1-57`, `packages/devhost/src/devtools/features/AGENTS.md:1-30`, or `packages/devhost/docs/AGENTS.md:1-18`.
Recommendations: Add explicit done policy to the AGENTS files stating when agents may claim completion and when they must report incomplete work, failed checks, missing required updates, skipped required steps, or blockers instead.

## Agent instructions specify the local skills folder path

Status: FAIL
Evidence: The repository clearly has a local skills tree at `.agents/skills/policy-audit/SKILL.md:1-22`, but no reviewed AGENTS file names that path or the path where repository-local skills should be stored when added. That path is absent from `AGENTS.md:1-47`, `packages/devhost/AGENTS.md:1-95`, `packages/www/AGENTS.md:1-35`, `packages/devhost/src/devtools/AGENTS.md:1-57`, `packages/devhost/src/devtools/features/AGENTS.md:1-30`, and `packages/devhost/docs/AGENTS.md:1-18`.
Recommendations: Add the repository-local skills folder path to the root AGENTS file, or state the exact path to use when local skills are added.

## Every major repository unit has an AGENTS file

Status: PASS
Evidence: The root AGENTS file identifies the major workspace units at `AGENTS.md:15-18`, and each has local guidance in `packages/devhost/AGENTS.md:1-95` and `packages/www/AGENTS.md:1-35`. The repository also provides additional local AGENTS coverage for subunits with distinct rules in `packages/devhost/src/devtools/AGENTS.md:1-57`, `packages/devhost/src/devtools/features/AGENTS.md:1-30`, and `packages/devhost/docs/AGENTS.md:1-18`.
Recommendations: None

## AGENTS files are not stale

Status: FAIL
Evidence: Multiple AGENTS files materially contradict the checked-in repository. The root AGENTS file says Storybook is out-of-band from `bun run check` (`AGENTS.md:25`), but both workspace `check` scripts run Storybook/Vitest browser tests (`packages/devhost/scripts/check.sh:11`, `packages/www/scripts/check.sh:5`). The `devhost` workspace AGENTS file says to run Storybook separately when Storybook coverage is in scope (`packages/devhost/AGENTS.md:50`), but the package `check` script already runs `bun vitest run -c vitest.storybook.config.ts` (`packages/devhost/scripts/check.sh:11`). The demo app AGENTS file says `bun run check` currently runs only TypeScript validation (`packages/www/AGENTS.md:20`), but `packages/www/scripts/check.sh:4-5` also runs Storybook/Vitest tests. It also says the `packages/devhost` devtools UI is Preact-based (`packages/www/AGENTS.md:21`), while the workspace depends on React and React DOM (`packages/devhost/package.json:54-60`) and imports React in the injected devtools runtime (`packages/devhost/src/devtools/App.tsx:2-3`, `packages/devhost/src/devtools/renderDevtools.ts:1-2`).
Recommendations: Correct stale AGENTS statements about Storybook coverage being outside `bun run check`, `packages/www` check being TypeScript-only, and `packages/devhost` devtools being Preact-based.

## CI is configured

Status: PASS
Evidence: A validation workflow exists in `.github/workflows/ci.yml:1-36`.
Recommendations: None

## CI runs the relevant validation steps

Status: PASS
Evidence: The CI workflow installs dependencies, installs Playwright browsers, and runs `bun run check` in `.github/workflows/ci.yml:29-36`. That command resolves to the repo-wide validation path in `package.json:7`, which in turn includes both workspace `check` scripts at `packages/devhost/scripts/check.sh:9-11` and `packages/www/scripts/check.sh:4-5`, so the workflow includes root lint and format checks plus all discovered automated test systems.
Recommendations: None

## CI runs at the right time

Status: PASS
Evidence: Validation CI runs on normal pre-ship contribution paths via `pull_request` and `push` in `.github/workflows/ci.yml:3-7`. The publish workflow ships only on tag pushes in `.github/workflows/publish.yml:3-6`, so validation is configured to run on ordinary contribution paths before the release-only workflow.
Recommendations: None

## A pre-commit hook system exists

Status: PASS
Evidence: Husky is checked in via `.husky/pre-commit:1` and is installed from the root manifest with `prepare: "husky"` in `package.json:12`.
Recommendations: None

## Pre-commit runs lint, format, or checks

Status: PASS
Evidence: The pre-commit hook runs `bun run nano-staged` at `.husky/pre-commit:1`, and the checked-in nano-staged configuration formats staged files with `bun --bun oxfmt --write --no-error-on-unmatched-pattern` in `package.json:14-15`. That is a concrete pre-commit formatting path, not an empty hook.
Recommendations: None

## Deploy or release policy is documented

Status: FAIL
Evidence: The demo app deploy path is thoroughly documented in `packages/www/DEPLOY.md:1-176`, including the preferred entrypoint `bun run deploy:www` and the manual equivalent steps. The repository also ships a published CLI package, but there is no comparable checked-in release runbook explaining the tag-driven npm publish flow used by `.github/workflows/publish.yml:1-105`; root docs only say not to publish from the repo root and to publish from `packages/devhost/` (`AGENTS.md:36-47`), which is too vague to serve as release policy documentation.
Recommendations: Add checked-in release documentation for the CLI's tag-driven npm publish flow, or expand existing docs so both the Railway deploy and npm release procedures are fully documented end to end.

## Deploy or release is automated or reproducible

Status: PASS
Evidence: The demo app has a reproducible deploy entrypoint at `package.json:8` backed by `scripts/deployWwwRailway.ts:35-56` and `scripts/deployWwwRailway.ts:189-283`, and `packages/www/DEPLOY.md:30-152` documents both the automated and manual procedures. The CLI package release is automated by `.github/workflows/publish.yml:3-105`, which derives the version from the tag, validates the package version, verifies the package, publishes to npm, and creates the GitHub release.
Recommendations: None

## Deploy or release is gated by checks

Status: PASS
Evidence: The demo app deploy script validates `packages/www` before shipping by running `bun run --cwd packages/www check` and `bun run --cwd packages/www build` in `scripts/deployWwwRailway.ts:189-193` before `railway up` in `scripts/deployWwwRailway.ts:195-197`. The npm publish workflow gates shipping with a `Verify package` step that runs `bun run check` and `npm pack --dry-run` in `.github/workflows/publish.yml:62-68` before `npm publish` in `.github/workflows/publish.yml:86-90`.
Recommendations: None
