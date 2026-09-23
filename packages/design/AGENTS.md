# devhost design package

Single source of the devhost design tokens (colors, radii, host markers, terminal palettes) shared by the injected devtools UI and the docs site, plus the standalone design references for both.

## Commands

- Check package-local validations (TypeScript, tests including the `tokens.css` freshness check): `bun run check`
- Regenerate `tokens.css` from `src/constants.ts`: `bun run write-tokens`
- Open the devtools UI design reference (from the repo root): `just design`
- Open the docs site design reference (from the repo root): `just design-docs`

## Local conventions

- `src/constants.ts` is the source of truth. `DESIGN_TOKENS` renders into `tokens.css` as `--dh-*` custom properties; `TERMINAL_PALETTES` feeds xterm, which takes literal colors.
- `tokens.css` is generated and committed so CSS `@import` and the `file://` design references can load it without a build step. Never edit it by hand.
- `tokens.css` sets dark values on `:root`, `:host`, and `::backdrop`, and light values wherever `data-theme="light"` is set (document root, wrapper element, or `:host([data-theme="light"])`). Consumers choose the scheme with `data-theme`, never by restating values.
- Consumers: `packages/devhost-ui/src/devtools/shared/devtools.css` imports `tokens.css` and maps its shadcn-style names onto `--dh-*`; `packages/docs` registers `tokens.css` in Starlight `customCss` and derives Expressive Code palettes from `DESIGN_TOKENS`; `references/*.html` link `../tokens.css`.
- `references/devtools.html` and `references/docs.html` are the visual design references for the devtools UI and the docs site. Keep them in sync with the product when the design intentionally changes.
- Product-specific sizing (devtools px type scale, docs rem type scale, layout metrics) stays in each consumer, not here.

## Boundaries

- Always: after changing token values, run `bun run write-tokens` and check both consumers (`bun run --cwd packages/devhost-ui check`, `bun run --cwd packages/docs check`) and both design references.
- Ask first: renaming or removing a `--dh-*` custom property, because the devtools bundle, the docs site, and the references all consume it.
- Never: add color literals to consumers when a token exists here.

## References

- `src/constants.ts`
- `src/createTokensCss.ts`
- `scripts/writeTokensCss.ts`
- `tokens.css`
- `references/devtools.html`
- `references/docs.html`
