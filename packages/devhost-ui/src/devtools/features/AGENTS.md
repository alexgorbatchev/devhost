# Devtools Features

Local rules for organizing feature-owned code inside `packages/devhost-ui/src/devtools/features/`.

## Local purpose

This directory contains isolated, feature-specific modules for the injected devtools UI. Each feature folder owns its UI components, hooks, local state logic, Storybook stories, and unit tests.

## Conventions

- **Folder structure:** Every feature must live inside its own directory (e.g., `features/annotationComposer/`, `features/minimap/`).
- **Encapsulation:** Feature folders should not cross-import from other feature folders unless explicitly creating an integration boundary.
- **Components:** Place feature-owned React components in `components/` and keep their matching Storybook files in `components/stories/` (e.g., `features/minimap/components/LogMinimap.tsx` and `features/minimap/components/stories/LogMinimap.stories.tsx`).
- **Hooks:** Place exported hooks in direct-child `hooks/use*.ts[x]` files and keep their matching tests in `hooks/__tests__/` (e.g., `features/minimap/hooks/useServiceLogs.ts` and `features/minimap/hooks/__tests__/useServiceLogs.test.ts`).
- **Pure tests:** Keep tests for pure helpers, reducers, parsers, and adapters in a feature-level `__tests__/` directory beside the source helpers they exercise.
- **Host DOM integrations:** If a feature must inspect or coordinate with third-party UI already mounted on the host page, isolate that logic behind feature-local adapters or pure state helpers instead of scattering selectors and host DOM assumptions through UI components.

## Boundaries

- **Always:** Use `src/devtools/shared/` for cross-feature code. If two features need the same component (like `Button` or `HoverSlidePanel`), hook, or utility, move it to `shared/`.
- **Always:** Follow the repository TypeScript AI policy layout: component `.tsx` files under `components/`, exported hooks under `hooks/`, stories under sibling `components/stories/`, and hook tests under sibling `hooks/__tests__/`.
- **Always:** Use semantic Tailwind tokens and logic-local layout constants first. Runtime JavaScript theme access must stay in narrow adapters for values CSS cannot consume directly, such as xterm colors, canvas colors, or matched font settings.
- **Always:** Prefer selector-based suppression for third-party launcher chrome over removing or mutating specific host nodes. Host-owned panels and controls must remain owned by the host library.
- **Always:** When a feature intentionally reaches outside the Shadow DOM boundary, keep that escape hatch narrowly scoped, document the behavior in `packages/docs/src/content/docs/`, and cover the adapter/state logic with feature-local tests.
- **Never:** Place generic hooks, shared layout wrappers, or transport utilities (websockets, tokens) inside a feature folder.
- **Never:** Reparent, restyle wholesale, or otherwise take ownership of third-party host panels from a feature module. Feature-owned integrations should proxy or observe them, not absorb them.

## Done policy

- **Done:** Feature work is complete only when the root/workspace done policy is satisfied and any required feature-local stories, tests, and design notes are updated with the change.
- **Done:** If shared-code extraction, docs, stories, or tests are still pending or blocked, report the work as incomplete instead of done.

## Internal references

- `../shared/` — Global styling theme, primitive UI components, and websocket clients.
- `../AGENTS.md` — Shadow DOM CSS encapsulation rules and token usage.
- `../../../docs/external-devtools.md` — Internal design notes for selector-based third-party devtools launcher aggregation.
