# Storybook Review

Git SHA: a28f2eacb7774d0c96acc3a80782e50f2a20e8e6
Overall: FAIL
Files reviewed: packages/devhost/src/devtools/features/externalDevtoolsPanel/stories/ExternalDevtoolsPanel.stories.tsx, packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionTray.stories.tsx, packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionPanel.stories.tsx, packages/devhost/src/devtools/stories/App.stories.tsx, packages/devhost/src/devtools/shared/stories/ThemeProvider.stories.tsx, packages/devhost/src/devtools/shared/stories/HoverSlidePanel.stories.tsx, packages/devhost/src/devtools/shared/stories/Button.stories.tsx, packages/devhost/src/devtools/features/serviceStatusPanel/stories/ServiceStatusPanel.stories.tsx, packages/devhost/src/devtools/features/minimap/stories/LogMinimap.stories.tsx, packages/devhost/src/devtools/features/componentSourceNavigation/stories/ComponentSourceMenu.stories.tsx, packages/devhost/src/devtools/features/annotationQueue/stories/AnnotationQueuePanel.stories.tsx, packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationMarkerList.stories.tsx, packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationComposer.stories.tsx, packages/www/src/app/stories/App.stories.tsx, packages/www/src/components/icons/stories/SunIcon.stories.tsx, packages/www/src/components/icons/stories/ShieldIcon.stories.tsx, packages/www/src/components/ui/stories/Callout.stories.tsx, packages/www/src/components/ui/stories/CommandLine.stories.tsx, packages/www/src/components/ui/stories/InlineCallout.stories.tsx, packages/www/src/components/ui/stories/TerminalSnippet.stories.tsx, packages/www/src/components/ui/stories/Surface.stories.tsx, packages/www/src/components/ui/stories/SectionHeader.stories.tsx, packages/www/src/components/ui/stories/InsetList.stories.tsx, packages/www/src/components/ui/stories/Button.stories.tsx, packages/www/src/components/icons/stories/GitHubIcon.stories.tsx, packages/www/src/components/icons/stories/ActivityIcon.stories.tsx, packages/www/src/components/icons/stories/DevtoolsIcon.stories.tsx, packages/www/src/components/icons/stories/LayersIcon.stories.tsx, packages/www/src/components/icons/stories/MoonIcon.stories.tsx, packages/www/src/features/rrweb/stories/FeatureReplayPanel.stories.tsx, packages/www/src/features/rrweb/stories/RrwebDemoPanel.stories.tsx
Reference rubric: `.agents/skills/storybook/SKILL.md`
Summary: All reviewed Storybook issues outside the annotation-queue area have been addressed and validated. Remaining FAIL status is limited to annotation-queue coverage, and full `packages/devhost` validation is currently blocked by concurrent work in `packages/devhost/src/devtools/features/annotationQueue/AnnotationQueuePanel.tsx`.

## Action checklist

