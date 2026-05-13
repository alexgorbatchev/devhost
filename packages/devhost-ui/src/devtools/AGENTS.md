# `packages/devhost-ui/src/devtools/`

This `AGENTS.md` file must be kept up to date.

## Styling isolation

Its vital that when devtools are injected into the user's web application, CSS that devtools uses/defines must never ever conflict or affect the host application.

- The injected devtools UI must mount inside its own Shadow DOM root.
- Devtools component styling must use the Tailwind v4 entry stylesheet at `shared/devtools.css`; runtime and Storybook must install that compiled CSS through `shared/devtoolsStyles.ts` into the active Shadow DOM root.
- shadcn/ui primitives live under `packages/devhost-ui/src/components/ui/` and may be composed by devtools features. Put app-specific behavior or stable test IDs in devtools-owned wrappers under `shared/` instead of forking generated primitives.
- Tailwind Preflight is allowed only inside the devtools Shadow DOM root. Do not load the devtools stylesheet into host-page globals.
- Do not add CSS modules, document-global CSS, or host-page global CSS for devtools UI styling.
- Exception: `@xterm/xterm` may load its required stylesheet and class names for the interactive terminal feature, but that stylesheet must be mounted inside the devtools Shadow DOM root rather than `document.head`.
- Do not rely on inherited app CSS for layout, typography, spacing, colors, borders, or shadows.
- Direct JSX `style={...}` props are allowed only for dynamic geometry that cannot be represented statically, such as measured top/left/width/height values or xterm tray dimensions. Static visual values belong in Tailwind classes or semantic CSS variables.
- Any intentional document-level styling escape hatch must be narrowly justified at the use site because it breaks isolation guarantees.
- The injected devtools UI must remain visually isolated from the host page.

## Theme tokens

- Shared visual values must come from shadcn-compatible CSS variables in `shared/devtools.css`. Runtime JavaScript theme access must stay in narrow adapters for values CSS cannot consume directly, such as xterm colors, canvas colors, or matched font settings. Shared interaction geometry and layout constants that are not actual theme values belong near the logic that uses them instead of a theme context.
- Presentational devtools components must read theme values via semantic Tailwind tokens and shadcn primitives first, not a `theme` prop.
- Shared visual values must come from semantic tokens instead of being duplicated inline across components.
- When the devtools theme intentionally follows Tokyo Night, use `folke/tokyonight.nvim` as the palette reference instead of eyeballing approximations.
- Prefer the canonical palette files and shipped Pi extras when mapping tokens:
  - `lua/tokyonight/colors/storm.lua`
  - `lua/tokyonight/colors/day.lua`
  - `extras/pi/tokyonight_storm.json`
  - `extras/pi/tokyonight_day.json`
- Reusable tokens must include, at minimum:
  - font sizes: `sm`, `md`, `lg`
  - colors: background, foreground, muted, border, accent, danger when needed
  - spacing values
  - border radii
  - shadows when used
  - z-index values when they are actual reusable visual tokens
- Repeated hardcoded visual values are not allowed when they belong in the shared theme.
- Component styles must compose from the shared theme first and add only the minimum component-local overrides.

## Feature organization

- Organize devtools code by feature first.
- Put feature-owned components, hooks, and helpers under `features/<featureName>/`.
- Keep cross-feature theme, config, websocket helpers, and shared types under `shared/`.
- Do not leave feature-specific logic in the `src/devtools/` root when it belongs to a concrete feature folder.
- See `features/AGENTS.md` for specific rules on feature encapsulation, stories, and tests.

## Annotation metadata

- Annotation capture may collect optional React development source metadata from host-page elements when the host app exposes it via React fiber debug/source fields.
- When the raw React metadata points at generated JavaScript and the host serves fetchable source maps, devhost should attempt source-map symbolication before storing the annotation source location.
- Treat source metadata capture as best-effort host introspection, not a guaranteed contract across all frameworks, bundlers, or production builds.
- Do not leave annotation-selection console logging enabled once source-location debugging is complete because it exposes host source paths and pollutes the host-app console.

## React Highlight matching

- React Highlight browser matching must prefer React fiber source metadata and then fall back to fetchable script source maps when host fibers do not expose source locations.
- Keep the browser diagnostic event `devhost:react-highlight` in sync with matching behavior; it should remain useful for distinguishing transport success from DOM match failure.
- Treat source-map matching as best-effort for lowercase host JSX tags. Do not claim reliable component-callsite highlighting for uppercase component tags unless runtime instrumentation or fiber metadata proves the rendered DOM subtree.
- When changing React Highlight matching, update `packages/docs/src/content/docs/guides/react-highlight.md` and feature-local tests under `features/reactHighlight/__tests__/`.

## Implementation intent

- Keep the theme small and explicit.
- Prefer stable semantic names over raw color names.
- Treat the injected UI like a self-contained widget system, not like page-local markup.

## Testing guidance

- Do not write unit tests or Storybook `play` assertions that only snapshot exact HSL values, Tailwind class strings, xterm theme palettes, or raw stylesheet text when those values are static implementation details.
- Prefer tests that prove observable behavior, accessibility state, integration wiring, or layout/geometry behavior that users can actually notice.

## Done policy

- Done: devtools work is complete only when the root/workspace done policy is satisfied and any required devtools docs, stories, tests, or design notes stay in sync.
- Done: if styling-isolation changes, source-location behavior, or feature rules still need follow-up docs/tests, report the work as incomplete instead of done.
