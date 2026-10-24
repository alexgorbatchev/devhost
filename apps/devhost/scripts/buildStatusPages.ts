import { fileURLToPath } from "node:url";
import tailwindPlugin from "bun-plugin-tailwind";

export async function buildStatusPages(): Promise<void> {
  const packageURL = new URL("../../../packages/devhost-ui/package.json", import.meta.url);
  const result = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.resolve("@alexgorbatchev/devhost-ui/status-pages", packageURL.href))],
    target: "browser",
    format: "iife",
    minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    outdir: fileURLToPath(new URL("../internal/statuspage/dist/", import.meta.url)),
    naming: "statusPages.js",
  });
  if (!result.success) throw new Error(`Failed to build status pages: ${result.logs.map(String).join("\n")}`);
  const stylesheet = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL("../../../packages/devhost-ui/src/statusPages/statusPages.css", import.meta.url)),
    ],
    plugins: [tailwindPlugin],
    minify: true,
    outdir: fileURLToPath(new URL("../internal/statuspage/dist/", import.meta.url)),
  });
  if (!stylesheet.success)
    throw new Error(`Failed to build status page styles: ${stylesheet.logs.map(String).join("\n")}`);
}
