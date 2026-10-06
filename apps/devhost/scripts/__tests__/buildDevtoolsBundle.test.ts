import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildDevtoolsBundle } from "../buildDevtoolsBundle";

let directoryPath: string;

beforeEach(async () => {
  const temporaryRootPath: string = resolve(import.meta.dir, "../../../..", ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  directoryPath = await mkdtemp(resolve(temporaryRootPath, "devtools-build-"));
});

afterEach(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

describe("buildDevtoolsBundle", () => {
  test.each([
    { isProduction: true, hasDevelopmentDiagnostics: false },
    { isProduction: false, hasDevelopmentDiagnostics: true },
  ])(
    "builds browser assets with the selected runtime mode: %j",
    async ({ isProduction, hasDevelopmentDiagnostics }) => {
      await buildDevtoolsBundle({ isProduction, outputDirectoryPath: directoryPath });
      const script: string = await Bun.file(resolve(directoryPath, "devtools.js")).text();
      expect(script.includes("Invalid hook call. Hooks can only be called")).toBe(hasDevelopmentDiagnostics);
      expect(script.includes("xterm-viewport")).toBe(false);
      expect(script.includes("data:font/woff2;base64,")).toBe(false);
      const registration: string = await Bun.file(resolve(directoryPath, "redux.js")).text();
      const monitor: string = await Bun.file(resolve(directoryPath, "redux-monitor.js")).text();
      expect(registration.includes("registerReduxDevtoolsStore")).toBe(true);
      expect(registration.includes("registerZustandDevtoolsStore")).toBe(true);
      expect(monitor.includes("DEVHOST_REDUX_HELLO")).toBe(true);
      expect(monitor.includes("Invalid hook call. Hooks can only be called")).toBe(hasDevelopmentDiagnostics);
      expect((await Bun.file(resolve(directoryPath, "redux-monitor.css")).bytes()).byteLength).toBeGreaterThan(0);
      const imports = [...script.matchAll(/import\("\/__devhost__\/([^"?]+\.js)"\)/g)];
      expect(imports.length).toBeGreaterThan(0);
      for (const match of imports)
        expect(await Bun.file(resolve(directoryPath, match[1] ?? "missing")).exists()).toBe(true);
      const fonts = Array.from(new Bun.Glob("assets/*.woff2").scanSync(directoryPath));
      expect(fonts.length).toBe(6);
      for (const font of fonts) {
        const content = await Bun.file(resolve(directoryPath, font)).bytes();
        expect(new TextDecoder().decode(content.slice(0, 4))).toBe("wOF2");
      }
      for await (const name of new Bun.Glob("**/*.{js,css}").scan(directoryPath)) {
        const content = await Bun.file(resolve(directoryPath, name)).bytes();
        const compressed = await Bun.file(resolve(directoryPath, `${name}.gz`)).bytes();
        expect(Bun.gunzipSync(compressed)).toEqual(content);
        expect(compressed.byteLength).toBeLessThan(content.byteLength);
      }
    },
  );

  test("removes obsolete release assets and retains chunks for active source-mode tabs", async () => {
    const oldChunkPath: string = resolve(directoryPath, "assets/old-chunk.js");
    await Bun.write(oldChunkPath, "console.log('old chunk');");
    await buildDevtoolsBundle({ isProduction: false, outputDirectoryPath: directoryPath });
    expect(await Bun.file(oldChunkPath).exists()).toBe(true);
    await buildDevtoolsBundle({ outputDirectoryPath: directoryPath });
    expect(await Bun.file(oldChunkPath).exists()).toBe(false);
  });
});
