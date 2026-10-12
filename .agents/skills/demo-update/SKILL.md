---
name: demo-update
description: Use when a devhost demo video has to change in this repository: the promo, a guide film on the docs site, their narration, or their footage after a UI, CLI, or terminal-output change. Covers which demos to re-record, the order of the steps, how to verify a film, and when it may be published.
---

# Demo Update

Read `docs/internal/references/demo-recording.md` first. It is the reference for prerequisites, commands, file layout, and artifacts; this skill is the procedure and its limits.

The recorder lives in `packages/devhost-ui/scripts/demo/`. There are two kinds of demo:

- **The promo**: one hand-timed HyperFrames project under `promo/`, rendered by `just demo record` from four real scenes (`startup`, `overview`, `annotations`, `query`).
- **Twelve guide films**: one template under `guide/`, timed automatically from each guide's narration. Three are browser films (`devtools`, `annotations`, `react-highlight`); nine are terminal films scripted in `createGuideTerminalScene.ts`.

## 1. Decide what is out of date

Re-record only the demos whose footage or narration the change made wrong. List the commits since the last recording and map each visible change to a scene:

| What changed | Re-record |
| --- | --- |
| Toolbar, log minimap, Services panel, worktree picker | `just demo guides devtools` and the promo |
| Annotation flow, Pi terminal session | `just demo guides annotations` and the promo |
| TanStack Query devtools button or panel | `just demo guides devtools` and the promo |
| React Highlight, the Neovim plugin | `just demo guides react-highlight` |
| Output of `devhost start`, `devhost stop`, or a manifest key a terminal guide shows | That terminal guide; read its steps in `createGuideTerminalScene.ts` to see what is on screen |
| Narration wording only | No recording: `just demo audio-guides <guide>` then `just demo guide-film <guide>` |
| Template, captions, title or end card | No recording: `just demo guide-film <guide>` for each film, or `just demo promo` |

A message that appears only on a failure path, or in a log the guide never prints, does not make a terminal film out of date. Check the guide's steps before recording.

## 2. Change the scene, then the narration

- To show a new feature, extend the scene's script (`recordOverview.ts`, `recordAnnotations.ts`, `recordQuery.ts`, `recordReactHighlight.ts`, or the guide's steps in `createGuideTerminalScene.ts`). Assert the state the film is meant to show, so a recording fails when the feature did not appear.
- A browser scene is cut into clips at each `changeCaption` call. A guide needs exactly one narration line per clip in `guide/narration.json`. Change the steps, the lines, and the audio together.
- Keep a line true of what is on screen while it is spoken. Reword the line when the footage no longer shows what it says.

## 3. Regenerate audio, record, render

1. `just demo audio-guides <guide>` speaks only the lines whose request changed. Rewording one line also speaks the lines beside it, because they are sent as context.
2. `just demo guides <guide>` records the guide, renders its film, and writes the docs media.
3. `just demo record` records the four scenes and renders the promo. It runs a real Pi request.
4. For the promo's own narration: `just demo audio` speaks every line again, so every take gets a new length. Re-time `promo/index.html` and the frames under `promo/compositions/frames/` to the new takes before rendering.

On hosts that restrict unprivileged user namespaces, prefix recording commands with `VHS_NO_SANDBOX=1`.

## 4. Verify the film

A finished render is not a verified film.

- Extract frames across the film and look at them: the new feature is visible, cues land on the words they belong to, nothing is cut off.
- Read the generated captions (`packages/docs/public/demos/<guide>.vtt`) against the footage.
- Check the length. A guide film is capped at 45 seconds; a film at the cap plays its footage faster, so confirm it is still readable.
- For the promo, read `pi-changes.json` in the run directory: the agent's edit differs between runs and is shown on screen.
- Run `just demo test`, and `just check` after changing scripts.

## 5. Review, publish, commit

1. The user reviews the films on the playground's `/videos` page. Wait for their approval.
2. After approval: `just docs publish-media`, then commit `packages/docs/demo-media.json` together with the guide's page, poster, and captions.
3. `just docs check` passes again once the videos on disk are the pinned ones.

Until step 2, leave the docs media uncommitted. The committed pins, pages, posters, and captions must always describe the published videos, so every commit builds.

## Do not

- Do not publish or pin a video the user has not approved. `just docs publish-media` uploads to a public release.
- Do not commit an MP4. Guide videos are release assets; the promo stays under `.tmp/demos/`.
- Do not commit a guide's page, poster, or captions before its video is published.
- Do not re-create the interface in a composition. Films show real recordings; a composition declares the footage it needs with `data-footage`.
- Do not re-record every demo for a change that touches one scene. Each recording takes minutes and the promo bills a Pi request.
- Do not run `just demo audio` or `just demo audio-guides <guide> retake` without need. They bill the ElevenLabs account, and new takes have new lengths.
- Do not change the voice, add music, or raise the 45-second cap without the user's decision. The films have one voice and no music.
- Do not reset checkout files to undo a recording's edits. The annotations scene works on a per-run copy and restores it during cleanup.
- Do not rebase or check out across commits that tracked the guide videos without checking `packages/docs/public/demos/*.mp4` afterwards. Git removes the ignored local films, and the next docs command downloads the pinned ones in their place. Rebuild from the master renders under `.tmp/demos/recording-*/`, or record again.
- Do not leave a recording's processes running. The recorder stops what it started; the shared Caddy stays up.
