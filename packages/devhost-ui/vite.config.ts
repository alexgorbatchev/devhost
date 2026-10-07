import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const dirname: string = path.dirname(fileURLToPath(import.meta.url));
const devtoolsStylesheetPath: string = path.resolve(dirname, "src/devtools/shared/devtools.css");
const devtoolsStylesheetTextModuleId: string = "\0devhost-devtools-css-text";

export const optimizeDependencyEntries: string[] = [
  "@hookform/devtools",
  "react-hook-form",
  "jotai",
  "jotai-devtools",
  "@storybook/react-dom-shim",
  "@tanstack/react-query-devtools/production",
  "@tanstack/react-router-devtools",
  "use-color/a11y",
  "use-color/core",
  "@tanstack/react-devtools",
  "@tanstack/react-form",
  "@tanstack/react-form-devtools",
  "@tanstack/react-table",
  "@tanstack/react-table-devtools",
  "@tanstack/pacer",
  "@tanstack/react-pacer-devtools",
];

/**
 * Gives `devtoolsStyles.ts` the compiled devtools stylesheet as text, which it installs into each shadow root. The
 * Go bundle build makes the same substitution for the shipped runtime; without one, `devtoolsCssText.ts` is empty.
 */
function inlineDevtoolsStylesheet(): Plugin {
  return {
    enforce: "pre",
    name: "devhost-inline-devtools-stylesheet",
    resolveId(source: string, importer: string | undefined): string | null {
      const importerPath: string = importer?.split("?")[0] ?? "";

      return source === "./devtoolsCssText" && importerPath.endsWith("/src/devtools/shared/devtoolsStyles.ts")
        ? devtoolsStylesheetTextModuleId
        : null;
    },
    load(id: string): string | null {
      return id === devtoolsStylesheetTextModuleId
        ? `export { default } from ${JSON.stringify(`${devtoolsStylesheetPath}?inline`)};`
        : null;
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    include: optimizeDependencyEntries,
  },
  plugins: [inlineDevtoolsStylesheet(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      "virtual:/@storybook/builder-vite/project-annotations.js":
        "virtual:/@storybook/builder-vite/project-annotations.js",
    },
  },
});
