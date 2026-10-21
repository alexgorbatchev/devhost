import { z } from "zod";
import type { IChromeForTestingRelease } from "./types";

const listingSchema = z.object({
  channels: z.object({
    Stable: z.object({
      version: z.string().min(1),
      downloads: z.object({ chrome: z.array(z.object({ platform: z.string(), url: z.string().url() })) }),
    }),
  }),
});

// Reads the current Stable build for a platform from Chrome for Testing's
// last-known-good-versions-with-downloads.json listing.
export function selectChromeForTestingRelease(listing: unknown, platformName: string): IChromeForTestingRelease {
  const stable = listingSchema.parse(listing).channels.Stable;
  const download = stable.downloads.chrome.find((candidate) => candidate.platform === platformName);
  if (download === undefined) {
    throw new Error(`Chrome for Testing Stable ${stable.version} has no chrome download for ${platformName}`);
  }
  return { version: stable.version, url: download.url };
}
