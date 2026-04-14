import path from "node:path";
import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig } from "vitest/config";

const dirname: string = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const optimizedDependencyIds: string[] = ["@rrweb/all", "react/jsx-dev-runtime", "react/jsx-runtime"];

export default defineConfig({
  cacheDir: "./.cache/vite",
  optimizeDeps: {
    include: optimizedDependencyIds,
  },
  test: {
    projects: [
      {
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright({}),
          },
          name: "storybook",
        },
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
            storybookScript: "storybook dev --ci --port 6007",
            storybookUrl: "http://127.0.0.1:6007",
          }),
        ],
      },
    ],
  },
});
