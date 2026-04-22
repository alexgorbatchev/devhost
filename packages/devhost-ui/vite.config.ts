import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "virtual:/@storybook/builder-vite/project-annotations.js":
        "virtual:/@storybook/builder-vite/project-annotations.js",
    },
  },
});
