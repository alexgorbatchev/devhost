import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";
import { createCoverageOptions } from "./vitest.coverage";

// The tests that need a browser run in Chromium: hook tests, whose hooks listen to the page, hit-test it, measure it,
// and follow its media queries, and `*.browser.test.ts` files, whose modules query and change the DOM.
export default mergeConfig(
  viteConfig,
  defineConfig({
    cacheDir: "./.cache/vite-browser",
    optimizeDeps: {
      include: [
        "@alexgorbatchev/shadcn",
        "@codemirror/autocomplete",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/legacy-modes/mode/toml",
        "@codemirror/lint",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/highlight",
        "@testing-library/react",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-dev-runtime",
      ],
    },
    test: {
      browser: {
        enabled: true,
        headless: true,
        instances: [{ browser: "chromium" }],
        provider: playwright({}),
        // A hook test renders no interface, so a screenshot of a failure shows nothing.
        screenshotFailures: false,
        viewport: { height: 768, width: 1024 },
      },
      coverage: createCoverageOptions("browser"),
      include: ["src/**/hooks/__tests__/*.test.ts", "src/**/*.browser.test.ts"],
      name: "browser",
      setupFiles: ["./test-support/setupBrowserTests.ts"],
    },
  }),
);
