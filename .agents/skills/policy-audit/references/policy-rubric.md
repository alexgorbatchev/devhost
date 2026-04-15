# Policy Audit Rubric

## Sections

- Global audit rules
- Minimum discovery scope
- Exact report shape
- Check sections 1-26

You are a repository policy auditor.

Audit the current repository and determine whether its testing, CI, pre-commit, agent instructions, and deployment or release policy are actually defined, exercised, and enforced by the checked-in code, scripts, workflows, docs, and executable validation paths.

Global audit rules
- Do not modify repository files except to create `.review/` if needed and write the final audit report to `.review/policy.md`.
- Capture the current git SHA before the audit begins and preserve that exact SHA in the final report.
- Do not switch branches, commit, reset, amend, stash, or otherwise change the current git state during the audit.
- Do not assume the language, package manager, CI provider, or deploy platform. Infer them from the repository.
- Prefer checked-in evidence over convention.
- If something is ambiguous, fail conservatively and explain why.
- Cite file evidence as `path:line` when possible. If line numbers are unavailable, use `path`.
- For executed commands, cite the exact command and whether the evidence came from stdout or stderr.
- For libraries and CLIs, treat publish or release workflows as deployment policy.
- For apps and services, treat hosting or deploy workflows as deployment policy.
- For monorepos, inspect both root-level policy and workspace or package policy where relevant.
- Infer the repository's major units of ownership from its actual structure, such as packages, apps, services, libraries, workspaces, modules, top-level components, or other clearly separated shipped areas.
- Review root and nested `AGENTS.md` or `agents.md` files wherever they define contributor or validation behavior.
- If an `AGENTS.md` file explicitly delegates or inherits policy from another checked-in file, follow that reference and treat the inherited instruction as valid evidence.
- Follow referenced commands recursively until the real underlying validation, verification, deploy, publish, or release steps are clear. Do not stop at wrapper commands such as `npm run check`, `bun run check`, `make test`, or workflow step labels.
- Run the repository's canonical test and validation commands in a read-only manner whenever feasible.
- Distinguish normal runner or reporter output from incidental output emitted by test code, application code, browser consoles, servers, fixtures, or helper scripts. Reporter output is allowed. Incidental output is noise.
- Unexpected stdout or stderr emitted by tests or the app under test during a passing run is a failure unless the repository explicitly documents that exact output as expected and harmless.
- Do not treat the mere presence of a dependency, config file, or platform file as proof that a test runner, validation path, or deploy path exists. Passing evidence must show a concrete executable command, script, workflow, or explicitly documented procedure.
- If a check is not meaningfully applicable, mark it `PASS` and explain the non-applicability in `Evidence`.
- If the root `AGENTS.md` or `agents.md` file is missing, the root AGENTS check and all agent-instructions checks must fail.
- If CI exists but does not run the major validation steps that the repo's own root policy or scripts define, the CI validation check must fail.
- Agent instructions only pass if they describe success checks and verification steps concretely.
- Agent instructions only pass if required validation is described in strong, reinforcing language such as `Always`, `Must`, `Required`, `Never`, or `Do not ship until`.
- Agent instructions about documentation maintenance only pass if they clearly require contributors or agents to keep documentation current when behavior, workflows, interfaces, commands, policies, or other user-facing or contributor-facing contracts change.
- Agent instructions about test execution only pass if they directly tell the agent how to run tests or validation using concrete commands, entrypoints, or explicit checked-in references that fully define the procedure.
- Agent instructions about deploy or release only pass if repositories that ship code directly tell the agent how to deploy, publish, or release using concrete commands, entrypoints, or explicit checked-in references that fully define the procedure.
- Agent instructions about done policy only pass if they clearly define when an agent may say work is done and when the agent must instead report incomplete work, failed verification, missing required updates, skipped required steps, or blockers.
- Agent instructions about local skills only pass if they explicitly name the path to the local skills folder used by the repository, or the path where repository-local skills are expected to be stored when added.
- A strong done policy should require the agent to complete required checks, finish required verification, update required documentation, complete required deploy or release steps when in scope, and avoid claiming completion when any required part is still missing or failing.
- AGENTS files are stale if they reference commands, paths, workflows, policies, ownership boundaries, validation steps, or behavioral expectations that no longer match the checked-in repository.
- Return Markdown only, and write the same Markdown report to `.review/policy.md`.
- Do not add tables, numbered lists, IDs, findings, appendices, or extra commentary in the final report. The only list allowed is the required `## Action checklist` section.
- `Overall` is `PASS` only if every check is `PASS`. Otherwise `FAIL`.
- If `Status` is `PASS`, `Recommendations` must be exactly `None`.
- If `Status` is `FAIL`, `Recommendations` must give a concrete remediation.
- Generate the action checklist from the `Recommendations` text of every failing check, in the same order the failing checks appear in the report.
- Place the checklist in a `## Action checklist` section immediately after the summary block and before the per-check sections begin.
- Do not generate checklist items for passing checks.
- Do not add a separate action-items section at the end of the report.
- If every check passes, under `## Action checklist` write exactly `- [x] No action items.`

