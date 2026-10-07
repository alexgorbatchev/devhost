import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const packagePath = resolve(import.meta.dir, "../..");
const guidePath = join(packagePath, "src/content/docs/guides");
const guideFiles = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: guidePath, onlyFiles: true }));
const slugs = guideFiles.map((file) => file.replace(/\.md$/, "")).sort();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const guide = path.match(/^\/devhost\/guides\/([a-z-]+)\/$/)?.[1];
    if (guide && slugs.includes(guide)) {
      const markdown = await Bun.file(join(guidePath, `${guide}.md`)).text();
      const block = markdown.match(/<!-- guide-demo -->[\s\S]*?<!-- \/guide-demo -->/)?.[0];
      assert(block, `Guide ${guide} has no demo`);
      const frontmatterEnd = markdown.indexOf("\n---\n", 4);
      assert.equal(
        markdown
          .slice(frontmatterEnd + 5)
          .trimStart()
          .indexOf(block),
        0,
        "Demo must be the guide's first content",
      );
      return new Response(
        `<!doctype html><html><head><title>${guide}</title></head><body><main>${block}</main></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    const media = path.match(/^\/devhost\/demos\/([a-z-]+\.(?:mp4|webp|vtt))$/)?.[1];
    if (media) return new Response(Bun.file(join(packagePath, "public/demos", media)));
    return new Response("Not found", { status: 404 });
  },
});
const browser = await chromium.launch();
let guidesPlayed = 0;
let captionsLoaded = 0;
let transcriptsAvailable = 0;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
  await page.route("https://alexgorbatchev.github.io/devhost/**", async (route): Promise<void> => {
    const response = await route.fetch({ url: new URL(new URL(route.request().url()).pathname, server.url).href });
    await route.fulfill({ response });
    await response.dispose();
  });
  for (const slug of slugs) {
    const response = await page.goto(`https://alexgorbatchev.github.io/devhost/guides/${slug}/`);
    assert(response?.ok());
    assert.equal(await page.locator("video").count(), 1);
    const initial = await page.locator("video").evaluate((video: HTMLVideoElement) => ({
      controls: video.controls,
      preload: video.preload,
      autoplay: video.autoplay,
      playsInline: video.playsInline,
    }));
    assert.deepEqual(initial, { controls: true, preload: "none", autoplay: false, playsInline: true });
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
      video.load();
      const track = video.textTracks[0];
      if (track) track.mode = "hidden";
      await video.play();
    });
    await page.waitForFunction(() => {
      const video = document.querySelector("video");
      return video !== null && video.currentTime > 0 && video.videoWidth === 1280 && video.videoHeight === 860;
    });
    guidesPlayed += 1;
    await page.waitForFunction(() => (document.querySelector("video")?.textTracks[0]?.cues?.length ?? 0) > 0);
    captionsLoaded += 1;
    await page.getByText("Demo transcript", { exact: true }).click();
    assert.equal((await page.locator("details[open] p").count()) > 0, true);
    transcriptsAvailable += 1;
    await page.locator("video").evaluate((video: HTMLVideoElement) => {
      video.pause();
    });
  }
  console.log(JSON.stringify({ guidesPlayed, captionsLoaded, transcriptsAvailable }));
} finally {
  await browser.close();
  await server.stop(true);
}
