import { defineConfig } from "ts-unused";

export default defineConfig({
  testFilePatterns: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/__tests__/**",
    "**/test-support/**",
  ],
  ignoreFilePatterns: ["**/stories/**", "**/.storybook/**"],
  // Duplicate-type analysis compares shapes, so distinct concepts that happen to share one are named here instead of
  // being merged. The lint policy requires these signatures to be named, which the names below do by role.
  ignoreTypes: [
    // Callbacks without arguments, each named for what it does: mount, unmount, dispose, listen, unsubscribe, draw.
    "AnnotationSelectionPluginListener",
    "AnnotationSelectionPluginSubscription",
    "DisposeSubscription",
    "ExternalDevtoolsChangeListener",
    "ExternalDevtoolsUnsubscribe",
    "IRenderCanvasFunction",
    "MountDevtools",
    "ReactHighlightOverlayCleanup",
    "ReduxDevtoolsDispose",
    "ReduxDevtoolsListener",
    "StreamEventHandler",
    "SynchronizeLaunchers",
    "UnmountDevtools",
    // The demo recorder removes a cache directory; a caption change shares the (text) => Promise<void> shape.
    "RemovePromoCache",
    // A floating surface's width shares its "md" | "sm" scale with icon sizes.
    "FloatingSurfaceWidth",
    // Geometry owned by different features and coordinate spaces: captured-image pixels, overlay rectangles, label
    // positions, and the config editor's character range ({ from, to } offsets, beside the recorder's step seconds).
    "IScreenshotArea",
    "IHighlightOverlayRectangle",
    "IViewportPosition",
    "ITextRange",
  ],
  packageMode: true,
});