Minimum discovery scope
- Root docs such as `AGENTS.md`, `agents.md`, `README*`, `DEPLOY*`, `CONTRIBUTING*`, `docs/**/*`
- Nested agent docs such as `**/AGENTS.md`, `**/agents.md`
- Manifests and task runners such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`, `Taskfile*`, `justfile`
- CI/CD config such as `.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/*`, `Jenkinsfile`
- Hook config such as `.husky/*`, `.pre-commit-config.yaml`, `lefthook.yml`, `lint-staged`, `nano-staged`
- Test files and test runner config such as `tests/**/*`, `__tests__/**/*`, `*.test.*`, `*.spec.*`, Storybook, Vitest, Jest, Pytest, Go test, Cargo test
- Deploy and release assets such as Dockerfiles, Helm charts, Railway/Vercel/Netlify/Fly configs, release workflows, publish scripts
- Any scripts, workspace manifests, or checked-in docs referenced by the files above, until the actual commands and checks are fully resolved
- The actual output of executed canonical test and validation commands

Produce the final report in this exact overall shape, then fill in each check section exactly as specified below.

# Repository Policy Audit

Git SHA: <exact git SHA captured before the audit>
Overall: <PASS|FAIL>
Repo kind: <application|service|library|cli|monorepo|mixed|unknown>
Detected stacks: <comma-separated list or None detected>
Files examined: <comma-separated list of key files>
Summary: <short repo-specific summary>

## Action checklist
- [ ] <one checklist item per failing check recommendation, in failing-check order; if there are no failing checks, write exactly `- [x] No action items.`>

Check section 1: Automated tests exist
Verify:
- Identify whether the repository contains non-trivial application, library, service, or CLI source code outside docs, fixtures, generated output, vendor directories, or example-only content.
- Discover checked-in automated tests across all relevant directories, file families, and frameworks.
- Determine whether the discovered tests are real automated tests tied to shipped code.
- If the repository is not meaningfully code-bearing, mark this check `PASS` and explain that in `Evidence`.
Mark `PASS` when:
- Non-trivial shipped code exists and automated tests are present.
- Runnable Storybook, browser, and integration tests count.
Mark `FAIL` when:
- Non-trivial shipped code exists but automated tests are missing.
Produce exactly:
## Automated tests exist
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 2: All discovered tests are exercised
Verify:
- Enumerate every discovered checked-in automated test file family, spec glob, suite, or other automated test artifact.
- Trace the repository's canonical validation path from root commands, workspace commands, scripts, and CI steps down to the real underlying test commands.
- Run the canonical test or validation commands whenever feasible.
- Confirm that every discovered automated test artifact is covered by the real executed validation path.
- If execution is not feasible, pass only when static evidence conclusively proves coverage. Otherwise fail.
Mark `PASS` when:
- Every discovered automated test artifact is exercised by the canonical validation path.
Mark `FAIL` when:
- Any discovered automated test artifact is orphaned, omitted, skipped, or outside the real executed validation path.
Produce exactly:
## All discovered tests are exercised
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 3: All discovered test systems are exercised
Verify:
- Enumerate every distinct active test system, framework, or test configuration that owns checked-in tests.
- Ignore stale configs that have no owned tests.
- Trace the canonical validation path down to the real underlying commands.
- Run the canonical test or validation commands whenever feasible.
- Confirm that each active test system with owned tests is actually exercised.
Mark `PASS` when:
- Every active test system with checked-in tests is part of the canonical validation path and is actually exercised.
Mark `FAIL` when:
- Any active test system with checked-in tests exists but is not run.
Produce exactly:
## All discovered test systems are exercised
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 4: A test runner is configured
Verify:
- Trace the repository's actual test entrypoints from root commands, workspace scripts, runner configs, and checked-in docs.
- Confirm that there is a concrete executable command, script, workflow, or explicitly documented procedure that runs the tests.
- Do not count a dependency declaration or config file by itself as enough.
Mark `PASS` when:
- The repository defines a concrete executable test command, script, workflow, or explicitly documented procedure that runs the tests.
Mark `FAIL` when:
- Tests are referenced or present but there is no clear runnable path.
Produce exactly:
## A test runner is configured
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 5: Test runs are free of unexpected output noise
Verify:
- Run the repository's canonical test commands whenever feasible.
- Review stdout and stderr from the executed commands.
- Separate normal runner or reporter output from incidental logs emitted by tests, application code, browser consoles, servers, fixtures, or helpers.
- Treat unexpected warnings, errors, stack traces, browser console errors, server logs, uncaught rejections, and incidental stdout or stderr from tests or application code as noise.
- If execution is not feasible, pass only when checked-in evidence conclusively proves clean runs. Otherwise fail.
Mark `PASS` when:
- Executed canonical test commands produce only expected runner or reporter output and no incidental noise.
Mark `FAIL` when:
- Passing runs still emit unexpected stdout, stderr, warnings, errors, stack traces, browser console errors, server logs, uncaught rejections, or other incidental output.
Produce exactly:
## Test runs are free of unexpected output noise
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 6: A root-level validation entrypoint exists
Verify:
- Inspect root manifests, task runners, and checked-in docs for a canonical root validation command or root validation procedure.
- Trace any wrapper command to the real underlying checks.
Mark `PASS` when:
- A canonical root validation command or documented root validation procedure exists.
Mark `FAIL` when:
- There is no clear canonical root path to validate the whole repository.
Produce exactly:
## A root-level validation entrypoint exists
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 7: A root AGENTS file exists
Verify:
- Check for a root `AGENTS.md` or `agents.md` file.
Mark `PASS` when:
- A root `AGENTS.md` or `agents.md` file exists.
Mark `FAIL` when:
- Neither root file exists.
Produce exactly:
## A root AGENTS file exists
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 8: Root agent docs describe repo-wide checks
Verify:
- Read the root `AGENTS.md` or `agents.md` file.
- Follow any explicit references to subordinate checked-in docs that carry shared validation policy.
- Compare the documented repo-wide checks and boundaries against the real scripts, workflows, and validation paths.
Mark `PASS` when:
- The root agent docs directly describe repo-wide checks, or explicitly point to checked-in subordinate docs that do so, and that guidance is materially consistent with the real scripts and workflows.
Mark `FAIL` when:
- Repo-wide checks are omitted, the root AGENTS file is missing, or the docs materially contradict the real scripts or workflows.
Produce exactly:
## Root agent docs describe repo-wide checks
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 9: Agent instructions include success checks
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Look for concrete definitions of what successful completion looks like, such as named checks, commands, acceptance criteria, or completion gates.
- Do not accept vague phrasing such as `run the right checks` or `make sure it works`.
Mark `PASS` when:
- The relevant agent instructions explicitly define success using concrete checks, commands, or acceptance criteria.
Mark `FAIL` when:
- Success criteria are missing, vague, or only implied.
Produce exactly:
## Agent instructions include success checks
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 10: Agent instructions include verification steps
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Look for concrete verification steps, such as exact commands to run, review steps to perform, or explicit validation workflows.
- Do not accept weak or optional phrasing for required verification.
Mark `PASS` when:
- The relevant agent instructions explicitly tell the agent how to verify work using concrete commands, workflows, or review steps.
Mark `FAIL` when:
- Verification steps are missing, vague, or optional when they should be required.
Produce exactly:
## Agent instructions include verification steps
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 11: Agent instructions use strong, reinforcing validation language
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Identify the language used around required validation and verification.
- Treat wording such as `Always`, `Must`, `Required`, `Never`, or `Do not ship until` as strong mandatory language.
- Treat wording such as `should`, `can`, `if needed`, or `when appropriate` as weak language for required checks.
Mark `PASS` when:
- Required validation and verification are expressed with strong, reinforcing mandatory language.
Mark `FAIL` when:
- Required validation is described only weakly, ambiguously, or inconsistently.
Produce exactly:
## Agent instructions use strong, reinforcing validation language
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 12: Agent instructions require documentation maintenance
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Look for concrete instructions that require keeping documentation current when implementation behavior, interfaces, commands, workflows, policies, or other documented contracts change.
- Accept both repo-wide and component-local documentation maintenance requirements when they clearly apply.
- Do not accept vague phrasing that merely suggests docs might be updated.
Mark `PASS` when:
- The relevant agent instructions clearly require documentation maintenance using concrete and mandatory language.
Mark `FAIL` when:
- Documentation maintenance instructions are missing, weak, or only partially cover the repository's documented contracts.
Produce exactly:
## Agent instructions require documentation maintenance
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 13: Agent instructions explain how to run tests
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Look for concrete commands, entrypoints, workflows, or step-by-step checked-in procedures that tell the agent how to run tests or validation.
- Prefer direct commands in AGENTS files, but accept an explicit checked-in reference only if it clearly and fully defines the real procedure.
- Do not accept vague phrasing such as `run the checks`, `run tests if needed`, or `validate your work`.
Mark `PASS` when:
- The relevant agent instructions concretely tell the agent how to run tests or validation and the guidance matches the repository.
Mark `FAIL` when:
- Test-running guidance is missing, vague, partial, stale, or inconsistent with the repository.
Produce exactly:
## Agent instructions explain how to run tests
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 14: Agent instructions explain how to deploy or release
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Determine whether the repository ships code through deploy, publish, or release paths.
- If it does, look for concrete commands, entrypoints, workflows, or step-by-step checked-in procedures that tell the agent how to deploy, publish, or release.
- Prefer direct commands in AGENTS files, but accept an explicit checked-in reference only if it clearly and fully defines the real procedure.
- If the repository is clearly neither deployable nor publishable, mark `PASS` and explain that in `Evidence`.
- Do not accept vague phrasing such as `deploy as usual`, `publish when ready`, or `follow the release process` without concrete checked-in detail.
Mark `PASS` when:
- The relevant agent instructions concretely tell the agent how to deploy, publish, or release and the guidance matches the repository, or the repository is clearly not deployable or publishable.
Mark `FAIL` when:
- Shipping guidance is missing, vague, partial, stale, or inconsistent with the repository.
Produce exactly:
## Agent instructions explain how to deploy or release
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 15: Agent instructions define when work is done
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Look for concrete completion criteria that tell the agent when it may say work is done.
- Look for explicit non-completion criteria that tell the agent to report incomplete work, failed checks, missing verification, missing documentation updates, pending deploy or release steps, or blockers instead of claiming completion.
- Do not accept vague phrasing such as `finish the task`, `wrap up`, or `once checks look good`.
Mark `PASS` when:
- The relevant agent instructions clearly define when an agent may claim completion and when it must report work as not done or blocked.
Mark `FAIL` when:
- Done criteria are missing, vague, partial, or do not define when the agent must not claim completion.
Produce exactly:
## Agent instructions define when work is done
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 16: Agent instructions specify the local skills folder path
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Follow any explicit checked-in references they use for inherited policy.
- Look for an explicit path to the local skills folder used by the repository, or the explicit path where repository-local skills are expected to be stored when added.
- Accept either a relative repository path or a clearly defined local path, but the path must be concrete.
- Do not accept vague phrasing such as `see the skills folder`, `use local skills`, or `skills live nearby` without an actual path.
Mark `PASS` when:
- The relevant agent instructions explicitly name the local skills-folder path and the path is materially consistent with the repository's checked-in guidance.
Mark `FAIL` when:
- The local skills-folder path is missing, vague, partial, stale, or inconsistent.
Produce exactly:
## Agent instructions specify the local skills folder path
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 17: Every major repository unit has an AGENTS file
Verify:
- Infer the repository's major units of ownership from the checked-in structure, such as packages, apps, services, libraries, workspaces, modules, top-level components, or other clearly separated shipped areas.
- Determine which of those units have distinct contributor rules, validation behavior, runtime behavior, or ownership boundaries that justify local agent instructions.
- Check whether each such major unit has a checked-in local `AGENTS.md` or `agents.md` file, or an explicit checked-in explanation for why a root AGENTS file alone is sufficient.
- Fail conservatively if the structure clearly suggests multiple major units but local agent coverage is missing or unexplained.
Mark `PASS` when:
- Every major repository unit that needs local guidance has an AGENTS file or an explicit checked-in justification that root guidance alone is sufficient.
Mark `FAIL` when:
- Any major repository unit lacks needed AGENTS coverage.
Produce exactly:
## Every major repository unit has an AGENTS file
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 18: AGENTS files are not stale
Verify:
- Read the root and relevant nested `AGENTS.md` or `agents.md` files.
- Compare their commands, paths, workflows, policy statements, ownership boundaries, validation steps, and behavioral expectations against the actual checked-in repository.
- Trace referenced commands and paths to confirm they still exist and still do what the AGENTS files claim.
- Treat contradictions, obsolete paths, missing commands, outdated workflow descriptions, or stale contributor guidance as failures.
Mark `PASS` when:
- The AGENTS files are materially current and consistent with the checked-in repository.
Mark `FAIL` when:
- Any AGENTS file contains stale or contradictory information.
Produce exactly:
## AGENTS files are not stale
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 19: CI is configured
Verify:
- Inspect checked-in CI configuration files.
- Determine whether at least one validation workflow exists.
Mark `PASS` when:
- At least one CI workflow exists for validation.
Mark `FAIL` when:
- No validation CI workflow exists.
Produce exactly:
## CI is configured
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 20: CI runs the relevant validation steps
Verify:
- Compare CI steps to the repository's canonical local validation path.
- Trace CI wrapper steps down to the real underlying commands.
- Confirm whether CI installs dependencies and runs the important checks the repository expects locally.
- Pay special attention to whether all discovered tests and active test systems are included.
Mark `PASS` when:
- CI runs the important checks the repository expects locally.
Mark `FAIL` when:
- CI only deploys or publishes, or CI skips major checks that the repository's own root policy or scripts define.
Produce exactly:
## CI runs the relevant validation steps
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 21: CI runs at the right time
Verify:
- Inspect CI trigger conditions.
- Determine whether validation runs on at least one normal pre-ship contribution path, such as pull requests, merge requests, pushes to active development branches, or pushes to the default branch.
- Confirm that validation occurs before any release or deploy workflow ships code.
Mark `PASS` when:
- Validation runs on at least one normal pre-ship contribution path before shipping.
Mark `FAIL` when:
- Validation runs only on tags, release-only triggers, manual dispatch, schedules, or only inside publish or deploy workflows after the shipping trigger.
Produce exactly:
## CI runs at the right time
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 22: A pre-commit hook system exists
Verify:
- Inspect checked-in hook configuration such as `.husky/*`, `.pre-commit-config.yaml`, `lefthook.yml`, `lint-staged`, or `nano-staged`.
Mark `PASS` when:
- A checked-in pre-commit hook system exists.
Mark `FAIL` when:
- No checked-in pre-commit hook system exists.
Produce exactly:
## A pre-commit hook system exists
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 23: Pre-commit runs lint, format, or checks
Verify:
- Trace pre-commit hook commands down to the real underlying validation behavior.
- Confirm whether the hook actually runs lint, format, or other validation on staged files or the repository.
- Do not give credit for a hook system that does not perform validation.
Mark `PASS` when:
- Pre-commit actually runs lint, format, or other validation.
Mark `FAIL` when:
- Hooks exist but do not run validation, or validation tooling exists but there is no pre-commit validation path.
Produce exactly:
## Pre-commit runs lint, format, or checks
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 24: Deploy or release policy is documented
Verify:
- Inspect checked-in docs such as `README`, `DEPLOY`, `AGENTS`, release docs, or publish docs.
- Determine whether the repository explains how deploy, publish, or release works.
- For libraries and CLIs, audit publish or release docs.
- For apps and services, audit hosting or deploy docs.
- If the repository is clearly neither deployable nor publishable, mark `PASS` and explain that in `Evidence`.
Mark `PASS` when:
- The deploy, publish, or release path is concretely documented in checked-in docs.
Mark `FAIL` when:
- Shipping exists but the policy is missing or too vague to follow.
Produce exactly:
## Deploy or release policy is documented
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 25: Deploy or release is automated or reproducible
Verify:
- Trace deploy, publish, or release paths through scripts, workflows, and platform config.
- Confirm that the repository defines a concrete executable script, workflow, or explicitly documented procedure with enough detail for another contributor to reproduce it.
- Do not give credit for a bare platform config file or vague prose alone.
- If the repository is clearly neither deployable nor publishable, mark `PASS` and explain that in `Evidence`.
Mark `PASS` when:
- Deploy, publish, or release is automated or reproducible from checked-in repository evidence.
Mark `FAIL` when:
- The shipping path appears manual-only or too vague to reproduce.
Produce exactly:
## Deploy or release is automated or reproducible
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>

Check section 26: Deploy or release is gated by checks
Verify:
- Inspect deploy, publish, and release scripts and workflows.
- Determine whether shipping directly runs validation first, or depends on a prior validated job, artifact, or command path that is clearly defined in the repository.
- For libraries and CLIs, publishing counts as shipping.
- For apps and services, runtime deploys count as shipping.
Mark `PASS` when:
- Shipping is gated by validation.
Mark `FAIL` when:
- Code can be shipped without clearly defined validation gates.
Produce exactly:
## Deploy or release is gated by checks
Status: <PASS|FAIL>
Evidence: <repo-specific evidence with file citations and command-output references>
Recommendations: <None or concrete remediation>
