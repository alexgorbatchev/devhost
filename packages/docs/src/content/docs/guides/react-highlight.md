---
title: "React Highlight"
sidebar:
  order: 9
---

React Highlight mirrors the active JSX cursor position from Neovim into the routed browser page. It is part of the injected devtools overlay and uses the same instance-scoped control server as the rest of the devtools runtime.

For the injected overlay and routing model, see [Devtools](./devtools/).

## Requirements

React Highlight requires:

- `[devtools.editor].enabled = true`
- `nvim` on the machine running `devhost`
- `curl` on `PATH`
- Neovim Tree-sitter support for TSX/JSX buffers
- a routed root-compatible service so the injected browser overlay can mount

The feature does not require `[devtools.editor].ide = "neovim"` for the shell launcher. That setting controls browser component-source opens. The shell launcher is written whenever editor devtools are enabled for a running stack.

## Start Neovim With The Plugin

While a stack is running, `devhost` writes an instance-scoped launcher under the project root:

```sh
.tmp/devhost/<stack-name>/nvim-shell/bin/devhost-nvim .
```

The launcher sets these values before executing `nvim`:

- `DEVHOST_REACT_HIGHLIGHT_URL`
- `DEVHOST_CONTROL_TOKEN`
- `DEVHOST_PROJECT_ROOT`
- `DEVHOST_STACK_NAME`
- `DEVHOST_NVIM_SITE_PATH`

Repository checkouts can also expose a package script that points at the generated launcher, such as:

```sh
bun nvim
```

The launcher is tied to one running devhost stack. Restarting the stack can change the local control port and token, so use the current generated launcher after each stack restart.

## Cursor Updates

The Neovim plugin resolves the nearest JSX node under the cursor and posts a cursor payload to the devhost control server. The control server broadcasts that payload to browser clients connected to:

```text
/__devhost__/ws/react-highlight?token=<instance-control-token>
```

Payloads look like:

```json
{
  "kind": "cursor",
  "locator": "src/App.tsx:15:7",
  "projectRoot": "/path/to/project",
  "stackName": "playground",
  "timestamp": 1778613368520
}
```

The plugin de-duplicates successive identical locators. Moving inside the same JSX element does not send another message. Moving to a different JSX opening tag sends a new message. Moving outside JSX clears the browser highlight after the resolved locator changes to `null`.

When devhost accepts a cursor update, Neovim places a `->` sign on the resolved JSX line. That sign means the plugin found a JSX locator and the control server accepted the update; it does not mean the browser found a matching DOM node.

## Browser Matching

The browser overlay matches received locators in two passes:

1. React fiber source metadata from the host page.
2. Fetchable JavaScript source maps when fiber metadata is unavailable.

Fiber metadata is the most precise path because it can associate rendered DOM nodes with React source locations. Some development transforms, including the Bun React development transform used by the playground, do not expose source metadata on React fibers. In those cases, the source-map fallback reads the page's script source maps, finds the JSX source line, and maps simple host JSX tags to DOM elements.

The source-map fallback works best for lowercase host tags that render directly to DOM elements:

```tsx
<div className="app">
<h1>Bun + React</h1>
<p>
<code>src/App.tsx</code>
<img ... />
```

Uppercase component tags are best-effort without fiber metadata:

```tsx
<APITester />
```

`<APITester />` does not create an `APITester` DOM element. React calls the component function, and that function renders its own host elements. Without fiber source metadata or explicit runtime instrumentation, the browser cannot reliably map the component callsite to one rendered DOM subtree.

## Debugging

Open the browser console and listen for match diagnostics:

```js
window.addEventListener("devhost:react-highlight", (event) => console.log(event.detail));
```

Each received cursor update dispatches:

```js
{
  locator: "src/App.tsx:15:7",
  matchedCount: 1
}
```

Use this to separate transport from browser matching:

- If the WebSocket receives cursor payloads and `matchedCount` is greater than `0`, the browser found DOM nodes and should draw an overlay.
- If the WebSocket receives cursor payloads and `matchedCount` is `0`, transport works but the locator did not match DOM nodes.
- If no cursor payloads arrive, check the current launcher token/port, Neovim filetype, Tree-sitter parser support, and whether the cursor is on a different JSX locator.

Direct browser or command-line WebSocket clients must connect through the same route and authentication context as the page. If an upstream proxy redirects unauthenticated requests to a sign-in page, a raw `wss://.../__devhost__/ws/react-highlight` connection can fail before it reaches devhost.
