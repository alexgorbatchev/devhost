---
name: demo-update
description: Use when updating devhost promo videos, guide films, narration, footage, or demo recording workflows after UI, CLI, or terminal-output changes.
author: alexgorbatchev
metadata:
  created_on: 2026-10-12 10:23
  last_modified: 2026-10-21 00:16
  status: current
---

Read `docs/internal/references/demo-recording.md` first. It is the reference for prerequisites, commands, file layout, and artifacts; this skill is the procedure and its limits.

The recorder lives in `packages/devhost-ui/scripts/demo/`. There are two kinds of demo:

- **The promo**: one hand-timed HyperFrames project under `promo/`, rendered by `just demo record` from four real scenes (`startup`, `overview`, `annotations`, `query`). It opens the docs landing page; every render writes its docs copy and the landing-page block `packages/docs/src/promoDemo.html`.
- **Twelve guide films**: one template under `guide/`, timed automatically from each guide's narration. Three are browser films (`devtools`, `annotations`, `react-highlight`); nine are terminal films scripted in `createGuideTerminalScene.ts`.

## 1. Decide what is out of date

Re-record only the demos whose footage or narration the change made wrong. List the commits since the last recording and map each visible change to a scene:

| What changed | Re-record |
| --- | --- |
| Toolbar, log minimap, Services panel, worktree picker | `just demo guides devtools` and the promo |
| Native chat, selected page context, native tab sharing | `DEVHOST_DEMO_INTERACTIVE=1 just demo guides annotations` and the promo |
| TanStack Query devtools button or panel | `just demo guides devtools` and the promo |
| React Highlight source-locator API | `just demo guides react-highlight` |
| Output of `devhost start`, `devhost stop`, or a manifest key a terminal guide shows | That terminal guide; read its steps in `createGuideTerminalScene.ts` to see what is on screen |
| Narration wording only | No recording: `just demo audio-guides <guide>` then `just demo guide-film <guide>` |
| Template, captions, title or end card | No recording: `just demo guide-film <guide>` for each film, or `just demo promo` |

A message that appears only on a failure path, or in a log the guide never prints, does not make a terminal film out of date. Check the guide's steps before recording.

To find out whether a feature has a demo at all, read the "Demo coverage" table in `docs/internal/references/demo-recording.md`. A new feature with no row is not filmed; add its row, as **No demo** unless this change films it. Filming it is the user's decision.

## 2. Change the scene, then the narration

- To show a new feature, extend the scene's script (`recordOverview.ts`, `recordAnnotations.ts`, `recordQuery.ts`, `recordReactHighlight.ts`, or the guide's steps in `createGuideTerminalScene.ts`). Assert the state the film is meant to show, so a recording fails when the feature did not appear.
- A browser scene is cut into clips at each `changeCaption` call. A guide needs exactly one narration line per clip in `guide/narration.json`. Change the steps, the lines, and the audio together.
- For a source-only migration, leave published media, pins, and existing audio unchanged. Mark coverage **No demo** and report the pending narration/audio/film refresh. Before recording replacement films, update the affected lines and audio; do not render new footage with retired Pi/Vim narration.
- Run annotation recording only with `DEVHOST_DEMO_INTERACTIVE=1` and an operator at headed Chromium. Wait for the operator to choose the current tab and review native permission requests. Do not fake capture, clear context to avoid sharing, automate approval, or override CLI authentication/settings.
- Keep a line true of what is on screen while it is spoken. Reword the line when the footage no longer shows what it says.

## 3. Regenerate audio, record, render

1. `just demo audio-guides <guide>` speaks only the lines whose request changed. Rewording one line also speaks the lines beside it, because they are sent as context.
2. `just demo guides <guide>` records the guide, renders its film, and writes the docs media.
3. `DEVHOST_DEMO_INTERACTIVE=1 just demo record` records the four scenes and renders the promo. It runs a real Codex request through native chat using the configured account and model default.
4. For the promo's own narration: `just demo audio` speaks every line again, so every take gets a new length. Re-time `promo/index.html` and the frames under `promo/compositions/frames/` to the new takes before rendering.

On hosts that restrict unprivileged user namespaces, prefix recording commands with `VHS_NO_SANDBOX=1`.

## 4. Verify the film

A finished render is not a verified film.

- Extract frames across the film and look at them: the new feature is visible, cues land on the words they belong to, nothing is cut off.
- Read the generated captions (`packages/docs/public/demos/<guide>.vtt`) against the footage.
- Check the length. A guide film is capped at 45 seconds; a film at the cap plays its footage faster, so confirm it is still readable.
- For the promo, read `agent-changes.json` in the run directory: the native agent's actual edit is shown on screen.
- Run `just demo test`, and `just check` after changing scripts.

## 5. Review, publish, commit

1. The user reviews the films on the playground's `/videos` page. Wait for their approval.
2. After approval: `just docs publish-media`, then commit `packages/docs/demo-media.json` together with the guide's page, poster, and captions. For the promo, the files beside the pin are `packages/docs/src/promoDemo.html`, `promo.webp`, and `promo.vtt`.
3. `just docs check` passes again once the videos on disk are the pinned ones.
4. Update the rows of the "Demo coverage" table that point at a re-recorded film, in the same commit.
5. The films reach the docs site with the next CLI release, which deploys the docs from its tag. Merging to `main` does not deploy them.

Until step 2, leave the docs media uncommitted. The committed pins, pages, posters, and captions must always describe the published videos, so every commit builds.

## Do not

- Do not publish or pin a video the user has not approved. `just docs publish-media` uploads to a public release.
- Do not commit an MP4. The guide videos and the promo's docs copy are release assets; master renders stay under `.tmp/demos/`.
- Do not commit a guide's page, poster, or captions before its video is published.
- Do not re-create the interface in a composition. Films show real recordings; a composition declares the footage it needs with `data-footage`.
- Do not re-record every demo for a change that touches one scene. Each recording takes minutes and the promo uses the configured Codex account's normal billing.
- Do not run `just demo audio` or `just demo audio-guides <guide> retake` without need. They bill the ElevenLabs account, and new takes have new lengths.
- Do not change the voice, add music, or raise the 45-second cap without the user's decision. The films have one voice and no music.
- Do not reset checkout files to undo a recording's edits. The annotations scene works on a per-run copy and restores it during cleanup.
- Do not rebase or check out across commits that tracked the guide videos without checking `packages/docs/public/demos/*.mp4` afterwards. Git removes the ignored local films, and the next docs command downloads the pinned ones in their place. Rebuild from the master renders under `.tmp/demos/recording-*/`, or record again.
- Do not leave a recording's processes running. The recorder stops what it started; the shared Caddy stays up.
