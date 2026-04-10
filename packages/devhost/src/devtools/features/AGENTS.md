# Devtools Features

Local rules for organizing feature-owned code inside `packages/devhost/src/devtools/features/`.

## Local purpose

This directory contains isolated, feature-specific modules for the injected devtools UI. Each feature folder owns its UI components, hooks, local state logic, Storybook stories, and unit tests.

## Conventions

- **Folder structure:** Every feature must live inside its own directory (e.g., `features/annotationComposer/`, `features/minimap/`).
- **Encapsulation:** Feature folders should not cross-import from other feature folders unless explicitly creating an integration boundary.
- **Stories:** Place Storybook files in a `stories/` subdirectory within the feature folder (e.g., `features/minimap/stories/Minimap.stories.tsx`).
- **Tests:** Place unit and component tests in a `__tests__/` subdirectory within the feature folder (e.g., `features/minimap/__tests__/useServiceLogs.test.ts`).

## Boundaries

- **Always:** Use `src/devtools/shared/` for cross-feature code. If two features need the same component (like `Button` or `HoverSlidePanel`), hook, or utility, move it to `shared/`.
- **Always:** Retrieve shared visual styling and dimensions from the global `IDevtoolsTheme` context.
- **Never:** Place generic hooks, shared layout wrappers, or transport utilities (websockets, tokens) inside a feature folder.

## Internal references

- `../shared/` — Global styling theme, primitive UI components, and websocket clients.
- `../AGENTS.md` — Shadow DOM CSS encapsulation rules and token usage.
