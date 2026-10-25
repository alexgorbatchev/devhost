---
title: "Selection plugins"
---

When you select an element for chat, devhost's built-in selector picks a DOM element under the pointer. A selection plugin replaces that choice on your page: for example, to select a whole chart instead of one of its SVG paths, or to point at items drawn on a canvas.

## Register a plugin

devhost exposes a registry as `globalThis.__DEVHOST__` once its toolbar loads, and dispatches a `devhost:annotation-selection-ready` event on `window` when the registry is ready. A page that loads before devhost can queue plugins in `globalThis.__DEVHOST_PLUGINS__`; devhost registers them when it starts.

```js
const plugin = {
  id: "custom-surface",
  label: "Custom surface",
  priority: 10,
  matches() {
    return true;
  },
  resolveCandidate(event, intent, context) {
    if (context.isDevtoolsEventTarget(event.target)) {
      return null;
    }

    return {
      id: "target-1",
      label: "Target 1",
      readRect() {
        return { x: 0, y: 0, width: 100, height: 40 };
      },
      async buildMarkerPayload(markerNumber) {
        return {
          accessibility: "",
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
          computedStyles: "",
          computedStylesObj: {},
          cssClasses: "",
          element: "Target 1",
          elementPath: "Target 1",
          fullPath: "Target 1",
          isFixed: false,
          markerNumber,
          nearbyElements: "",
          nearbyText: "",
        };
      },
    };
  },
};

const registry = globalThis.__DEVHOST__;

if (registry) {
  registry.registerPlugin(plugin);
} else {
  globalThis.__DEVHOST_PLUGINS__ ??= [];
  globalThis.__DEVHOST_PLUGINS__.push(plugin);
}
```

`registerPlugin` returns a function that unregisters the plugin.

## How devhost picks a plugin

- The built-in DOM selector is always registered, with ID `dom-elements` and priority `0`.
- The active plugin is the matching plugin with the highest `priority`. `matches()` defaults to `true` and `priority` to `0`. When priorities tie, the plugin registered first wins.
- `resolveCandidate()` returning `null` means the event selects nothing.
- `readRect()` positions the selection highlight; return `null` for no highlight.
- `getCursorStyleText()` returns CSS that devhost applies only while selection mode is on; return `null`, or leave it out, to keep the default cursor.
- devhost's own toolbar is selectable only in the **devhost** chat directory, and always through the built-in selector, whatever plugins you register. The annotation tools themselves are never selectable.

## What the agent receives

Each marker sends the `IAnnotationMarkerPayload` your candidate builds, with the message text, page URL and title, drawing positions, and screenshot size when one is attached. A cropped screenshot also carries its position, size, and the full screenshot's size, so the agent can relate the crop to the markers.

On a React development build that exposes component source metadata, the built-in selector fills `sourceLocation` with the nearest component's file, line, and column. When the page serves source maps, devhost maps bundled locations back to the original files first.

## Types

```ts
type AnnotationSelectionIntent = "hover" | "select";

interface IRectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IAnnotationSourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

interface IAnnotationMarkerPayload {
  accessibility: string;
  boundingBox: IRectSnapshot;
  computedStyles: string;
  computedStylesObj: Record<string, string>;
  cssClasses: string;
  element: string;
  elementPath: string;
  fullPath: string;
  isFixed: boolean;
  markerNumber: number;
  nearbyElements: string;
  nearbyText: string;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

interface IAnnotationSelectionCandidate {
  id: string;
  label: string;
  readRect(): IRectSnapshot | null;
  buildMarkerPayload(markerNumber: number): Promise<IAnnotationMarkerPayload>;
}

interface IAnnotationSelectionPluginContext {
  isDevtoolsEventTarget(target: EventTarget | null): boolean;
}

interface IAnnotationSelectionPlugin {
  id: string;
  label: string;
  priority?: number;
  matches?(): boolean;
  getCursorStyleText?(): string | null;
  resolveCandidate(
    event: MouseEvent,
    intent: AnnotationSelectionIntent,
    context: IAnnotationSelectionPluginContext,
  ): IAnnotationSelectionCandidate | Promise<IAnnotationSelectionCandidate | null> | null;
}

interface IAnnotationSelectionPluginRegistry {
  listPlugins(): IAnnotationSelectionPlugin[];
  registerPlugin(plugin: IAnnotationSelectionPlugin): () => void;
  subscribe(listener: () => void): () => void;
  unregisterPlugin(pluginId: string): void;
}
```
