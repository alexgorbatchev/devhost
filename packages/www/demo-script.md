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

## 1. Annotation handoff

**Target file:** `packages/www/public/recordings/marketing/annotation.json`

**Goal:** prove that page evidence can be tagged and handed into Pi without rewriting the bug report elsewhere.

### Steps

1. Open the routed page in its steady state.
2. Hold `Alt` so the annotation affordances become visible.
3. Hover two meaningful page elements to show that multiple targets can be selected intentionally.
4. Select the first element.
5. Select the second element.
6. Open the annotation draft UI.
7. Type a short, concrete note that references the selected elements.
8. Show that the draft includes page context and selected targets.
9. Submit the handoff into Pi.
10. Leave the final state visible for a beat so the completed handoff is obvious.

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
