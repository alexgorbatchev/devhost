import { chromium } from "playwright";
import { createOwnedBrowserEnvironment } from "../../../../../../test-support/createOwnedBrowserEnvironment";
import type { IAnimation } from "../../../../../../test-support/types";

// Decodes an animated image as a browser shows it. FFmpeg writes animated WebP but cannot read it.
export async function readAnimation(imagePath: string, runDirectoryPath: string): Promise<IAnimation> {
  // Read here, not in the server, so a missing image rejects for the caller instead of failing outside its cleanup.
  const image = Bun.file(imagePath);
  const bytes = await image.bytes();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request): Response =>
      new URL(request.url).pathname === "/image"
        ? new Response(bytes, { headers: { "Content-Type": image.type } })
        : new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }),
  });
  const browser = await chromium.launch({ env: await createOwnedBrowserEnvironment(runDirectoryPath) });
  try {
    const page = await browser.newPage();
    // ImageDecoder exists only in a secure context, which a loopback address is.
    await page.goto(server.url.href);
    return await page.evaluate(async (): Promise<IAnimation> => {
      const response = await fetch("/image");
      const type = response.headers.get("Content-Type");
      if (!response.body || !type) throw new Error("The image has no body or type");
      const decoder = new ImageDecoder({ data: response.body, type });
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      if (!track) throw new Error("The image has no track");
      const canvas = new OffscreenCanvas(1, 1);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The canvas has no 2D context");
      const colors: number[][] = [];
      let duration = 0;
      let width = 0;
      let height = 0;
      for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        width = image.displayWidth;
        height = image.displayHeight;
        duration += image.duration ?? 0;
        context.drawImage(image, 0, 0, 1, 1);
        colors.push(Array.from(context.getImageData(0, 0, 1, 1).data.subarray(0, 3)));
        image.close();
      }
      decoder.close();
      return { width, height, repetitionCount: track.repetitionCount, duration: duration / 1_000_000, colors };
    });
  } finally {
    await browser.close();
    await server.stop(true);
  }
}
