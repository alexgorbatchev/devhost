---
title: "Highlight source locations"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/react-highlight.webp" aria-label="react highlight demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/react-highlight.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/react-highlight.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/react-highlight.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

:::note[Video coverage]
The film shows a Neovim launcher that devhost no longer ships. The cursor transport below is what an editor integration uses today.
:::

React Highlight outlines the elements on the page that a source location renders, such as the JSX under your editor's cursor. An editor plugin or script publishes the location; devhost draws the outline in every open page of the stack. To go the other way, from the page to your editor, use [Alt + right-click](../devtools/#open-component-source).

## Publish a location

Send the location to the page's own hostname while `[devtools.editor].enabled` is on (the default):

```js
await fetch("/__devhost__/react-highlight/cursor", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ locator: "src/App.tsx:15:7" }),
});
```

The locator is `file:line:column`, relative to the project. Send `{"locator": null}` to clear the highlight. Each update replaces the previous one; avoid sending the same locator repeatedly.

A successful response means devhost received the update, not that anything matched on the page. Each stack has its own endpoint, so updates never reach another project's pages. devhost does not launch editors and ships no editor plugin.

## How the page finds elements

The page matches a locator in one of two ways, in this order:

1. **React source metadata.** A React development build that records source locations on its components gives exact matches.
2. **Source maps.** When that metadata is missing, as with Bun's React development transform, the page reads the page's JavaScript source maps, finds the JSX at that line, and matches simple tags.

The source-map fallback works for lowercase tags that render one DOM element, such as `<div>`, `<h1>`, `<p>`, `<code>`, or `<img>`. A component tag such as `<APITester />` creates no DOM element of its own, so without React's metadata it often cannot be matched.

Outlines appear above page content, including popovers, below devhost's own toolbar, and never block clicks.

## Debug a highlight that does not appear

Listen for match results in the browser console:

```js
window.addEventListener("devhost:react-highlight", (event) => console.log(event.detail));
// { locator: "src/App.tsx:15:7", matchedCount: 1 }
```

- **`matchedCount` above `0`:** elements matched and should be outlined.
- **`matchedCount` is `0`:** the update arrived, but nothing on the page matched that location. Check the line and column, and whether the tag is a component (see above).
- **No event at all:** the update never arrived. Check that the publisher posts to the page's own hostname, that `[devtools.editor].enabled` is on, and that the locator is set.

A script that connects to `wss://<host>/__devhost__/ws/react-highlight` directly needs the same route and sign-in as the page; an authenticating proxy can redirect it before it reaches devhost.
