import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// Hook tests run in Chromium: the hooks listen to the page, hit-test it, measure it, and follow its media queries,
// and only a browser does those.
export default mergeConfig(
  viteConfig,
  defineConfig({
    cacheDir: "./.cache/vite-hooks",
    optimizeDeps: {
      include: ["@testing-library/react", "react", "react-dom", "react-dom/client", "react/jsx-dev-runtime"],
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
      // A hook test that needs Bun itself, such as one that serves a real loopback endpoint, runs in `bun test`.
      // Keep this list and the ignore patterns in bunfig.toml in step.
      exclude: [...configDefaults.exclude, "src/devtools/shared/hooks/__tests__/useNativeBrowserConnection.test.ts"],
      include: ["src/**/hooks/__tests__/*.test.ts"],
      name: "hooks",
      setupFiles: ["./test-support/setupHookTests.ts"],
    },
  }),
);
