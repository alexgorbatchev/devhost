---
title: "React Highlight"
sidebar:
  order: 9
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/react-highlight.webp" aria-label="react highlight demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/react-highlight.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/react-highlight.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/react-highlight.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

:::note[Video coverage]
The published film demonstrates the Neovim launcher. Devhost's current source-navigation controls use external IDE URL handlers; the cursor-highlight transport below remains available for integrations.
:::

React Highlight draws browser overlays for JSX source locators published to the running stack. It uses the instance-scoped control server and does not launch an editor or terminal. For normal component-source navigation, use Alt + right-click and an external editor configured through devtools.editor.

## Publish a source locator

Enable editor devtools and publish through the routed page's origin. For example, a host-page integration can send:

```js
await fetch("/__devhost__/react-highlight/cursor", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ locator: "src/App.tsx:15:7" }),
});
```

Use a null locator to clear the current highlight. The control server supplies the instance's project root, stack name, and timestamp, then broadcasts the update on /**devhost**/ws/react-highlight. Separate stacks have separate control listeners. There is no generated Vim launcher or bundled editor plugin.

An accepted publish request confirms transport, not a DOM match. Integrations should avoid publishing unchanged locators repeatedly.

## Browser Matching

Cursor highlight rectangles appear above page content, including existing popovers, and beneath the other injected devtools surfaces, without blocking page clicks. Cursor updates replace the previous rectangles; clearing the cursor removes them.

Disabling editor devtools or removing the injected overlay closes its cursor connection and removes its highlights. Updates from a previous connection and matching results that finish after a newer cursor update or cleanup are discarded.

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
- If no cursor payloads arrive, check the publisher's routed endpoint, enabled editor feature, and source locator.

Direct browser or command-line WebSocket clients must connect through the same route and authentication context as the page. If an upstream proxy redirects unauthenticated requests to a sign-in page, a raw `wss://.../__devhost__/ws/react-highlight` connection can fail before it reaches devhost.
