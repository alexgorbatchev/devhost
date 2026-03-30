# Devtools UI rules

These rules apply to all UI code under `devhost/src/devtools/`.

## Styling isolation

- All visual styling must be applied directly through JSX `style={...}` props.
- Do not use external stylesheets, CSS modules, `<style>` tags, or global class names.
- Do not rely on inherited app CSS for layout, typography, spacing, colors, borders, or shadows.
- The injected devtools UI must remain visually isolated from the host page.

## Theme tokens

- Shared visual values must come from a basic theme object instead of being duplicated inline across components.
- Reusable tokens must include, at minimum:
  - font sizes: `sm`, `md`, `lg`
  - colors: background, foreground, muted, border, accent, danger when needed
  - spacing values
  - border radii
  - shadows when used
  - z-index values when used
- Repeated hardcoded visual values are not allowed when they belong in the shared theme.
- Component styles must compose from the shared theme first and add only the minimum component-local overrides.

## Implementation intent

- Keep the theme small and explicit.
- Prefer stable semantic names over raw color names.
- Treat the injected UI like a self-contained widget system, not like page-local markup.
