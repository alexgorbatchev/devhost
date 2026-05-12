# devhost React Highlight Neovim plugin

Bundled Neovim plugin loaded by `devhost` to send TSX/JSX cursor locators to the active devhost control server.

## Commands

- Smoke-load the plugin: `nvim --headless -u NONE --cmd "set rtp^=apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim" -c "lua require('devhost-react-highlight')" -c "qa"`
- Run the standalone Neovim integration tests: `bun run apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim/tests/run.ts`
- Check the Go devtools package after changing bundled plugin behavior: `cd apps/devhost && go test ./internal/devtools`
- Check the devhost app after launcher, embed, or control-server changes: `bun run check:devhost`

## Local conventions

- Keep plugin code in plain Lua with no external Neovim plugin dependencies.
- The plugin is idle unless `DEVHOST_REACT_HIGHLIGHT_URL` and `DEVHOST_CONTROL_TOKEN` are set or equivalent setup options are passed.
- Cursor payloads must stay instance-scoped through the injected endpoint, token, project root, and stack name; do not introduce global files or shared ports.
- The `->` sign means Neovim resolved a JSX locator and devhost accepted the POST. It must not imply that the browser matched a DOM node.
- Locator emission is intentionally de-duplicated by locator so moving within the same JSX element does not spam the browser.

## Boundaries

- Always: update `README.md`, `packages/docs/src/content/docs/guides/react-highlight.md`, and parent Go tests when changing plugin setup, environment variables, locator semantics, or the indicator.
- Always: keep generated launcher assumptions in sync with `apps/devhost/internal/devtools/terminal.go`.
- Never: require users to edit their normal Neovim config for devhost-managed launches.
- Never: write plugin runtime state outside the current devhost project `.tmp/devhost/<stack-name>/` integration path.
- Never: wire `tests/run.ts` into the main repo, devhost, or CI check path without an explicit request; these tests are intentionally independent because they require a local Neovim with TSX Tree-sitter support.

## References

- `README.md`
- `lua/devhost-react-highlight/init.lua`
- `plugin/devhost-react-highlight.lua`
- `tests/run.ts`
- `apps/devhost/internal/devtools/terminal.go`
- `packages/docs/src/content/docs/guides/react-highlight.md`
