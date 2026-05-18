import path from "node:path";
import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig, { optimizeDependencyEntries } from "./vite.config";

const dirname: string = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const storybookTestPort: number = Number(process.env.DEVHOST_UI_STORYBOOK_TEST_PORT ?? 6106);

export default mergeConfig(
  viteConfig,
  defineConfig({
    cacheDir: "./.cache/vite",
    optimizeDeps: {
      include: optimizeDependencyEntries,
    },
    resolve: {
      alias: {
        "@": path.join(dirname, "src"),
        "virtual:/@storybook/builder-vite/project-annotations.js":
          "virtual:/@storybook/builder-vite/project-annotations.js",
      },
    },
    test: {
      testTimeout: 60000,
      projects: [
        {
          extends: true,
          optimizeDeps: {
            include: optimizeDependencyEntries,
          },
          resolve: {
            alias: {
              "@": path.join(dirname, "src"),
              "virtual:/@storybook/builder-vite/project-annotations.js":
                "virtual:/@storybook/builder-vite/project-annotations.js",
            },
          },
          test: {
            browser: {
              enabled: true,
              headless: true,
              instances: [{ browser: "chromium" }],
              provider: playwright({}),
            },
            name: "storybook",
            setupFiles: [path.join(dirname, ".storybook/vitest.setup.ts")],
            testTimeout: 120000,
          },
          plugins: [
            storybookTest({
              configDir: path.join(dirname, ".storybook"),
              storybookScript: `storybook dev --ci --port ${storybookTestPort}`,
              storybookUrl: `http://127.0.0.1:${storybookTestPort}`,
            }),
          ],
        },
      ],
    },
  }),
);
