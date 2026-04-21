# Demo Recording Script

This file is the recording runbook for the marketing feature replays.

## Automated capture

The marketing replays are now generated artifacts.

1. Install Chromium once if needed: `bun run record:marketing:install-browser`
2. Regenerate every replay JSON: `bun run record:marketing`
3. Regenerate one replay JSON: `bun run record:marketing <scenario-id>`
4. Reload `www` and confirm the matching replay tab now plays the new capture.

Available scenario ids:

- `annotation`
- `source-jumps`
- `sessions`
- `overlay`
- `routing-health`

The recorder starts a temporary local dev server, opens the dev-only capture route, drives the page with Playwright at a fixed viewport, and writes directly into `packages/www/public/recordings/marketing/*.json`.

## Recording targets

- `packages/www/public/recordings/marketing/annotation.json`
- `packages/www/public/recordings/marketing/source-jumps.json`
- `packages/www/public/recordings/marketing/sessions.json`
- `packages/www/public/recordings/marketing/overlay.json`
- `packages/www/public/recordings/marketing/routing-health.json`

## Global setup for every take

1. Keep the automated recorder's fixed desktop viewport for every capture.
2. Keep the theme constant across all five takes.
3. Treat the capture route fixtures as the source of truth; change those fixtures instead of hand-editing the exported JSON.
4. Keep each recording short. If the feature needs narration, put that in the page copy, not in extra idle time.
5. When the devtools UI changes, rerun the recorder instead of manually re-performing each flow.

## Recorder authoring notes

- Treat the recorder as cinematic choreography, not just a functional test. Modifier-key timing, hover timing, pauses, and tray state changes all change what the replay communicates.
- Do not hold modifier keys during approach movement unless the replay is supposed to show that state the whole time.
- For annotation demos, show the highlight state before selection instead of during travel.
- The annotation take now uses a live agent CLI session plus a real Neovim source jump. Expect some terminal timing drift and visually verify the finished replay instead of assuming the PTY output stayed photogenic.
- After changing recorder choreography, rerun the affected scenario and visually inspect the replay tab in `www`, not just the automated checks.

## 1. Annotation handoff

**Target file:** `packages/www/public/recordings/marketing/annotation.json`

**Goal:** prove that page evidence can be tagged, handed into Pi, expanded back into a real terminal session, and then carried straight into source navigation without leaving the browser workflow.

### Steps

1. Open the routed page in its steady state.
2. Move to the first meaningful page element before entering annotation mode.
3. Hold `Alt` so the annotation affordances become visible.
4. Wiggle slightly on the first element and pause so the highlight state is obvious.
5. Select the first element.
6. Move to the second element with `Alt` still held, pause briefly, then select it.
7. Open the annotation draft UI.
8. Type a short, concrete note that references the selected elements.
9. Show that the draft includes page context and selected targets.
10. Submit the handoff into Pi and wait for the minimized terminal tray to appear.
11. Expand the Pi terminal preview, hold on the live terminal for about five seconds, then minimize it again.
12. Hold on the minimized tray for about five more seconds so the recovery path is obvious.
13. Move to the source-jump target card and wiggle on it for about one second.
14. Hold `Alt`, right-click the source-jump target, and wait about one second for the source menu.
15. Move to the first source menu item, wiggle for about one second, then click to open Neovim.
16. Keep the editor visible, wiggle on the Neovim terminal, then scroll down slowly for about two seconds.
17. Scroll back up slowly for about two seconds.
18. Move to the minimize control, wait about one second, then minimize the editor session into the tray.
19. Leave the tray state visible for a beat so the combined browser-to-terminal-to-source loop reads cleanly.

### Timing notes

- The cursor should reach the first target before `Alt` goes down.
- Keep roughly a one-second pause after the first highlight wiggle and another roughly one-second pause on the second target before selecting it.
- Release `Alt` after the second selection and before typing into the annotation draft.
- After the Pi session opens, hold the expanded panel for roughly five seconds before minimizing and hold the minimized tray for roughly five more seconds before starting the source-jump portion.
- For the source jump, wiggle the page target, the source menu item, and the Neovim terminal for roughly one second each.
- Keep the Neovim scroll deliberate enough that the replay clearly shows down-then-up movement instead of a single jump.

## 2. Source navigation

**Target file:** `packages/www/public/recordings/marketing/source-jumps.json`

**Goal:** show that the page can jump directly to the relevant React source instead of forcing manual tracing.

### Steps

1. Open the routed page.
2. Move to a component with an obvious visual boundary.
3. Hold `Alt` and use the source-jump gesture you want to document.
4. Pause briefly on the inspected component so the target is clear.
5. Trigger the source jump.
6. Show the configured editor opening the nearest relevant source file.
7. Keep the destination file on screen long enough for the jump to register.
8. Return to the page if needed so the loop from page to code is visually complete.

## 3. Terminal sessions

**Target file:** `packages/www/public/recordings/marketing/sessions.json`

**Goal:** demonstrate that the editor or agent session stays attached to the inspection loop inside the browser surface.

### Steps

1. Open the routed page.
2. Start from an inspected component or an existing annotation so the session has context.
3. Open the embedded terminal session.
4. Show the session tray or session list.
5. Open Neovim or the terminal workflow you want to feature.
6. Perform one minimal action inside the terminal so it is obviously live.
7. Return attention to the page without dismissing the session.
8. Show that the session remains attached and recoverable from the browser workflow.

### Troubleshooting

- If the replay shows a blank or placeholder-looking terminal surface, assume `packages/www/public/recordings/marketing/sessions.json` may be stale before assuming the UI work is unfinished.
- Rerun `bun run record:marketing sessions` and reload the app before debugging the capture surface or replay UI.
- After regeneration, visually confirm the replay shows terminal text plus the minimize and restore flow.

## 4. Devtools overlay

**Target file:** `packages/www/public/recordings/marketing/overlay.json`

**Goal:** show the overlay inspecting a real routed page without visually polluting the host app.

### Steps

1. Open the routed page in a visually busy area.
2. Reveal the devtools overlay.
3. Move through one or two overlay interactions that inspect the page state.
4. Scroll or navigate enough to show the overlay stays usable on the real page.
5. Make sure both the host page and overlay remain visually readable.
6. End with the overlay visible on top of the routed page.

## 5. Routing + health

**Target file:** `packages/www/public/recordings/marketing/routing-health.json`

**Goal:** prove that the hostname is exposed only after the service is actually healthy.

### Steps

1. Prepare the stack so the service is starting but not yet healthy.
2. Start the browser recording before the route becomes available.
3. Open the routed hostname.
4. Show the pre-health state first.
5. Wait for the health gate to pass.
6. Show the routed app becoming available only after that gate clears.
7. Interact with the now-live page just enough to prove the host is real and usable.
8. Stop the recording immediately after the route is visibly healthy and live.

## Replacement workflow

After each automated take:

1. The recorder writes the rrweb JSON directly into `packages/www/public/recordings/marketing/`.
2. Reload the page and confirm the correct feature tab now plays the new recording.
3. Rerun one scenario or all scenarios until the five feature recordings match the current UI.
