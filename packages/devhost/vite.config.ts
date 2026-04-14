import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "virtual:/@storybook/builder-vite/project-annotations.js":
        "virtual:/@storybook/builder-vite/project-annotations.js",
    },
  },
});
