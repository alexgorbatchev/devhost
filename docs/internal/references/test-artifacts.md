---
created_on: 2026-11-05 05:36
last_modified: 2026-11-05 07:13
status: current
---

# Test artifact ownership

This reference describes temporary storage and process cleanup for contributors running the repository's Go, Bun, browser, and demo-workflow tests.

## Command and fixture lifetimes

The workspace test recipes, design type-check, and docs build, type-check, and link-check commands invoke `test-support/runTests.sh`. Each invocation creates a unique short `/tmp/dht.XXXXXX` directory and exports it as `TMPDIR` and `GOTMPDIR`. The short path accommodates Chromium's Unix-domain sockets even when the checkout or the caller's temporary directory has a long path. Validation also keeps Node's temporary compile cache and the link checker's staging files inside that command directory.

Tests create unique children directly beneath `os.tmpdir()` or through Go's `t.TempDir()`. Each fixture stops and joins its servers and browsers before removing its directory, including when setup or assertions fail. The runner identifies process groups through ancestry and the inherited `DEVHOST_TEST_RUN_ID`, including detached helpers reparented after a test timeout or panic. It repeatedly discovers owned processes during shutdown, allows five seconds for graceful termination, then kills survivors. It removes its directory only after verifying shutdown; failed process inspection or surviving processes preserve the directory and fail the command. It preserves the command's exit status otherwise and handles HUP, INT, and TERM. It does not remove the caller's temporary directory or other runs' files.

Go subprocess helpers inherit the suite's isolated home, XDG paths, devhost paths, temporary directory, home-isolation marker, and run ID through `testenv.InheritIsolation`. Explicit test overrides take precedence; preserve the runner's run ID so it can find orphaned helpers. Register subprocess shutdown before waiting for readiness; join worktree-stack shutdown before `t.TempDir()` cleanup can run.

Browser fixtures use `createOwnedBrowserEnvironment` for the browser process; Go fixtures use `browsertest.Browser.AllocatorOptions`. Both keep home, downloads, XDG storage, Chrome configuration, and audio runtime paths inside the fixture. The runtime directory has owner-only permissions. The launching process retains its real home so Playwright can locate installed browser binaries. The runner also supplies command-owned Chrome configuration and audio runtime paths for browsers launched by Vitest. Native Vue servers run in owned process groups; close their browser first, then terminate and join the server group before removing the fixture.

## Retained dependencies and reports

Reusable native Vue dependencies and their lockfile live under `.cache/test-dependencies/vue-native-host/`. Every Vue fixture links that installation but owns its Vite optimizer cache, host, home, ports, and browser profile separately. Redux keeps only its checksum-pinned extension archive under `.cache/test-dependencies/redux-native-extension-3.2.10/`; each fixture verifies its copy and unpacks it inside its own directory.

UI coverage reports remain under `packages/devhost-ui/.cache/coverage/` for `just ui coverage` to read after the test command. Installed dependencies, embedded builds, pinned docs media, and toolchain caches retain their normal development lifetimes.

Demo workflow tests use disposable repository fixtures and remove them. Real recordings and renders keep `.tmp/demos/` because later rendering commands consume their footage; test cleanup must not delete those recordings.

## Verification

1. Run `just setup` to prepare dependencies and browser binaries, then run `just check` for all repository gates.
2. When changing fixture ownership, compare the checkout's `.tmp/`, the caller's temporary directory, the system temporary directory, and the process list before and after `just test`. Account separately for the retained dependencies, media, builds, and coverage reports above.
3. Exercise a failing command and interrupt a running command through `test-support/runTests.sh`; verify the exit status, removal of that command's directory, and termination of its subprocesses. Never clean an unrelated run to make the audit pass. The shell regression included in both root commands injects failed signal delivery while retaining real processes and process inspection. It verifies that the runner reports surviving processes and preserves scratch before attempting to join them; it does not reproduce uninterruptible kernel I/O.
