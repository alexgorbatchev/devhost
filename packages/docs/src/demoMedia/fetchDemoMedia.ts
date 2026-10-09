import { join } from "node:path";
import { inspectDemoMedia } from "./inspectDemoMedia";
import type { IDemoMediaFetchResult, IFetchDemoMediaOptions } from "./types";

export async function fetchDemoMedia(options: IFetchDemoMediaOptions): Promise<IDemoMediaFetchResult[]> {
  const { manifest, directoryPath, fetcher } = options;
  const results: IDemoMediaFetchResult[] = [];
  for (const { name, state } of await inspectDemoMedia(manifest, directoryPath)) {
    const pin = manifest.files[name];
    if (pin === undefined) continue;
    if (state === "current") {
      results.push({ name, outcome: "present" });
      continue;
    }
    // A video on disk with other content is a render that is not published yet; replacing it would lose it.
    if (state === "different") {
      results.push({ name, outcome: "different" });
      continue;
    }
    const url = `https://github.com/${manifest.repository}/releases/download/${manifest.release}/${pin.asset}`;
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Cannot download ${name} from ${url}: HTTP ${response.status}`);
    const content = await response.bytes();
    const sha256 = new Bun.CryptoHasher("sha256").update(content).digest("hex");
    if (sha256 !== pin.sha256) {
      throw new Error(`${url} is not the pinned ${name}: expected sha256 ${pin.sha256}, received ${sha256}`);
    }
    // Written only once verified, so the site never serves a download that is not the pinned content.
    await Bun.write(join(directoryPath, name), content);
    results.push({ name, outcome: "downloaded" });
  }
  return results;
}