- [x] `packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationComposer.stories.tsx`: Add a story that covers the visible submit-error state.
- [x] `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionPanel.stories.tsx`: Add an editor-session story that exercises the `session.kind === "editor"` branch.
- [x] `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionTray.stories.tsx`: Add a story with one expanded session and at least one minimized session.
- [ ] `packages/devhost/src/devtools/features/annotationQueue/stories/AnnotationQueuePanel.stories.tsx`: Add stories for `launching`, queue-resume pending, and entry-mutation pending or disabled states. Blocked while annotation-queue files are being updated concurrently.
- [x] `packages/devhost/src/devtools/features/minimap/stories/LogMinimap.stories.tsx`: Add an empty-entries story for the null-render branch.
- [x] `packages/devhost/src/devtools/shared/stories/HoverSlidePanel.stories.tsx`: Add a story that covers the `isPinned` configuration.
- [x] `packages/www/src/features/rrweb/stories/FeatureReplayPanel.stories.tsx`: Add stories for loaded replay and fullscreen replay states.
- [x] `packages/www/src/features/rrweb/stories/RrwebDemoPanel.stories.tsx`: Add stories for recording-in-progress, preview or export, and non-development mode.
- [x] `packages/www/src/components/ui/stories/Button.stories.tsx`, `packages/www/src/components/ui/stories/Surface.stories.tsx`, `packages/www/src/components/ui/stories/SectionHeader.stories.tsx`: Add separate stories for the missing prop-driven states.
- [x] `packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationComposer.stories.tsx`: Replace fixed timeout waits with `waitFor` on observable selection, submit, and reset states.
- [x] `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionPanel.stories.tsx`: Exercise expand, minimize or remove, tooltip, and completion behavior in `play` tests instead of only asserting mount.
- [x] `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionTray.stories.tsx`: Click through tray controls and assert `onExpandSession`, `onMinimizeSession`, and `onRemoveSession` effects.
- [x] `packages/devhost/src/devtools/features/serviceStatusPanel/stories/ServiceStatusPanel.stories.tsx`: Exercise the restart button and assert the observable restart request behavior.
- [x] `packages/devhost/src/devtools/features/minimap/stories/LogMinimap.stories.tsx`: Assert hovered overlay and preview behavior in the hovered stories.
- [x] `packages/www/src/features/rrweb/stories/RrwebDemoPanel.stories.tsx` and `packages/www/src/app/stories/App.stories.tsx`: Assert the result of starting recording and toggling theme instead of only clicking the controls.
- [x] `packages/www/src/components/icons/stories/ActivityIcon.stories.tsx`, `packages/www/src/components/icons/stories/DevtoolsIcon.stories.tsx`, `packages/www/src/components/icons/stories/GitHubIcon.stories.tsx`, `packages/www/src/components/icons/stories/LayersIcon.stories.tsx`, `packages/www/src/components/icons/stories/MoonIcon.stories.tsx`, `packages/www/src/components/icons/stories/ShieldIcon.stories.tsx`, `packages/www/src/components/icons/stories/SunIcon.stories.tsx`, and `packages/www/src/components/ui/stories/InlineCallout.stories.tsx`: Replace empty or smoke-only `play` functions with direct render assertions for the state each story demonstrates.
- [x] `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionPanel.stories.tsx` and `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionTray.stories.tsx`: Extract the shared Shadow DOM story harness and `readShadowRoot` helper into a common reusable helper.
- [x] `packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationComposer.stories.tsx`: Remove the `dispatchEvent`-driven selection sequence and the `elementsFromPoint`, `getBoundingClientRect`, and `getSelection` overrides; drive the story through real browser interactions.

## Coverage

Status: FAIL
Evidence: Coverage gaps remain only in `packages/devhost/src/devtools/features/annotationQueue/stories/AnnotationQueuePanel.stories.tsx`, which still needs the `launching`, queue-resume pending, and entry-mutation pending or disabled states from `packages/devhost/src/devtools/features/annotationQueue/AnnotationQueuePanel.tsx:66-110,161-179,196-205`. The rest of the previously flagged coverage gaps were addressed in the updated story files and validated with targeted Storybook browser tests in `packages/devhost/` plus a full `bun run check` in `packages/www/`. Full `packages/devhost` validation is currently blocked by concurrent work in `packages/devhost/src/devtools/features/annotationQueue/AnnotationQueuePanel.tsx:406`.
Recommendations: Finish the annotation-queue story coverage work once the concurrent annotation-queue changes settle, then rerun `bun run check` in `packages/devhost/`.

## Play Tests

Status: PASS
Evidence: `packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationComposer.stories.tsx`, `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionPanel.stories.tsx`, `packages/devhost/src/devtools/features/terminalSessions/stories/TerminalSessionTray.stories.tsx`, `packages/devhost/src/devtools/features/serviceStatusPanel/stories/ServiceStatusPanel.stories.tsx`, `packages/devhost/src/devtools/features/minimap/stories/LogMinimap.stories.tsx`, and `packages/devhost/src/devtools/shared/stories/HoverSlidePanel.stories.tsx` passed targeted Storybook browser validation via `bun x vitest --config vitest.storybook.config.ts run ...`. `packages/www` `bun run check` passed, covering the updated `FeatureReplayPanel`, `RrwebDemoPanel`, `App`, `Button`, `Surface`, `SectionHeader`, icon, and `InlineCallout` stories.
Recommendations: None.

## Reuse

Status: PASS
Evidence: `packages/devhost/src/devtools/shared/stories/DevtoolsStoryShadowRoot.tsx` now provides the shared shadow-root harness and `readShadowRoot` helper used by both terminal session story files.
Recommendations: None.

## Browser Environment

Status: PASS
Evidence: `packages/devhost/src/devtools/features/annotationComposer/stories/AnnotationComposer.stories.tsx` now uses `userEvent` and `waitFor` against real browser behavior without overriding geometry or selection APIs and without `dispatchEvent`-driven interaction shims.
Recommendations: None.
