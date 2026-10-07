import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright";

export async function assertNativeReactCompiledAssets(
  page: Page,
  repositoryRoot: string,
  outputPath: string,
): Promise<void> {
  const directoryPath = resolve(repositoryRoot, "apps/devhost/internal/devtools/dist");
  const names = Array.from(new Bun.Glob("**/*").scanSync(directoryPath)).sort();
  const assets = names.filter((name) => !name.endsWith(".gz"));
  const records: unknown[] = [];
  for (const name of assets) {
    const content = await Bun.file(resolve(directoryPath, name)).bytes();
    const sha256 = new Bun.CryptoHasher("sha256").update(content).digest("hex");
    const routeName = name === "devtools.js" ? "inject.js" : name;
    const url = new URL(`/__devhost__/${routeName}`, page.url());
    if (!name.startsWith("assets/")) url.searchParams.set("v", sha256);
    const hasGzip = name.endsWith(".js") || name.endsWith(".css");
    if (hasGzip) {
      const compressed = await Bun.file(resolve(directoryPath, `${name}.gz`)).bytes();
      assert.equal(compressed[0], 31);
      assert.equal(compressed[1], 139);
      assert.equal(Bun.deepEquals(Bun.gunzipSync(compressed), content), true);
    }
    for (const encoding of hasGzip ? ["identity", "gzip"] : ["identity"]) {
      const response = await page.request.get(url.href, {
        ignoreHTTPSErrors: true,
        headers: { "Accept-Encoding": encoding },
        maxRedirects: 0,
      });
      try {
        assert.equal(response.status(), 200, url.href);
        assert.equal(response.headers()["cache-control"], "public, max-age=31536000, immutable");
        assert.equal(response.headers()["vary"], "Accept-Encoding");
        assert.equal(response.headers()["content-encoding"], encoding === "gzip" ? "gzip" : undefined);
        // Installed Playwright decompresses the genuine HTTP gzip response.
        const body = await response.body();
        assert.equal(new Bun.CryptoHasher("sha256").update(body).digest("hex"), sha256, url.href);
        records.push({
          name,
          url: url.href,
          encoding,
          status: response.status(),
          headers: response.headers(),
          sha256,
          bytes: body.byteLength,
        });
      } finally {
        await response.dispose();
      }
    }
  }
  assert.equal(
    names.filter((name) => name.endsWith(".gz")).length,
    assets.filter((name) => name.endsWith(".js") || name.endsWith(".css")).length,
  );
  await Bun.write(resolve(outputPath, "compiled-asset-graph.json"), JSON.stringify({ names, records }, null, 2));
}
