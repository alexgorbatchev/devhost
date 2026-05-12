import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const dirname: string = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      "virtual:/@storybook/builder-vite/project-annotations.js":
        "virtual:/@storybook/builder-vite/project-annotations.js",
    },
  },
});
