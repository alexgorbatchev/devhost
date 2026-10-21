import { z } from "zod";
import { nativeReactMinimumExtensionVersion } from "./constants";

// Chrome extension versions are one to four dot-separated integers from 0 to 65535.
const versionPattern = /^(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}$/;

const manifestSchema = z.object({
  version: z.string().regex(versionPattern),
  devtools_page: z.literal("main.html"),
  background: z.object({ service_worker: z.literal("build/background.js") }),
});

function readVersionParts(version: string): number[] {
  const parts = version.split(".").map(Number);
  return [...parts, 0, 0, 0].slice(0, 4);
}

// Checks that an unpacked React Developer Tools manifest is a release devhost drives: 8.0.0 or newer, with the DevTools
// page and service worker devhost's native window contract uses. Returns the release's version.
export function assertReactExtensionManifest(value: unknown): string {
  const manifest = manifestSchema.parse(value);
  const actual = readVersionParts(manifest.version);
  const minimum = readVersionParts(nativeReactMinimumExtensionVersion);
  const difference = actual.map((part, index) => part - (minimum[index] ?? 0)).find((delta) => delta !== 0) ?? 0;
  if (difference < 0) {
    throw new Error(
      `React Developer Tools ${manifest.version} is older than ${nativeReactMinimumExtensionVersion}, the oldest release devhost drives.`,
    );
  }
  return manifest.version;
}
