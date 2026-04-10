# `devhost/src/devtools/`

This `AGENTS.md` file must be kept up to date.

## Styling isolation

Its vital that when devtools are injected into the user's web application, CSS that devtools uses/defines must never ever conflict or affect the host application.

- The injected devtools UI must mount inside its own Shadow DOM root.
- Devtools component styling must use Emotion-generated classes injected into that Shadow DOM root, not direct JSX `style={...}` props for regular component styling.
- Do not add external stylesheets, CSS modules, or host-page global CSS for devtools UI styling.
- Exception: `@xterm/xterm` may load its required stylesheet and class names for the interactive terminal feature, but that stylesheet must be mounted inside the devtools Shadow DOM root rather than `document.head`.
- Do not rely on inherited app CSS for layout, typography, spacing, colors, borders, or shadows.
- Any intentional document-level styling escape hatch must be narrowly justified at the use site because it breaks isolation guarantees.
- The injected devtools UI must remain visually isolated from the host page.

## Theme tokens

- Shared visual values must come from the devtools theme context instead of being threaded through component props.
- Presentational devtools components must read theme values via the shared theme hook/provider, not a `theme` prop.
- Shared visual values must come from a basic theme object instead of being duplicated inline across components.
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
  - z-index values when used
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

## Implementation intent

- Keep the theme small and explicit.
- Prefer stable semantic names over raw color names.
- Treat the injected UI like a self-contained widget system, not like page-local markup.
