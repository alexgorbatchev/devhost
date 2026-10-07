---
created_on: 2026-10-06 14:15
last_modified: 2026-10-06 22:00
status: current
---

# Refreshing the devhost demo

Run the recording from the checkout whose UI you want to demonstrate. The recorder rebuilds the CLI and embedded UI, starts the real playground through devhost, and exports a captioned H.264 MP4. The scene scripts remain in Git; generated media stays local until someone deliberately publishes it.

## Prerequisites

The recording workflow has been validated on Linux. It uses the existing managed Caddy on HTTPS port 443 so the real terminal and browser demonstrate `https://demo.localhost` without a port.

Install the repository dependencies with `bun install`. Recording uses the existing pinned Playwright dependency and Chromium installed by `just ui install-browser`. Also provide Git, `just`, Caddy, [VHS](https://github.com/charmbracelet/vhs), `ttyd`, Bash, `ln`, and FFmpeg/ffprobe on PATH. FFmpeg must support H.264 (`libx264`) and subtitles (`libass`). Install the DejaVu fonts and Noto Color Emoji to render captions and the playground's terminal emoji; verify with `fc-match 'DejaVu Sans Mono'` and `fc-match 'Noto Color Emoji'`. A custom [Fontconfig configuration](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html) can be supplied through `FONTCONFIG_FILE` when fonts are kept in the checkout.

VHS may download its own Chromium on the first run. On a Linux container where Chromium reports “No usable sandbox”, explicitly opt into VHS's sandbox override:

```bash
VHS_NO_SANDBOX=1 just demo record
```

The recorder does not set that override itself.

Start the managed Caddy with `devhost caddy start` if it is not already running. The recorder checks its admin endpoint and HTTPS listener before capturing scenes. It inherits `DEVHOST_STATE_DIR` and `XDG_STATE_HOME` so route registration uses the same shared state as your normal devhost stacks. `DEVHOST_DEMO_ADMIN` can override the default admin address `127.0.0.1:20197`; this is a control endpoint, not the public demo URL.

Health checks verify HTTPS using the existing root certificate returned by `devhost caddy print-root-cert`. The owned Playwright context ignores certificate errors because a fresh Chromium profile may not trust that local CA. The workflow does not install certificates into your trust store.

The full sequence and annotation scene also require Pi on PATH with a working configured provider/model. This is a real model request and uses that provider’s normal billing. The recorder limits Pi to read/edit tools and guards edits to the copied `PlaygroundLayout.tsx`. It keeps provider extensions but skips skills, context files, prompt templates, and local approval configuration for this isolated fixture. Query and startup scenes do not require Pi.

## Record and refresh

From the repository root:

```bash
just demo record
```

Each run prints its unique directory under `.tmp/demos/recording-*`. Open `devhost-demo.mp4` there. The output is 1280 × 860 at 30 fps: a 1280 × 720 recording plus a 140-pixel caption band. There is no narration or audio track.

Captions use DejaVu Sans Mono at size 37.5 in the band’s own pixel coordinate system, centered horizontally and vertically even when they wrap. Gold rings mark actual mouse clicks; there are no action text labels. The browser requests reduced motion and verifies that the Bun background and React logo animations are disabled.

The sequence shows terminal startup, the log minimap, the toolbar and worktree picker, Alt-click annotation, the real Pi terminal and live source edit, then native TanStack Query. Query is minimized before the final page hold. To iterate on one scene:

```bash
just demo record startup
just demo record overview
just demo record annotations
just demo record query
```

The browser loads the playground and waits for the toolbar and fonts before capture starts. All browser scenes reuse that page, retaining the annotation and live fix without reloading between scenes. A full-page navigation during capture fails the recording; real HMR updates and client-side Query navigation remain visible.

A single-scene run exports that scene as `devhost-demo.mp4`. Run the full command after reviewing the scene to refresh the complete video. `DEVHOST_DEMO_HOST` can override the default `demo.localhost`; it must remain a `.localhost` hostname. Concurrent runs must use distinct hostnames. Existing host claims are protected by `killZombies = false`. Backend services still receive automatic ports behind the proxy; public URLs use standard HTTPS without a port suffix.

## Editing the sequence

Sources live in `packages/devhost-ui/scripts/demo/`:

| Source                                                          | Purpose                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `startup.tape`                                                  | Terminal typing, readiness wait, hold, and hidden shutdown                |
| `recordOverview.ts` / `recordAnnotations.ts` / `recordQuery.ts` | Minimap, toolbar/worktrees, annotation/Pi/HMR, and Query scenes           |
| `createCaptionRecording.ts`                                     | Event-triggered caption changes using native video segments               |
| `createDemoPage.ts` / `recordBrowserScene.ts`                   | Load once outside capture, preserve the page, and reject captured reloads |
| `createBrowserScenes.ts`                                        | Browser interactions, captions, and deliberate viewer pauses              |
| `devhost.toml`                                                  | Real service manifest; environment templates select checkout and hostname |
| `constants.ts`                                                  | Viewport and caption band dimensions                                      |
| `exportClip.ts` / `assembleDemo.ts`                             | Normalize clips, burn captions, and concatenate using measured durations  |

Use accessible roles and names for browser actions. Wait for rendered state or real responses before pacing pauses. Do not replace actual services, logs, restart requests, or native devtools with recording-only imitations. Scenes fail on missing UI, unsuccessful requests, or uncaught page errors, and retain a failure screenshot.

Run `just demo test` while editing helpers. Run root `just fix` and `just check` after changing the workflow; the UI package check includes recorder TypeScript and Bun tests. Also run the affected scene, inspect frames at its beginning/middle/end, and play the exported video before publishing.

The annotation scene changes the copied heading and subtitle through Pi, waits for the rendered HMR result and Pi’s idle state, and checks that the actual source changed. Its caption switches to “Pi is working on the annotated change.” when the terminal reports working, then “The heading updates live from Pi’s source edit.” when the updated heading appears. Native Playwright screencast stop/start creates a video segment at each event; FFmpeg measures those segments to time both burned captions and the final SRT. Model timing varies; the video includes that real wait. Changes to the annotation task must also update its source/result assertions and the edit guard if another file is required.

The copied playground has its own local Git repository on `main` and a real `ui-polish` worktree under its `.workspaces/`. Both checkouts contain usable frontend/backend directories and share the checkout’s installed frontend dependencies. The picker demonstrates these isolated checkouts without switching. Pi uses the adapter’s native working directory in the selected playground checkout. Its instructions provide the copied main layout’s absolute path, and its guard permits edits only to that file. No worktree or commit is added to the contributor’s repository.

## Artifacts and cleanup

Each directory contains the final MP4, `devhost-demo.srt`, `poster.png`, measured `clips.json`, tool/revision metadata in `versions.json`, per-scene screenshots and SRT files, normalized `clips/*.mp4`, and raw VHS/Playwright videos. Each browser scene writes `<scene>-navigations.json` with captured full-page requests; successful scenes contain an empty array. Annotation screenshots include the draft, Pi terminal, and live fix. `pi-changes.json` preserves the edited source for review; `playground-baseline.json` records the original copy. Pi sessions and annotation prompts stay under the run’s `.tmp`. Logs include `vhs.log`, browser-stack logs, `cleanup.log`, and `recording-error.log` on failures.

Browser profiles, artifacts, a copy of the public Caddy root certificate, and the runtime manifest are isolated under that directory. Caddy state and its privileged HTTPS listener are shared with normal devhost stacks; routes belong to the recording manifest. Editor integration is disabled; worktrees are enabled for the copied Git fixture. Temporary Chromium paths use a relative `.tmp` inside the recording directory to fit Linux's Unix socket path limit in deep worktrees.

The recorder closes its browser, stops its stack, and runs manifest-scoped `devhost stop` to collect a terminal scene's stack and remove only its routes. It restores the copied playground after stopping Pi, preserving the actual edits in `pi-changes.json`. Checkout source files are never edited or reset. It leaves the shared Caddy running. SIGINT/SIGTERM request cleanup; a forced SIGKILL cannot execute it. Failed runs retain their logs and media for diagnosis. Remove a run directory only after its processes have stopped. Publish only the reviewed media, not runtime logs and configuration.

There is no automatic upload, release change, or scheduled refresh. Publish the MP4 and optional poster/SRT through the desired channel after reviewing them.
