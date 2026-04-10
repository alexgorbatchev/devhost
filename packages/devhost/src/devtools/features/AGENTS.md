# Devtools Features

Local rules for organizing feature-owned code inside `packages/devhost/src/devtools/features/`.

## Local purpose

This directory contains isolated, feature-specific modules for the injected devtools UI. Each feature folder owns its UI components, hooks, local state logic, Storybook stories, and unit tests.

## Conventions

- **Folder structure:** Every feature must live inside its own directory (e.g., `features/annotationComposer/`, `features/minimap/`).
- **Encapsulation:** Feature folders should not cross-import from other feature folders unless explicitly creating an integration boundary.
- **Stories:** Place Storybook files in a `stories/` subdirectory within the feature folder (e.g., `features/minimap/stories/Minimap.stories.tsx`).
- **Tests:** Place unit and component tests in a `__tests__/` subdirectory within the feature folder (e.g., `features/minimap/__tests__/useServiceLogs.test.ts`).
- **Host DOM integrations:** If a feature must inspect or coordinate with third-party UI already mounted on the host page, isolate that logic behind feature-local adapters or pure state helpers instead of scattering selectors and host DOM assumptions through UI components.

## Boundaries

- **Always:** Use `src/devtools/shared/` for cross-feature code. If two features need the same component (like `Button` or `HoverSlidePanel`), hook, or utility, move it to `shared/`.
- **Always:** Retrieve shared visual styling and dimensions from the global `IDevtoolsTheme` context.
- **Always:** Prefer selector-based suppression for third-party launcher chrome over removing or mutating specific host nodes. Host-owned panels and controls must remain owned by the host library.
- **Always:** When a feature intentionally reaches outside the Shadow DOM boundary, keep that escape hatch narrowly scoped, document the behavior in `packages/devhost/docs/`, and cover the adapter/state logic with feature-local tests.
- **Never:** Place generic hooks, shared layout wrappers, or transport utilities (websockets, tokens) inside a feature folder.
- **Never:** Reparent, restyle wholesale, or otherwise take ownership of third-party host panels from a feature module. Feature-owned integrations should proxy or observe them, not absorb them.

## Internal references

- `../shared/` — Global styling theme, primitive UI components, and websocket clients.
- `../AGENTS.md` — Shadow DOM CSS encapsulation rules and token usage.
- `../../../docs/external-devtools.md` — Internal design notes for selector-based third-party devtools launcher aggregation.
