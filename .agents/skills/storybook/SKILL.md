---
name: storybook
description: Use whenever any Storybook stories file in this repository is touched in any way, including opening, creating, reviewing, editing, or rewriting `*.stories.*` files.
---

# Storybook

Use `packages/devhost/src/devtools/features/externalDevtoolsPanel/stories/ExternalDevtoolsPanel.stories.tsx` as the reference model for shared setup helpers and behavior-focused `play` tests.

## Coverage

Represent every meaningful component option, setting, configuration, and state with a story.

Let a user scroll through the story list and see the component in each supported state.

Prefer one story per externally meaningful state instead of hiding multiple states inside a single story.

Add a `play` test to every stateful story.

If a component is purely presentational, keep the `play` test simple and assert the rendered output directly.

## Play Tests

Assert the behavior that the current story is meant to demonstrate.

Do not stop at `toBeVisible()` unless visibility is the whole point of the component.

Exercise the component through realistic interactions when it has behavior: click buttons, type, focus, toggle controls, open panels, dismiss overlays, or otherwise drive the state change the story exists to show.

Assert the observable result of that interaction: changed text, pressed state, callback effects, opened or closed UI, disabled state, layout constraints, or other user-visible behavior.

Use `waitFor` around async transitions and browser-rendered state changes.

Never use hard-coded timeouts such as fixed `setTimeout`, `sleep`, or arbitrary delay-based waiting in stories or `play` tests.

Wait on observable browser behavior instead: rendered elements, changed attributes, callback effects, text updates, opened panels, closed overlays, or other user-visible state.

## Reuse

Extract repeated setup into helper functions when the story requires non-trivial rendering, provider wiring, shared DOM queries, or repeated interaction flows.

Extract repeated interaction sequences into named helpers when multiple stories exercise the same behavior with different inputs or positions.

Keep helpers focused on setup and reusable behavior. Keep the story-specific assertions inside the story `play` test unless they are truly identical across stories.

## Browser Environment

Treat Storybook `play` tests as real browser tests running through Playwright and Vitest browser mode, not JSDOM.

Use standard `storybook/test` utilities such as `within`, `userEvent`, `expect`, and `waitFor`.

Do not use JSDOM-only hacks, manual DOM event mocking, `dispatchEvent`-driven simulations, or geometry stubs like overriding `getBoundingClientRect` or `elementsFromPoint`.

If browser layout or positioning matters, assert against the real DOM and computed browser state.

## Checklist

Before finishing a story file, verify all of the following:

1. Every meaningful component state has a story.
2. Each story demonstrates one clear state or configuration.
3. Each non-trivial story has a `play` test.
4. Each `play` test exercises the behavior that story is showing.
5. Shared setup and repeated flows are extracted into helpers when the file would otherwise repeat itself.
6. Assertions prove functionality, not just presence, for interactive components.
7. No hard-coded timeouts or arbitrary delays are used.
