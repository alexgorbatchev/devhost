---
created_on: 2026-10-06 14:15
last_modified: 2026-10-21 16:18
status: current
---

# Refreshing the devhost demo

Run the recording from the checkout whose UI you want to demonstrate. The recorder rebuilds the CLI and embedded UI and starts real services through devhost. The full sequence becomes a promo of at most 45 seconds: [HyperFrames](https://github.com/heygen-com/hyperframes) composes the captured scenes with narration. Each guide becomes a narrated film made the same way from its own recording. Neither has music: the narration is the only sound. A single scene exports a silent, captioned H.264 MP4. Single scenes stay in `.tmp/demos/`; promo renders and guide recordings also update the docs site's media, which you review and then publish.

## Prerequisites

The recording workflow has been validated on Linux. It uses the existing managed Caddy on HTTPS port 443 so the real terminal and browser demonstrate `https://demo.localhost` without a port.

Install the repository dependencies with `bun install`. Recording uses the existing pinned Playwright dependency and Chromium installed by `just ui install-browser`. Also provide Git, `just`, Caddy, [VHS](https://github.com/charmbracelet/vhs), `ttyd`, Bash, `ln`, and FFmpeg/ffprobe on PATH. FFmpeg must support H.264 (`libx264`) and subtitles (`libass`). Install the DejaVu fonts and Noto Color Emoji to render captions and the playground's terminal emoji; verify with `fc-match 'DejaVu Sans Mono'` and `fc-match 'Noto Color Emoji'`. A custom [Fontconfig configuration](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html) can be supplied through `FONTCONFIG_FILE` when fonts are kept in the checkout.

`just demo test` also requires Xvfb on Linux. The headed-window regression owns an automatically allocated display with TCP disabled and verifies the native 1280 × 720 content area and 2560 × 1440 capture. The recorder uses Chromium's `Browser.setContentsSize` command so browser decorations do not shrink the captured viewport. This test records only its fixture; it does not run an agent or record a demo film.

VHS may download its own Chromium on the first run. Where that Chromium reports "No usable sandbox", explicitly opt into VHS's sandbox override:

```bash
VHS_NO_SANDBOX=1 DEVHOST_DEMO_INTERACTIVE=1 just demo record
```

This happens in Linux containers and on hosts that restrict unprivileged user namespaces, such as Ubuntu with `kernel.apparmor_restrict_unprivileged_userns=1`; VHS then fails with "could not start browser". The recorder does not set that override itself.

Start the managed Caddy with `devhost caddy start` if it is not already running. The recorder checks its admin endpoint and HTTPS listener before capturing scenes. It inherits `DEVHOST_STATE_DIR` and `XDG_STATE_HOME` so route registration uses the same shared state as your normal devhost stacks. `DEVHOST_DEMO_ADMIN` can override the default admin address `127.0.0.1:20197`; this is a control endpoint, not the public demo URL. Each recording writes that address into the `[caddy]` table of its own devhost config file, `config/devhost/config.toml` under the run directory, which its `XDG_CONFIG_HOME` points at.

Health checks verify HTTPS using the existing root certificate returned by `devhost caddy print-root-cert`. The owned Playwright context ignores certificate errors because a fresh Chromium profile may not trust that local CA. The workflow does not install certificates into your trust store.

The full sequence and annotation scene require Codex on PATH with its normal configured account. Set `DEVHOST_DEMO_INTERACTIVE=1` and provide a graphical desktop: this scene opens headed Chromium. An operator must choose the current tab in the native sharing picker and review any native agent permission requests. The recorder does not auto-approve requests, fake a snapshot, select a model, or override CLI configuration. The prompt requests edits only to the copied `PlaygroundLayout.tsx`; review proposed changes before approval. Query and startup scenes do not require Codex.

The full sequence and every guide also need Node.js 22 or newer on PATH, which HyperFrames runs on. Before it captures anything, `just demo record` checks that version and has HyperFrames find or download its own Chrome build, about 114 MB on the first run; `just demo promo` does the same once it has checked the recording and before it changes anything in it. `just demo guides` and `just demo guide-film` run the same check before they record or render. An older Node.js or a failed download therefore stops the run before the capture and its native agent request.

HyperFrames keeps that build under `~/.cache/hyperframes` and its own settings under `~/.hyperframes`; both follow `HOME`, so they cannot be moved into a run directory without downloading Chrome again for every run. Every render runs with `HYPERFRAMES_NO_TELEMETRY=1` and `HYPERFRAMES_SKIP_SKILLS=1`, so it reports no usage and installs no agent skills on your machine. A render needs no ElevenLabs key: the narration of the promo and of the guides is committed.

## Record and refresh

From the repository root:

```bash
DEVHOST_DEMO_INTERACTIVE=1 just demo record
```

Each run prints its unique directory under `.tmp/demos/recording-*`. Open `devhost-demo.mp4` there. The promo is 1920 × 1080 at 30 fps with a stereo AAC track, and the recorder fails a render longer than 45 seconds or without audio.

The recorder captures terminal startup, the log minimap, toolbar and worktree picker, selected page context in native chat, a genuine tab-sharing request and native Codex source edit, then TanStack Query. Full-sequence scenes retain their 2560 × 1440 capture and 1280 × 720 layout. Gold rings mark actual clicks. Reduced motion disables the playground background and React logo animations.

The promo selects real recordings rather than recreating the interface. The existing published promo and guide narration still describe the retired Pi/Vim workflows. Before rendering replacement annotation or React Highlight films, update the narration, regenerate the affected audio with billing authorization, and inspect the promo's agent frame. No new film has been recorded or approved for these flows.

Every promo render also writes the copy the docs landing page shows: a web encode, the end card's last frame as poster, and the captions as `packages/docs/public/demos/promo.{mp4,webp,vtt}`, plus the player block `packages/docs/src/promoDemo.html`. `packages/docs/sync.ts` opens the landing page with that block. Publish and commit them as for a guide film: see [Where guide videos are stored](#where-guide-videos-are-stored).

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
DEVHOST_DEMO_INTERACTIVE=1 just demo record annotations
just demo record query
```

A single-scene run exports that scene as a silent `devhost-demo.mp4` of 1280 × 860 at 30 fps: a 1280 × 720 recording plus a 140-pixel caption band. Captions use DejaVu Sans Mono at size 37.5 in the band's own pixel coordinate system, centered horizontally and vertically even when they wrap. Run the full command after reviewing the scene to refresh the promo.

devhost answers a browser navigation with its own startup page until a service passes its health check, while other requests already reach the app. The recorder therefore waits until the API answers and a navigation, a request with `Sec-Fetch-Dest: document`, reaches the playground. The browser then loads the playground and waits for the toolbar and fonts before capture starts. All browser scenes reuse that page, retaining the annotation and live fix without reloading between scenes. A full-page navigation during capture fails the recording; real HMR updates and client-side Query navigation remain visible.

`DEVHOST_DEMO_HOST` can override the default `demo.localhost`; it must remain a `.localhost` hostname. Concurrent runs must use distinct hostnames. Existing host claims are protected by `killZombies = false`. Backend services still receive automatic ports behind the proxy; public URLs use standard HTTPS without a port suffix.

## Public guide demos

Record all twelve guides or refresh one by its documentation slug:

```bash
just demo guides
DEVHOST_DEMO_INTERACTIVE=1 just demo guides annotations
just demo guides react-highlight
just demo guides service-references
```

The command discovers guide Markdown files and records each corresponding real workflow. Each guide becomes a narrated film of 1920 × 1080 at 30 fps and at most 45 seconds, rendered by the HyperFrames release the promo pins. A film opens on a title card with the guide's title from its front matter, shows the recording in a window while a voice explains each step, and closes on a card with the docs address. The words of the current line appear under the window as they are spoken.

The command also updates the docs site's media. It writes the film's web encode, WebP poster, and English WebVTT captions to `packages/docs/public/demos/<slug>.*`, and replaces the guide's `guide-demo` block with a native video player at the top. The poster is the frame a browser scene marks by calling its `markPoster` argument while that frame is on screen, such as the annotations scene's finished draft. A guide with no mark shows the frame at the end of its first step, which shows that step's result; the title card before it looks the same in every guide. `planGuideFilm.ts` maps the mark to its time in the film, following the clip's window and playback speed, and keeps it inside the clip's step. The prose remains untouched. Assets use full `https://alexgorbatchev.github.io/devhost/demos/` URLs and ship through the existing Pages build. Players use `preload="none"` and play only when requested.

The docs site does not get the render itself. `publishGuideDemo.ts` encodes it again for the web: H.264 at CRF 27 with AAC audio at 128 kbit/s, and its index first so playback starts while the file downloads.

### How a guide film is put together

`guide/index.html` is the one HyperFrames template for all guides, and `guide/narration.json` holds each guide's spoken lines: an intro for the title card and one line per recorded clip. A terminal guide's clips are its steps, `step-1` onward in the order `createGuideTerminalScene.ts` lists them. A browser guide's clips are the segments its scenes record, such as `annotations-1` or `overview-2`. The render stops when the recorded clips are not the ones the narration has lines for, so a new step needs a line and its audio.

A terminal guide is one VHS recording, captured at 2560 × 1440. The tape clears the screen out of sight before each step, and the recorder finds each step at the frame where the picture falls back to an empty screen. It does not time steps by the tape's pauses, because at this size VHS's video runs faster than the session it recorded. A recording that clears its screen a different number of times than it has steps fails the run. Browser guides capture at two device pixels per CSS pixel, as the promo does.

`planGuideFilm.ts` times a film from the measured audio. The title card stays for at least 2.4 seconds and until the intro line has ended. A clip plays at its recorded speed and holds its last frame when its line is longer. When a film would pass 45 seconds, the clips that can spare time play faster in proportion, and none becomes shorter than its line. Narration that cannot fit in 45 seconds fails the render.

To render a film again without recording, for example after editing the template or the narration:

```bash
just demo guide-film stack-lifecycle
```

It uses the guide's most recently captured recording under `.tmp/demos/`, whose `guide.json` keeps what was recorded, and updates the docs site's media the same way.

### Where guide videos are stored

Git tracks each guide's poster and captions but not its video. `packages/docs/demo-media.json` pins every video by name, release asset, SHA-256, and size, and the files themselves are assets of the `media` release of `alexgorbatchev/devhost`. That release is not a devhost version and is never marked as the latest release.

| Command                   | What it does                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `just docs media`         | Downloads the pinned videos this checkout lacks into `packages/docs/public/demos/`             |
| `just docs publish-media` | Uploads each new or re-rendered video to the release and rewrites its pin in `demo-media.json` |

`just docs run`, `just docs test`, and `just docs build` run `just docs media` first, so the docs deploy and CI download the videos by themselves and need no token: the release is public. A download is written only after its SHA-256 matches the pin. `just docs check` also fails while a video on disk is not the pinned one, which is the state between a new render and its publication.

A release asset is named after its content, such as `annotations-273a29aa49b00e5f.mp4`, and is never replaced. An earlier commit therefore keeps building with the videos it pinned, and a re-render adds an asset instead of overwriting one. `just docs publish-media` needs the GitHub CLI signed in with write access to the repository. It never removes a pin; delete an entry from `demo-media.json` by hand when a guide is removed.

`just docs media` leaves a video on disk alone when it differs from its pin, because that is a render you have not published yet. To discard such a render, delete the file and run `just docs media` again.

To see what is published, open the release at <https://github.com/alexgorbatchev/devhost/releases/tag/media>, or the playground's `/videos` page: each guide's card says whether the video on disk is the published one and links to the published copy in the release.

Browser source-highlight recording publishes real JSX locators to `/__devhost__/react-highlight/cursor`, waits for a matching `devhost:react-highlight` diagnostic with a positive match count, and verifies the native overlay. It clears the highlight with a null locator. This does not launch Vim or require a Tree-sitter parser. The annotation scene requires an operator for native tab sharing and native approvals.

Routing guides capture native VHS terminal sessions and verify real HTTP responses. Docker uses a per-run BusyBox 1.37.0 container with a published loopback port and an unmanaged devhost service; stopping devhost leaves Docker running, then the demo removes its owned container. Daemon mode uses cooperative start/status/stop scripts and checks that its listener disappears. Troubleshooting records a rejected manifest edit, a still-working route, and a corrected live reload. The shared-listener guide owns a separate Caddy state directory, admin endpoint, and allocated HTTP/HTTPS ports, demonstrates both protocols, and stops only that Caddy. Its explicitly configured listener ports are intentionally visible; the other guides use portless HTTPS.

Guide recording also needs `curl` and `setsid`; Docker needs a working local daemon and permission to pull the tiny public image. Guides are recorded serially because they use `demo.localhost`. The recording sources are `createGuideTerminalScene.ts`, `createGuideTape.ts`, `recordGuideTerminal.ts`, `recordReactHighlight.ts`, `recordGuides.ts`, and `publishGuideDemo.ts`; [Editing the sequence](#editing-the-sequence) lists the film's. Native publication tests use FFmpeg/ffprobe, which CI installs before `just check`.

Review the new media, posters, and Markdown changes, for example on the playground's `/videos` page. Then run `just docs publish-media` and commit `demo-media.json` together with the posters, captions, and guides. The next CLI release deploys them with the newly pinned videos: the docs site is built from the release tag, not from `main`. Agent consumers can follow the HTTPS guide links in `skills/devhost/SKILL.md` and read the guide prose without loading binary media.

## Demo coverage

This table lists each user-visible feature, the page or section that documents it, and the clips that show it. A feature counts as shown only when a narration line names it: a control that happens to be on screen while the narration talks about something else is not covered. Clip IDs are the keys in `guide/narration.json`; `promo` lines are the IDs in `promo/narration.json`.

When a change adds or alters a user-visible feature, update its row in the same change. Add a row for a new feature, with **No demo** when no film shows it. When a film is re-recorded, check the rows that point at it.

### Stacks and services

| Feature                                                                                   | Documented in                                                                                                             | Shown in                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Serve files or a port without a manifest; shared-design listings and Markdown source view | `reference/files.md`                                                                                                      | No demo                                          |
| Managed Caddy defaults to all IPv4/IPv6 interfaces with HTTPS only                        | `guides/managed-caddy.md`, "Managed Caddy defaults"; `guides/shared-managed-caddy-settings.md`                            | No demo                                          |
| Prefixed, screened Caddy diagnostics and actionable startup failures                      | `guides/troubleshooting.md`, "Caddy is unavailable or cannot start"; `guides/stack-lifecycle.md`                          | No demo                                          |
| Local CA trusted once when devhost starts Caddy; untrusted-CA warning                     | `guides/managed-caddy.md`, "Prepare Caddy"; `guides/troubleshooting.md`, "Browsers reject devhost HTTPS certificates"     | No demo                                          |
| Start a stack in dependency order, stop it with one command                               | `guides/stack-lifecycle.md`                                                                                               | `stack-lifecycle` step-1 to step-5; promo line-3 |
| Start part of a stack by naming services                                                  | `guides/stack-lifecycle.md`, "Starting part of a stack"                                                                   | No demo                                          |
| Named service groups                                                                      | `guides/stack-lifecycle.md`, "Named service groups"                                                                       | No demo                                          |
| Start a stopped service from the Services panel                                           | `guides/stack-lifecycle.md`, "Stopped services"; `guides/devtools.md`                                                     | No demo                                          |
| Shared-design 404, startup and recovery pages; development page gallery                   | `guides/stack-lifecycle.md`, "Startup and recovery pages"; `development/page-previews.md`                                 | No demo                                          |
| Configuration hot reload, applied and rejected                                            | README, "Configuration Hot Reload"; `guides/stack-lifecycle.md`; `guides/troubleshooting.md`, "Manifest changes rejected" | `troubleshooting` step-4 to step-9               |
| Unmanaged services, such as a Docker container                                            | `guides/docker-backed-services.md`                                                                                        | `docker-backed-services` step-1 to step-9        |
| Daemon-style services with start, status, and stop commands                               | `guides/managed-daemon-style-services.md`                                                                                 | `managed-daemon-style-services` step-1 to step-6 |
| Service commands run without a shell                                                      | README, "Service Commands"                                                                                                | No demo                                          |
| Zombie process recovery                                                                   | README, "Zombie Process Recovery"; `guides/troubleshooting.md`, "Zombie cleanup messages"                                 | No demo                                          |
| Development servers that require a local origin                                           | README, "Development Servers That Require a Local Origin"                                                                 | No demo                                          |

### Manifest

| Feature                                                                                                                                          | Documented in                                                                                              | Shown in                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Port, bind host, hostname, and service variables passed to a service                                                                             | `guides/environment-variables.md`                                                                          | `environment-variables` step-1 to step-4 |
| Environment interpolation with `{{ env.NAME }}`                                                                                                  | README, "Manifest Interpolation"                                                                           | No demo                                  |
| Service references with `{{ services.<name>.<property> }}`                                                                                       | README, "Late-Binding Service References"; `guides/service-references.md`                                  | `service-references` step-1 to step-4    |
| Health checks with automatic ports                                                                                                               | `guides/service-references.md`, "Health checks with automatic ports"                                       | No demo                                  |
| Manifest includes                                                                                                                                | README, "Manifest Includes"; `guides/manifest-includes.md`                                                 | `manifest-includes` step-1 to step-6     |
| Running an included manifest on its own                                                                                                          | `guides/manifest-includes.md`, "Sub-Manifest Solo Runs & Override Protection"                              | No demo                                  |
| Reject overlapping root and included manifests at startup and reload; startup error prefix, home-path shortening, and context-aware stop command | `guides/manifest-includes.md`, "Sub-Manifest Solo Runs & Override Protection"; `guides/troubleshooting.md` | No demo                                  |

### Routing

| Feature                                                               | Documented in                                                                                               | Shown in                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| HTTPS hostnames through the managed Caddy                             | `guides/managed-caddy.md`                                                                                   | `managed-caddy` step-3; promo line-2             |
| Routing services by path on one hostname                              | `guides/managed-caddy.md`                                                                                   | `managed-caddy` step-1, step-4, step-5           |
| Multiple hostnames for one service                                    | README, "Multiple Domains for One Service"; `guides/managed-caddy.md`, "Multiple hostnames for one service" | No demo                                          |
| Shared Caddy settings in `config.toml`: plain HTTP and listener ports | `guides/shared-managed-caddy-settings.md`                                                                   | `shared-managed-caddy-settings` step-1 to step-5 |
| Saving `config.toml` moves the running shared Caddy                   | README; `guides/shared-managed-caddy-settings.md`, "Changing the settings while stacks run"                 | No demo                                          |

### Devtools

| Feature                                                                                                                                         | Documented in                                             | Shown in                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Log minimap with real-time service output                                                                                                       | `guides/devtools.md`                                      | `devtools` overview-1; promo line-4                                   |
| Services panel with restart controls                                                                                                            | `guides/devtools.md`                                      | `devtools` overview-2; promo line-4; toolbar reload icon: **No demo** |
| Worktree picker and worktree search                                                                                                             | README, "Git Worktrees"; `guides/devtools.md`             | `devtools` overview-3                                                 |
| Submodule checkout discovery, external owning manifests, and red worktree error icon                                                            | `guides/devtools.md`                                      | **No demo**                                                           |
| Service status updates with unavailable checkouts                                                                                               | `guides/devtools.md`                                      | **No demo**                                                           |
| Recovery dialog after a service exits; stack shutdown preserves the loaded app without flashing recovery and cancels health polling immediately | `guides/devtools.md`, `guides/stack-lifecycle.md`         | No demo                                                               |
| Host resource usage                                                                                                                             | `guides/devtools.md`, "Host resource usage"               | No demo                                                               |
| Toolbar layout on narrow viewports                                                                                                              | `guides/devtools.md`                                      | No demo                                                               |
| TanStack Query devtools in the toolbar                                                                                                          | `guides/devtools.md`; `architecture/external-devtools.md` | `devtools` query-1; promo line-5                                      |
| Other third-party devtools: native React DevTools, Redux Toolkit, Zustand, Vue, the TanStack shell, React Hook Form, Jotai                      | `architecture/external-devtools.md`                       | No demo                                                               |
| Open component source                                                                                                                           | `guides/devtools.md`, "Open component source"             | No demo                                                               |
| Automatic idle timeout                                                                                                                          | `guides/devtools.md`, "Automatic Idle Timeout"            | No demo                                                               |
| Control API                                                                                                                                     | `guides/devtools.md`, "Control API"                       | No demo                                                               |

### Browser chat, context and editor

| Feature                                                                                                                                                 | Documented in                                                         | Shown in    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------- |
| Browser chat through installed Codex or Claude Code, using native catalogs and configured accounts                                                      | README, "Browser chat and page context"; `guides/annotations.md`      | **No demo** |
| Chat Settings captures pointer input above page controls and restores page interaction when closed                                                      | `guides/annotations.md`, "Connect an installed CLI"                   | **No demo** |
| Native turn interruption, conversation replay, explicit approvals and questions                                                                         | `guides/annotations.md`; `architecture/chat.md`                       | **No demo** |
| Restore chat visibility, side, conversation, text draft, harness/model and scroll after navigation and reload; New Conversation beside Share Tab        | `guides/annotations.md`; `architecture/chat.md`                       | **No demo** |
| Composer stays at the panel bottom; settings dialog; collapsed sent context and contrasting user bubbles                                                | `guides/annotations.md`                                               | **No demo** |
| Composer focus on open and new page context; replies followed only at the bottom; devtools keys kept from host shortcuts; Escape in composer interrupts | `guides/annotations.md`; `guides/devtools.md`; `architecture/chat.md` | **No demo** |
| Select page and devhost UI elements with source metadata; host-page selection plugins                                                                   | `guides/annotations.md`, "Select page context"                        | **No demo** |
| Drawing and selection above page/devhost native popovers and modal dialogs; send while the target stays open; retain annotated surfaces in snapshots    | `guides/annotations.md`, "Draw over the page"                         | **No demo** |
| Share Tab beside Send; reuse an active share for snapshots; clear context after confirmed submission                                                    | `guides/annotations.md`, "Share one tab snapshot"                     | **No demo** |
| Source-locator highlights through the retained instance control API                                                                                     | `guides/react-highlight.md`                                           | **No demo** |

### CLI

| Feature                                                                            | Documented in                                                        | Shown in                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Output for agents and scripts; shared diagnostic prefixes and home-path formatting | README, "Output for agents and scripts"; `guides/stack-lifecycle.md` | No demo for errors or home-path formatting; stop progress appears in the final stop step of all nine terminal guides |
| Shell completion                                                                   | README, "Shell completion"                                           | No demo                                                                                                              |
| The devhost skill for coding agents                                                | README, "AI devhost skill"                                           | No demo                                                                                                              |

Pages under `guides/` are in `packages/docs/src/content/docs/guides/`, and `architecture/` pages beside them; the README is `apps/devhost/README.md`. The table leaves out sections that describe setup or failure diagnosis rather than a feature, such as installation, requirements, and the troubleshooting entries other than reload.

## Editing the sequence

Sources live in `packages/devhost-ui/scripts/demo/`:

| Source                                                                      | Purpose                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `startup.tape` / `scaleTape.ts`                                             | Terminal typing, readiness wait, hold, and hidden shutdown; the promo's 2× size  |
| `recordOverview.ts` / `recordAnnotations.ts` / `recordQuery.ts`             | Minimap, toolbar/worktrees, native chat/context/HMR, and Query scenes            |
| `createCaptionRecording.ts`                                                 | Event-triggered caption changes using native video segments, and the poster mark |
| `createDemoPage.ts` / `recordBrowserScene.ts`                               | Load once outside capture, preserve the page, and reject captured reloads        |
| `launchDemoBrowser.ts`                                                      | Chromium, with its own device scale for the promo's 2× capture                   |
| `createBrowserScenes.ts`                                                    | Browser interactions, captions, and deliberate viewer pauses                     |
| `devhost.toml`                                                              | Real service manifest; environment templates select checkout and hostname        |
| `constants.ts`                                                              | Viewport, caption band, capture scales, card lengths, and the length limit       |
| `isDemoStackReady.ts` / `startDemoStack.ts`                                 | Start the stack and wait until a browser navigation reaches the playground       |
| `exportClip.ts` / `assembleDemo.ts`                                         | Single scenes: normalize clips, burn captions, and concatenate                   |
| `film.css`                                                                  | The window, label, and backdrop styles the promo and the guide films share       |
| `guide/`                                                                    | The guide films' HyperFrames template, narration, and audio                      |
| `renderGuideFilm.ts` / `planGuideFilm.ts` / `createGuideComposition.ts`     | Time a guide's clips to its narration, fill the template, and render it          |
| `findGuideStepWindows.ts` / `readFrameBrightness.ts`                        | Find a terminal guide's steps where its recording clears the screen              |
| `renderGuide.ts` / `findGuideRecording.ts`                                  | Render a guide's film again from its latest recording                            |
| `generateGuideAudio.ts` / `readGuideNarration.ts`                           | Generate the guide films' narration with ElevenLabs                              |
| `speakLine.ts` / `audioSchemas.ts`                                          | Speak one narration line, for the promo and the guide films                      |
| `createSpeechRequest.ts` / `hashSpeechRequest.ts`                           | Build and hash a line's ElevenLabs request, so an unchanged line keeps its take  |
| `promo/`                                                                    | The promo's HyperFrames project: composition, narration, and audio               |
| `renderPromo.ts` / `renderPromoComposition.ts`                              | Stage a copy of the project in the run directory, render it, and verify it       |
| `readPromoFootageSlots.ts` / `planPromoFootage.ts` / `stagePromoFootage.ts` | Fit each recording into the slot a frame declares                                |
| `readPromoFootageRequests.ts` / `findPromoRecording.ts`                     | List the footage the composition requests and find a recording that has it all   |
| `readPromoSources.ts`                                                       | Name a run's captured videos the way frames request them                         |
| `preparePromoRenderer.ts` / `createPromoRendererEnvironment.ts`             | Check Node.js and fetch HyperFrames' Chrome before a capture or a render         |
| `removePromoRenderCaches.ts`                                                | Remove the renderer's frame cache and install from a run's `.tmp`                |
| `generatePromoAudio.ts`                                                     | Generate the narration with ElevenLabs                                           |

Use accessible roles and names for browser actions. Wait for rendered state or real responses before pacing pauses. Do not replace actual services, logs, restart requests, or native devtools with recording-only imitations. Scenes fail on missing UI, unsuccessful requests, or uncaught page errors, and retain a failure screenshot.

Run `just demo test` while editing helpers. Run root `just fix` and `just check` after changing the workflow; the UI package check includes recorder TypeScript and Bun tests. Also run the affected scene, inspect frames at its beginning/middle/end, and play the exported video before publishing.

The annotation scene selects an actual heading, fills the native chat composer, uses Codex with its configured default model, and sends selected page context through the native tab picker. It waits for the real running state, HMR heading update, actual copied-source edit, and idle state. It never decides permissions for the operator. The source script has not been filmed against the integrated workflow; the coverage table remains **No demo** until a replacement film is reviewed.

The copied playground has an isolated Git repository and a real `ui-polish` worktree. Both contain usable frontend/backend directories and share installed frontend dependencies. The overview scene searches these checkouts without switching. The native chat retains the selected checkout's actual working directory; the recording prompt names the copied layout's absolute path. No worktree or commit is added to the contributor's repository.

## Editing the promo

`packages/devhost-ui/scripts/demo/promo/` is a HyperFrames project. `index.html` places the frames and the narration on the timeline; `compositions/backdrop.html` and `compositions/frames/*.html` are its sub-compositions. `package.json` pins the HyperFrames release in its scripts, and the recorder runs the `browser` and `render` scripts with `bun run`, which starts the pinned release itself. Bun resolves that release from the npm registry each time, so the preflight and every render need the registry to be reachable even when Bun's cache already holds the packages. The pin fixes the HyperFrames release, not the packages it depends on, which it declares as version ranges. Change the pin with `bun x hyperframes@latest upgrade --project .` from the project directory, then render and review the promo.

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

Edit the checkout's files, not that copy; the next render replaces it. Sub-compositions inherit the font from `index.html`, which loads the `--dh-*` design tokens and `film.css`. That stylesheet holds the window, label, and backdrop styles the promo shares with the guide films, and each render stages it as `assets/vendor/devhost-film.css`. Use the tokens for every devhost color. The window background stays a literal because it must match the recorded terminal.

The render fails on any HyperFrames lint finding. From a run's `promo/` directory, `bun run check` also audits layout and contrast.

### Narration

`promo/narration.json` holds the ElevenLabs voice and the spoken lines. The promo has no music. `promo/assets/audio/` holds what ElevenLabs generated from the narration: one MP3 per line, and `timings.json` with each file's measured length and word timings. Regenerate them with an exported `ELEVENLABS_API_KEY`:

```bash
just demo audio
```

The command speaks every line again. Each generation bills that ElevenLabs account, and a failed request is not retried. A new take has different lengths, so after regenerating: read `timings.json`, then update each narration clip's `data-start` and `data-duration` in `index.html`, the frames' durations and tween times, and the cut times in the `index.html` script. A frame cuts just before its first line starts, and the devtools and agent frames hold a second line over their last shot, so no shot plays in silence. Keep a cue at the word it illustrates, and end a narration clip where its speech ends, which is before the end of its file. Run root `just fix` before committing regenerated files.

### Guide narration

`guide/narration.json` holds the voice and the lines of every guide. `guide/assets/audio/` holds what ElevenLabs generated from the narration: `voice/<slug>/<clip>.mp3` for each line, and `timings.json`. Generate them with an exported `ELEVENLABS_API_KEY`:

```bash
just demo audio-guides
just demo audio-guides stack-lifecycle
just demo audio-guides stack-lifecycle retake
just demo audio-guides all retake
```

The first argument limits the lines to one guide; `all`, the default, selects every guide.

A line keeps its take until its request changes. `timings.json` records with each take, as `requestSha256`, the hash of the request it was generated from: the voice and its settings, the model, the line, and the lines before and after it, which ElevenLabs receives as context. A run speaks only the lines whose hash no longer matches or whose MP3 is missing, and prints how many it generated. Rewording one line therefore speaks that line and the lines beside it again. To retake lines that have not changed, pass `retake` as the second argument for every selected line, or delete one line's MP3 and run the command. Do not edit `timings.json` or replace an MP3 by hand: a take is trusted because its recorded request matches. Changing the voice or one of its settings in `narration.json` changes every request, so the next run speaks every line again.

Each request bills that ElevenLabs account, and a failed request is not retried. Every take is recorded as it is made, so the run after a failed one continues at the line that failed. A guide film needs no re-timing by hand, because every render reads the measured lengths: render the affected guides again with `just demo guide-film <slug>`. Keep a line to what its clip shows.

## Artifacts and cleanup

A promo run's directory contains `devhost-demo.mp4`, the narration captions in `devhost-demo.srt`, `poster.png` from the closing card, `promo-footage.json` with each slot's source window and playback speed, `promo-render.log`, the staged `promo/` project, raw VHS/Playwright videos, per-scene screenshots, and tool/revision metadata in `versions.json`. A guide run's directory contains `devhost-demo.mp4`, the narration captions in `devhost-demo.srt`, `poster.png`, `guide.json` with the clips that were recorded and the poster frame a scene marked, `guide-footage.json` with each clip's source window and playback speed, `promo-render.log`, the staged `guide/` project, `guide-film.json` with when each clip plays in the film and the time of its poster, and the raw VHS/Playwright videos. A single-scene run instead contains its captioned MP4, `devhost-demo.srt`, `poster.png`, measured `clips.json`, per-scene SRT files, and normalized `clips/*.mp4`.

Each browser scene writes `<scene>-navigations.json`; successful scenes contain no full-page navigations. Annotation screenshots include the draft, native agent progress, and live fix. `agent-changes.json` retains edited copied source for review, while `playground-baseline.json` retains the original. Native CLI session persistence follows the user's configured CLI behavior rather than recording-only Pi session flags. Logs include stack output, `cleanup.log`, and `recording-error.log`.

A render extracts every source frame and installs HyperFrames under the run's `.tmp`, several hundred megabytes together, and removes both when it ends, whether it succeeded or failed. The check before a capture or a render installs HyperFrames in a `promo-preflight-*` directory of its own under `.tmp/demos/` and removes that directory the same way, so runs started together never share an install.

Browser profiles, artifacts, a copy of the public Caddy root certificate, and the runtime manifest are isolated under that directory. Caddy state and its privileged HTTPS listener are shared with normal devhost stacks; routes belong to the recording manifest. Editor integration is enabled only for the React Highlight guide; worktrees are enabled for the copied Git fixture. Temporary Chromium paths, including those of the promo's render, use a relative `.tmp` inside the recording directory to fit Linux's Unix socket path limit in deep worktrees.

The recorder closes its browser, stops its stack, and runs manifest-scoped `devhost stop` to collect a terminal scene's stack and remove only its routes. A promo run closes the browser and stops the stack before it renders. It restores the copied playground after stopping native chat processes, preserving the actual edits in `agent-changes.json`. Checkout source files are never edited or reset. It leaves the shared Caddy running. SIGINT/SIGTERM request cleanup; a forced SIGKILL cannot execute it. Failed runs retain their logs and media for diagnosis. Remove a run directory only after its processes have stopped. Publish only the reviewed media, not runtime logs and configuration.

Recorded CLI output and native chat may expose local paths, account information, tool input, and model details. Review footage and native permission details before approving publication.

There is no automatic upload or scheduled refresh. `just demo record` retains its media locally. `just demo guides` writes the docs site's media locally; only `just docs publish-media`, run by a person after review, uploads a video, and the Pages deployment serves it after an authorized push of its pin.
