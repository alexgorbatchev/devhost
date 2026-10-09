---
created_on: 2026-10-06 14:15
last_modified: 2026-10-09 14:24
status: current
---

# Refreshing the devhost demo

Run the recording from the checkout whose UI you want to demonstrate. The recorder rebuilds the CLI and embedded UI and starts real services through devhost. The full sequence becomes a promo of at most 45 seconds: [HyperFrames](https://github.com/heygen-com/hyperframes) composes the captured scenes with narration and music. A single scene and each guide export a silent, captioned H.264 MP4. The promo and single scenes stay in `.tmp/demos/`; guide recordings also update the docs site's media, which you review and then publish.

## Prerequisites

The recording workflow has been validated on Linux. It uses the existing managed Caddy on HTTPS port 443 so the real terminal and browser demonstrate `https://demo.localhost` without a port.

Install the repository dependencies with `bun install`. Recording uses the existing pinned Playwright dependency and Chromium installed by `just ui install-browser`. Also provide Git, `just`, Caddy, [VHS](https://github.com/charmbracelet/vhs), `ttyd`, Bash, `ln`, and FFmpeg/ffprobe on PATH. FFmpeg must support H.264 (`libx264`) and subtitles (`libass`). Install the DejaVu fonts and Noto Color Emoji to render captions and the playground's terminal emoji; verify with `fc-match 'DejaVu Sans Mono'` and `fc-match 'Noto Color Emoji'`. A custom [Fontconfig configuration](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html) can be supplied through `FONTCONFIG_FILE` when fonts are kept in the checkout.

VHS may download its own Chromium on the first run. Where that Chromium reports "No usable sandbox", explicitly opt into VHS's sandbox override:

```bash
VHS_NO_SANDBOX=1 just demo record
```

This happens in Linux containers and on hosts that restrict unprivileged user namespaces, such as Ubuntu with `kernel.apparmor_restrict_unprivileged_userns=1`; VHS then fails with "could not start browser". The recorder does not set that override itself.

Start the managed Caddy with `devhost caddy start` if it is not already running. The recorder checks its admin endpoint and HTTPS listener before capturing scenes. It inherits `DEVHOST_STATE_DIR` and `XDG_STATE_HOME` so route registration uses the same shared state as your normal devhost stacks. `DEVHOST_DEMO_ADMIN` can override the default admin address `127.0.0.1:20197`; this is a control endpoint, not the public demo URL.

Health checks verify HTTPS using the existing root certificate returned by `devhost caddy print-root-cert`. The owned Playwright context ignores certificate errors because a fresh Chromium profile may not trust that local CA. The workflow does not install certificates into your trust store.

The full sequence and annotation scene also require Pi on PATH with a working configured provider/model. This is a real model request and uses that provider's normal billing. The recorder limits Pi to read/edit tools and guards edits to the copied `PlaygroundLayout.tsx`. It keeps provider extensions but skips skills, context files, prompt templates, and local approval configuration for this isolated fixture. Query and startup scenes do not require Pi.

The full sequence also needs Node.js 22 or newer on PATH, which HyperFrames runs on. Before it captures anything, `just demo record` checks that version and has HyperFrames find or download its own Chrome build, about 114 MB on the first run; `just demo promo` does the same once it has checked the recording and before it changes anything in it. An older Node.js or a failed download therefore stops the run before the capture and its Pi request.

HyperFrames keeps that build under `~/.cache/hyperframes` and its own settings under `~/.hyperframes`; both follow `HOME`, so they cannot be moved into a run directory without downloading Chrome again for every run. The promo's render runs with `HYPERFRAMES_NO_TELEMETRY=1` and `HYPERFRAMES_SKIP_SKILLS=1`, so it reports no usage and installs no agent skills on your machine. A render needs no ElevenLabs key: the narration and music are committed files.

## Record and refresh

From the repository root:

```bash
just demo record
```

Each run prints its unique directory under `.tmp/demos/recording-*`. Open `devhost-demo.mp4` there. The promo is 1920 × 1080 at 30 fps with a stereo AAC track, and the recorder fails a render longer than 45 seconds or without audio.

The recorder captures terminal startup, the log minimap, the toolbar and worktree picker, Alt-click annotation, the real Pi terminal and live source edit, then native TanStack Query. Query is minimized before the final page hold. Full-sequence scenes are captured at 2560 × 1440, two device pixels per CSS pixel, so the promo can zoom into the devtools; the page still lays out at 1280 × 720. Gold rings mark actual mouse clicks. The browser requests reduced motion and verifies that the Bun background and React logo animations are disabled.

The promo selects parts of those recordings and never re-creates the interface. A recording longer than its slot plays faster; a shorter one plays at its real speed and holds its last frame. The Pi segment shows the first seconds of the agent's run and carries an on-screen note that the recording is edited for length.

To render the promo again without capturing, reuse the footage of an earlier run:

```bash
just demo promo
just demo promo .tmp/demos/recording-AbC123
DEVHOST_DEMO_QUALITY=draft just demo promo
```

Without an argument the command uses the most recently captured recording that holds every recording the composition requests, so a later single-scene run or a run that failed part-way is skipped. It compares the footage's own timestamps, so rendering an older recording again does not make it the newest. A directory given as the argument is checked the same way before the renderer is prepared and before anything in it is created or replaced, and the command stops when footage is missing. `DEVHOST_DEMO_QUALITY` accepts HyperFrames' `draft`, `looks`, and `delivery`; the default is `delivery`, and `draft` is the fast setting for iterating on the composition. Both `just demo record` and `just demo promo` honor it.

To iterate on one scene:

```bash
just demo record startup
just demo record overview
just demo record annotations
just demo record query
```

A single-scene run exports that scene as a silent `devhost-demo.mp4` of 1280 × 860 at 30 fps: a 1280 × 720 recording plus a 140-pixel caption band. Captions use DejaVu Sans Mono at size 37.5 in the band's own pixel coordinate system, centered horizontally and vertically even when they wrap. Run the full command after reviewing the scene to refresh the promo.

The browser loads the playground and waits for the toolbar and fonts before capture starts. All browser scenes reuse that page, retaining the annotation and live fix without reloading between scenes. A full-page navigation during capture fails the recording; real HMR updates and client-side Query navigation remain visible.

`DEVHOST_DEMO_HOST` can override the default `demo.localhost`; it must remain a `.localhost` hostname. Concurrent runs must use distinct hostnames. Existing host claims are protected by `killZombies = false`. Backend services still receive automatic ports behind the proxy; public URLs use standard HTTPS without a port suffix.

## Public guide demos

Record all twelve guides or refresh one by its documentation slug:

```bash
just demo guides
just demo guides annotations
just demo guides react-highlight
just demo guides service-references
```

The command discovers guide Markdown files, renders each corresponding real workflow, and copies its MP4, WebP poster, and English WebVTT captions to `packages/docs/public/demos/<slug>.*`. It replaces the guide's `guide-demo` block with a native video player at the top and a collapsed text transcript. The prose remains untouched. Assets use full `https://alexgorbatchev.github.io/devhost/demos/` URLs and ship through the existing Pages build. Players use `preload="none"` and play only when requested.

### Where guide videos are stored

Git tracks each guide's poster and captions but not its video. `packages/docs/demo-media.json` pins every video by name, SHA-256, and size, and the files themselves are assets of the `media` release of `alexgorbatchev/devhost`. That release is not a devhost version and is never marked as the latest release.

| Command                   | What it does                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `just docs media`         | Downloads the pinned videos this checkout lacks into `packages/docs/public/demos/`             |
| `just docs publish-media` | Uploads each new or re-rendered video to the release and rewrites its pin in `demo-media.json` |

`just docs dev`, `just docs test`, and `just docs build` run `just docs media` first, so the docs deploy and CI download the videos by themselves and need no token: the release is public. A download is written only after its SHA-256 matches the pin. `just docs check` also fails while a video on disk is not the pinned one, which is the state between a new render and its publication.

A release asset is named after its content, such as `annotations-273a29aa49b00e5f.mp4`, and is never replaced. An earlier commit therefore keeps building with the videos it pinned, and a re-render adds an asset instead of overwriting one. `just docs publish-media` needs the GitHub CLI signed in with write access to the repository. It never removes a pin; delete an entry from `demo-media.json` by hand when a guide is removed.

`just docs media` leaves a video on disk alone when it differs from its pin, because that is a render you have not published yet. To discard such a render, delete the file and run `just docs media` again.

Browser guides cover the minimap, toolbar, worktrees and Query; real Pi annotation/live fixes; and React Highlight. The React Highlight scene launches the stack's generated `devhost-nvim` with a clean headless Neovim configuration, loads its native start packages with `packloadall!`, starts a real TSX Tree-sitter highlighter, moves its actual JSX cursor, and waits for a matching native browser diagnostic and overlay. Set `DEVHOST_DEMO_TSX_PARSER` to an installed `tsx.so` when it is not at the normal `nvim/site/parser/tsx.so` under the host's XDG data directory.

Routing guides capture native VHS terminal sessions and verify real HTTP responses. Docker uses a per-run BusyBox 1.37.0 container with a published loopback port and an unmanaged devhost service; stopping devhost leaves Docker running, then the demo removes its owned container. Daemon mode uses cooperative start/status/stop scripts and checks that its listener disappears. Troubleshooting records a rejected manifest edit, a still-working route, and a corrected live reload. The shared-listener guide owns a separate Caddy state directory, admin endpoint, and allocated HTTP/HTTPS ports, demonstrates both protocols, and stops only that Caddy. Its explicitly configured listener ports are intentionally visible; the other guides use portless HTTPS.

Guide rendering also needs `curl` and `setsid`; Docker needs a working local daemon and permission to pull the tiny public image. Rendering runs serially because guides use `demo.localhost`. Source files are `createGuideTerminalScene.ts`, `createGuideTape.ts`, `recordGuideTerminal.ts`, `recordReactHighlight.ts`, `recordGuides.ts`, and `publishGuideDemo.ts`. Native publication tests use FFmpeg/ffprobe, which CI installs before `just check`.

Review the new media, transcript, and Markdown changes, for example on the playground's `/videos` page. Then run `just docs publish-media` and commit `demo-media.json` together with the posters, captions, and guides. A push of those files to `main` uses `.github/workflows/docs.yml` to deploy them with the newly pinned videos. Agent consumers can follow the HTTPS guide links in `skills/devhost/SKILL.md` and read prose/transcripts without loading binary media.

## Editing the sequence

Sources live in `packages/devhost-ui/scripts/demo/`:

| Source                                                                      | Purpose                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `startup.tape` / `scaleTape.ts`                                             | Terminal typing, readiness wait, hold, and hidden shutdown; the promo's 2× size |
| `recordOverview.ts` / `recordAnnotations.ts` / `recordQuery.ts`             | Minimap, toolbar/worktrees, annotation/Pi/HMR, and Query scenes                 |
| `createCaptionRecording.ts`                                                 | Event-triggered caption changes using native video segments                     |
| `createDemoPage.ts` / `recordBrowserScene.ts`                               | Load once outside capture, preserve the page, and reject captured reloads       |
| `launchDemoBrowser.ts`                                                      | Chromium, with its own device scale for the promo's 2× capture                  |
| `createBrowserScenes.ts`                                                    | Browser interactions, captions, and deliberate viewer pauses                    |
| `devhost.toml`                                                              | Real service manifest; environment templates select checkout and hostname       |
| `constants.ts`                                                              | Viewport, caption band, promo capture scale, and the promo's length limit       |
| `exportClip.ts` / `assembleDemo.ts`                                         | Single scenes and guides: normalize clips, burn captions, and concatenate       |
| `promo/`                                                                    | The promo's HyperFrames project: composition, narration, and audio              |
| `renderPromo.ts` / `renderPromoComposition.ts`                              | Stage a copy of the project in the run directory, render it, and verify it      |
| `readPromoFootageSlots.ts` / `planPromoFootage.ts` / `stagePromoFootage.ts` | Fit each recording into the slot a frame declares                               |
| `readPromoFootageRequests.ts` / `findPromoRecording.ts`                     | List the footage the composition requests and find a recording that has it all  |
| `readPromoSources.ts`                                                       | Name a run's captured videos the way frames request them                        |
| `preparePromoRenderer.ts` / `createPromoRendererEnvironment.ts`             | Check Node.js and fetch HyperFrames' Chrome before a capture or a render        |
| `removePromoRenderCaches.ts`                                                | Remove the renderer's frame cache and install from a run's `.tmp`               |
| `generatePromoAudio.ts`                                                     | Generate the narration and music with ElevenLabs                                |

Use accessible roles and names for browser actions. Wait for rendered state or real responses before pacing pauses. Do not replace actual services, logs, restart requests, or native devtools with recording-only imitations. Scenes fail on missing UI, unsuccessful requests, or uncaught page errors, and retain a failure screenshot.

Run `just demo test` while editing helpers. Run root `just fix` and `just check` after changing the workflow; the UI package check includes recorder TypeScript and Bun tests. Also run the affected scene, inspect frames at its beginning/middle/end, and play the exported video before publishing.

The annotation scene changes the copied heading and subtitle through Pi, waits for the rendered HMR result and Pi's idle state, and checks that the actual source changed. Its caption switches to “Pi is working on the annotated change.” when the terminal reports working, then “The heading updates live from Pi's source edit.” when the updated heading appears. Native Playwright screencast stop/start creates a video segment at each event; FFmpeg measures those segments to time both burned captions and the final SRT. Model timing varies; a single-scene video includes that real wait. Changes to the annotation task must also update its source/result assertions, the edit guard if another file is required, and the source lines the promo's `05-agent.html` frame shows.

The copied playground has its own local Git repository on `main` and a real `ui-polish` worktree under its `.workspaces/`. Both checkouts contain usable frontend/backend directories and share the checkout's installed frontend dependencies. The picker demonstrates these isolated checkouts without switching. Pi uses the adapter's native working directory in the selected playground checkout. Its instructions provide the copied main layout's absolute path, and its guard permits edits only to that file. No worktree or commit is added to the contributor's repository.

## Editing the promo

`packages/devhost-ui/scripts/demo/promo/` is a HyperFrames project. `index.html` places the frames, the narration, and the music on the timeline; `compositions/backdrop.html` and `compositions/frames/*.html` are its sub-compositions. `package.json` pins the HyperFrames release in its scripts, and the recorder runs the `browser` and `render` scripts with `bun run`, which starts the pinned release itself. Bun resolves that release from the npm registry each time, so the preflight and every render need the registry to be reachable even when Bun's cache already holds the packages. The pin fixes the HyperFrames release, not the packages it depends on, which it declares as version ranges. Change the pin with `bun x hyperframes@latest upgrade --project .` from the project directory, then render and review the promo.

A frame asks for footage with a `<video>` element:

```html
<video
  id="agent-result-footage"
  class="clip"
  src="assets/footage/agent-result-footage.mp4"
  data-footage="annotations-3"
  data-footage-from="-4"
  data-start="6.9"
  data-hf-media-start-basis="local"
  data-duration="2.6"
  data-track-index="2"
  muted
  playsinline
></video>
```

`data-footage` names a recording in the run's `raw/` directory by its file name without the extension: `startup`, `overview-1` to `overview-3`, `annotations-1` to `annotations-3`, or `query-1`. `data-footage-from` and `data-footage-to` select seconds within it, and a negative value counts back from its end, which suits recordings whose length varies with the model. `data-duration` is the slot's length. Before each render the recorder writes every requested `src` under `assets/footage/` in the run's copy of the project. It also copies JetBrains Mono, GSAP, and `packages/design/tokens.css` from this package's dependencies into `assets/fonts/` and `assets/vendor/`, so the composition loads nothing from the network. Those three asset directories exist only in a run directory, which makes the run's `promo/` directory the place to open HyperFrames Studio:

```bash
cd .tmp/demos/recording-AbC123/promo
bun run dev
```

Edit the checkout's files, not that copy; the next render replaces it. Sub-compositions inherit the font from `index.html`, which also holds the shared window and label styles and loads the `--dh-*` design tokens. Use those tokens for every devhost color. The window background stays a literal because it must match the recorded terminal.

The render fails on any HyperFrames lint finding. From a run's `promo/` directory, `bun run check` also audits layout and contrast.

### Narration and music

`promo/narration.json` holds the ElevenLabs voice, the spoken lines, and the music as timed sections. `promo/assets/audio/` holds what ElevenLabs generated from it: one MP3 per line, `music.mp3`, and `timings.json` with each file's measured length and word timings. Regenerate them with an exported `ELEVENLABS_API_KEY`:

```bash
just demo audio
just demo audio voice
just demo audio music
```

Each generation bills that ElevenLabs account, and a failed request is not retried. A new take has different lengths, so after regenerating: read `timings.json`, then update each narration clip's `data-start` and `data-duration` in `index.html`, the frames' durations and tween times, and the cut times in the `index.html` script. After new music, measure where its drop and final hit fall and set the music clip's `data-media-start` and volume lane to match the cuts. Run root `just fix` before committing regenerated files.

## Artifacts and cleanup

A promo run's directory contains `devhost-demo.mp4`, the narration captions in `devhost-demo.srt`, `poster.png` from the closing card, `promo-footage.json` with each slot's source window and playback speed, `promo-render.log`, the staged `promo/` project, raw VHS/Playwright videos, per-scene screenshots, and tool/revision metadata in `versions.json`. A single-scene or guide run instead contains its captioned MP4, `devhost-demo.srt`, `poster.png`, measured `clips.json`, per-scene SRT files, and normalized `clips/*.mp4`.

Each browser scene writes `<scene>-navigations.json` with captured full-page requests; successful scenes contain an empty array. Annotation screenshots include the draft, Pi terminal, and live fix. `pi-changes.json` preserves the edited source for review; `playground-baseline.json` records the original copy. Pi sessions and annotation prompts stay under the run's `.tmp`. Logs include `vhs.log`, browser-stack logs, `cleanup.log`, and `recording-error.log` on failures.

A render extracts every source frame and installs HyperFrames under the run's `.tmp`, several hundred megabytes together, and removes both when it ends, whether it succeeded or failed. The check before a capture or a render installs HyperFrames in a `promo-preflight-*` directory of its own under `.tmp/demos/` and removes that directory the same way, so runs started together never share an install.

Browser profiles, artifacts, a copy of the public Caddy root certificate, and the runtime manifest are isolated under that directory. Caddy state and its privileged HTTPS listener are shared with normal devhost stacks; routes belong to the recording manifest. Editor integration is enabled only for the React Highlight guide; worktrees are enabled for the copied Git fixture. Temporary Chromium paths, including those of the promo's render, use a relative `.tmp` inside the recording directory to fit Linux's Unix socket path limit in deep worktrees.

The recorder closes its browser, stops its stack, and runs manifest-scoped `devhost stop` to collect a terminal scene's stack and remove only its routes. A promo run closes the browser and stops the stack before it renders. It restores the copied playground after stopping Pi, preserving the actual edits in `pi-changes.json`. Checkout source files are never edited or reset. It leaves the shared Caddy running. SIGINT/SIGTERM request cleanup; a forced SIGKILL cannot execute it. Failed runs retain their logs and media for diagnosis. Remove a run directory only after its processes have stopped. Publish only the reviewed media, not runtime logs and configuration.

Recorded terminals show absolute paths under the checkout, and the Pi terminal shows the configured provider and model. Review a video for anything you would not publish before sharing it.

There is no automatic upload or scheduled refresh. `just demo record` retains its media locally. `just demo guides` writes the docs site's media locally; only `just docs publish-media`, run by a person after review, uploads a video, and the Pages deployment serves it after an authorized push of its pin.
