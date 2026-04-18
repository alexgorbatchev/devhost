# marketing replays

Capture route fixtures, replay metadata, and stories for regenerating deterministic marketing replay JSONs.

## Commands

- Re-record one replay: `bun run record:marketing <scenario-id>`
- Re-record all replays: `bun run record:marketing`
- Check this workspace: `bun run check`
- Open Storybook for the local placeholders: `bun run storybook`

## Local conventions

- `capture/MarketingCapturePage.tsx` owns the visible capture targets and the `data-testid` hooks that the recorder follows. Keep those IDs stable unless the recorder and affected fixtures are updated in the same change.
- `capture/createCaptureControlPlane.ts` is the source of truth for mocked websocket, health, annotation queue, and terminal-session behavior during capture runs. Update those fixtures instead of patching generated rrweb JSON.
- `replays/marketingReplayScenarios.ts` is shared metadata for both the public marketing replay tabs and the capture flow. Keep scenario ids, labels, and recording filenames aligned with both surfaces.
- The generated replay files under `packages/www/public/recordings/marketing/` are outputs, not editable source files.
- Story files in `capture/stories/` are placeholder coverage for this dev-only surface. Validate replay behavior through the capture route and recorder, not by expanding Storybook-only placeholders.

## Local gotchas

- Annotation replay timing is part of the product story. For the handoff demo, move to the first target before pressing `Alt`, wiggle slightly to reveal the highlight, pause for about one second, click the first target, move to the second target with `Alt` still held, pause again, click, then release `Alt` before typing.
- Recorder changes are only trustworthy after re-recording the affected scenario and visually checking the replay in the app. Passing tests alone will not catch awkward choreography.

## Boundaries

- Always: rerun `bun run record:marketing <scenario-id>` after changing replay scenarios, capture-page targets, capture control-plane fixtures, or recorder choreography.
- Always: visually inspect the affected replay after regeneration when the change affects cursor timing, keyboard modifiers, or perceived highlight state.
- Never: hand-edit files under `packages/www/public/recordings/marketing/`.

## References

- `../../demo-script.md`
- `../../scripts/recordMarketingDemos.ts`
- `./capture/MarketingCapturePage.tsx`
- `./capture/createCaptureControlPlane.ts`
- `./replays/marketingReplayScenarios.ts`
