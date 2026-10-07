import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import { nativeBrowserTransport, nativeBrowserTransportCommands } from "./test-support/nativeBrowserTransport";
import viteConfig from "./vite.config";

// The tests that need a browser run in Chromium: hook tests, whose hooks listen to the page, hit-test it, measure it,
// and follow its media queries, and `*.browser.test.ts` files, whose modules query and change the DOM.
export default mergeConfig(
  viteConfig,
  defineConfig({
    cacheDir: "./.cache/vite-browser",
    plugins: [nativeBrowserTransport()],
    optimizeDeps: {
      include: ["@testing-library/react", "react", "react-dom", "react-dom/client", "react/jsx-dev-runtime"],
    },
    test: {
      browser: {
        commands: nativeBrowserTransportCommands,
        enabled: true,
        headless: true,
        instances: [{ browser: "chromium" }],
        provider: playwright({}),
        // A hook test renders no interface, so a screenshot of a failure shows nothing.
        screenshotFailures: false,
        viewport: { height: 768, width: 1024 },
      },
      // `bun test --coverage` cannot see the hooks, because their tests run here. `--coverage` reports them.
      coverage: {
        include: ["src/**/hooks/*.{ts,tsx}"],
        provider: "v8",
        // Vitest leaves fully covered files out of the table when an agent runs it; list every hook for everyone.
        reporter: [["text", { skipFull: false }]],
        reportsDirectory: "./.cache/coverage-browser",
      },
      include: ["src/**/hooks/__tests__/*.test.ts", "src/**/*.browser.test.ts"],
      name: "browser",
      setupFiles: ["./test-support/setupBrowserTests.ts"],
    },
  }),
);
