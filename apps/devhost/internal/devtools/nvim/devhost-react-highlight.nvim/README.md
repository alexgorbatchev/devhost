# devhost-react-highlight.nvim

Neovim plugin used by `devhost` to mirror the active React JSX cursor location into the browser overlay for the same running devhost instance.

## Devhost-managed usage

When devhost opens Neovim from the injected browser UI, it prepares this plugin in an instance-scoped Neovim package site and injects:

```sh
DEVHOST_REACT_HIGHLIGHT_URL
DEVHOST_CONTROL_TOKEN
DEVHOST_PROJECT_ROOT
DEVHOST_STACK_NAME
```

The plugin starts automatically only when `DEVHOST_REACT_HIGHLIGHT_URL` is present.

For direct shell testing while a devhost stack is running, use the generated project launcher:

```sh
.tmp/devhost/<stack-name>/nvim-shell/bin/devhost-nvim .
```

That launcher sets the instance endpoint, control token, project root, stack name, and Neovim package path before
executing `nvim`.

## Standalone usage

Install this directory as a normal Neovim plugin, then either launch Neovim with the same environment variables or configure it explicitly:

```lua
require("devhost-react-highlight").setup({
  endpoint = "http://127.0.0.1:49152/__devhost__/react-highlight/cursor",
  token = "devhost-control-token",
  project_root = vim.fn.getcwd(),
  stack_name = "hello-stack",
  debounce_ms = 150,
})
```

The endpoint and token must come from the devhost instance you want to target. Without them, the plugin stays idle.

## Editor Indicator

When the plugin resolves a JSX element and devhost accepts the cursor update, Neovim places a `->` sign on the current
JSX element line. The sign clears when the cursor leaves JSX or the update fails.

## Requirements

- `curl` on `PATH`
- Neovim Tree-sitter parser support for TSX/JSX buffers
