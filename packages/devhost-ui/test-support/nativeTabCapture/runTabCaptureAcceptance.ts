import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createOwnedBrowserEnvironment } from "../../../../test-support/createOwnedBrowserEnvironment";
import { buildTabCaptureFixture } from "./buildTabCaptureFixture";
import { serveTabCaptureFixture } from "./serveTabCaptureFixture";
import type { ITabCaptureAcceptanceOptions, ITabCaptureAcceptanceProof, ITabCaptureTrackProof } from "./types";

export async function runTabCaptureAcceptance(
  options: ITabCaptureAcceptanceOptions = {},
): Promise<ITabCaptureAcceptanceProof> {
  const temporaryRoot = join(tmpdir(), "devhost-e2e");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "tab-capture-"));
  const title = `devhost native tab capture ${crypto.randomUUID()}`;
  try {
    await buildTabCaptureFixture(join(directory, "bundle"));
    const fixture = serveTabCaptureFixture(join(directory, "bundle"), title);
    try {
      const browser = await chromium.launchPersistentContext(join(directory, "profile"), {
        channel: "chromium",
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: [`--auto-select-tab-capture-source-by-title=${title}`],
        env: await createOwnedBrowserEnvironment(directory, {
          ...process.env,
          CHROME_CONFIG_HOME: join(directory, "chrome-config"),
          XDG_CACHE_HOME: join(directory, "cache"),
          XDG_DATA_HOME: join(directory, "data"),
          XDG_STATE_HOME: join(directory, "state"),
          XDG_RUNTIME_DIR: join(directory, "runtime"),
        }),
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.addInitScript(() => {
          const stopped: MediaStreamTrack[] = [];
          Reflect.set(window, "nativeCaptureStoppedTracks", stopped);
          const surfaces: (string | undefined)[] = [];
          Reflect.set(window, "nativeCaptureSurfaces", surfaces);
          const original = MediaStreamTrack.prototype.stop;
          MediaStreamTrack.prototype.stop = function stop(): void {
            stopped.push(this);
            surfaces.push(this.getSettings().displaySurface);
            original.call(this);
          };
        });
        // Annotating chat itself is what the devhost chat target is for.
        const pageURL = new URL(fixture.server.url);
        if (options.isChatAnnotated) pageURL.searchParams.set("target", "devhost");
        await page.goto(String(pageURL));
        if (options.isSharingAheadOfTime) {
          await page.getByRole("button", { name: "Share Tab", exact: true }).click();
          await page.getByRole("button", { name: "Stop Sharing", exact: true }).waitFor();
        }
        if (options.topLayer) {
          await page.getByRole("button", { name: `Open capture ${options.topLayer}`, exact: true }).click();
        }
        await page.getByRole("button", { name: "Box", exact: true }).click();
        await page.mouse.move(180, 230);
        await page.mouse.down();
        await page.mouse.move(500, 450);
        await page.mouse.up();
        await page.getByRole("img", { name: "box annotation", exact: true }).waitFor();
        const panel = await page.getByTestId("AgentChatPanel").boundingBox();
        const dock = await page.getByTestId("DevtoolsToolbar--bar").boundingBox();
        assert(panel);
        assert(dock);
        if (options.isChatAnnotated) {
          await page.getByRole("button", { name: "Select Elements", exact: true }).click();
          await page.getByRole("button", { name: "Chat Settings", exact: true }).click();
          await page.getByRole("button", { name: "Remove Element 1", exact: true }).waitFor();
          assert.equal(await page.getByRole("dialog", { name: "Chat Settings", exact: true }).count(), 0);
          await page.keyboard.press("Escape");
        }
        await page.getByRole("textbox").fill("Review this annotated page.");
        await page.getByRole("button", { name: "Send Message", exact: true }).hover();
        const tooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Send Message" });
        await tooltip.waitFor({ timeout: 3_000 });
        const tooltipBounds = await tooltip.boundingBox();
        assert(tooltipBounds);
        await page.getByRole("button", { name: "Send Message", exact: true }).click();
        const command = await Promise.race([
          fixture.sentCommand,
          new Promise<never>((_resolve, reject) => {
            const signal = AbortSignal.timeout(15_000);
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        ]);
        assert(typeof command === "object" && command !== null && "images" in command);
        assert("type" in command && command.type === "send");
        assert("text" in command && typeof command.text === "string");
        await page.getByRole("textbox").fill("A follow-up draft");
        await page.getByRole("button", { name: "Send Message", exact: true }).waitFor();
        assert(await page.getByRole("button", { name: "Send Message", exact: true }).isEnabled());
        const serializedContext: unknown = JSON.parse(command.text.split("\n").at(-1) ?? "");
        assert(typeof serializedContext === "object" && serializedContext !== null && "shapes" in serializedContext);
        assert(Array.isArray(serializedContext.shapes));
        assert.equal(serializedContext.shapes.length, 1);
        assert.equal(serializedContext.shapes[0].kind, "box");
        assert("markers" in serializedContext && Array.isArray(serializedContext.markers));
        assert.equal(serializedContext.markers.length, options.isChatAnnotated ? 1 : 0);
        assert(Array.isArray(command.images));
        await page.getByRole("region", { name: "Page context", exact: true }).waitFor({ state: "detached" });
        assert.equal(await page.getByRole("img", { name: "box annotation", exact: true }).count(), 0);
        const attachment: unknown = command.images[0];
        assert(typeof attachment === "object" && attachment !== null && "dataURL" in attachment);
        assert(typeof attachment.dataURL === "string");
        const dataURL = attachment.dataURL;
        const image = await page.evaluate(
          async ({ dataURL, panel, dock, tooltipBounds }) => {
            const source = new Image();
            source.src = dataURL;
            await source.decode();
            const canvas = document.createElement("canvas");
            canvas.width = source.width;
            canvas.height = source.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Native PNG decoding requires a canvas context.");
            context.drawImage(source, 0, 0);
            const pixel = (x: number, y: number): number[] =>
              Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data);
            const color = (value: string): number[] => {
              context.fillStyle = value;
              context.fillRect(0, 0, 1, 1);
              return pixel(0, 0);
            };
            // Annotation layers follow an open host modal or popover into hosts of their own.
            const trees = [
              document.getElementById("devhost-devtools-host")?.shadowRoot,
              ...Array.from(document.querySelectorAll("[data-devhost-annotation-host]"), (host) => host.shadowRoot),
            ];
            const find = (selector: string): Element | undefined =>
              trees.map((tree) => tree?.querySelector(selector) ?? undefined).find((element) => element !== undefined);
            const annotation = find('[data-testid="AnnotationCanvas"]');
            const chat = find('[data-testid="AgentChatPanel"]');
            const host = document.getElementById("host-target");
            const layer = document.querySelector("#capture-modal:modal, #capture-popover:popover-open");
            if (!annotation || !host || !chat) throw new Error("Actual annotation, chat and host must remain mounted.");
            return {
              width: source.width,
              height: source.height,
              shape: pixel(180, 330),
              host: pixel(60, 80),
              panel: pixel(panel.x + panel.width / 2, panel.y + panel.height / 2),
              dock: pixel(dock.x + dock.width / 2, dock.y + dock.height / 2),
              expectedShape: color(getComputedStyle(annotation).color),
              expectedHost: color(getComputedStyle(host).backgroundColor),
              expectedPage: color(getComputedStyle(document.body).backgroundColor),
              expectedPanel: color(getComputedStyle(chat).backgroundColor),
              layer: pixel(60, 260),
              expectedLayer: color(getComputedStyle(layer ?? document.body).backgroundColor),
              tools: pixel(640, 28),
              tooltip: pixel(tooltipBounds.x + tooltipBounds.width / 2, tooltipBounds.y + tooltipBounds.height / 2),
              isTooltipOverPanel:
                tooltipBounds.x + tooltipBounds.width / 2 >= panel.x &&
                tooltipBounds.x + tooltipBounds.width / 2 <= panel.x + panel.width &&
                tooltipBounds.y + tooltipBounds.height / 2 >= panel.y &&
                tooltipBounds.y + tooltipBounds.height / 2 <= panel.y + panel.height,
            };
          },
          { dataURL, panel, dock, tooltipBounds },
        );
        if (options.isSharingAheadOfTime) {
          const stoppedTrackCount = await page.evaluate(() => {
            const stopped: MediaStreamTrack[] = Reflect.get(window, "nativeCaptureStoppedTracks");
            return stopped.length;
          });
          assert.equal(stoppedTrackCount, 1);
          await page.getByRole("button", { name: "Stop Sharing", exact: true }).click();
        }
        const tracks = await page.evaluate((): ITabCaptureTrackProof[] => {
          const stopped: MediaStreamTrack[] = Reflect.get(window, "nativeCaptureStoppedTracks");
          const surfaces: (string | undefined)[] = Reflect.get(window, "nativeCaptureSurfaces");
          return stopped.map((track, index) => ({
            state: track.readyState,
            surface: surfaces[index],
            kind: track.kind,
          }));
        });
        assert.deepEqual(errors, []);
        assert.equal(image.width, 1280);
        assert.equal(image.height, 800);
        for (const [actual, expected] of [
          [image.shape, image.expectedShape],
          [image.host, image.expectedHost],
          [image.panel, options.isChatAnnotated ? image.expectedPanel : image.expectedPage],
          [image.dock, image.expectedPage],
          [image.layer, image.expectedLayer],
          [image.tools, image.expectedPage],
          [
            image.tooltip,
            options.isChatAnnotated && image.isTooltipOverPanel ? image.expectedPanel : image.expectedPage,
          ],
        ]) {
          assert(actual && expected);
          for (const index of [0, 1, 2])
            assert(Math.abs((actual[index] ?? -255) - (expected[index] ?? 255)) < 40, JSON.stringify(image));
        }
        assert.deepEqual(tracks, [
          { state: "ended", surface: "browser", kind: "video" },
          { state: "ended", surface: "browser", kind: "video" },
        ]);
        if (options.topLayer) {
          assert.equal(
            await page
              .locator(`#capture-${options.topLayer}`)
              .evaluate((element) => element.matches(":modal, :popover-open")),
            true,
          );
        }
        assert.equal(
          await page.getByTestId("AgentChatPanel").evaluate((element) => getComputedStyle(element).visibility),
          "visible",
        );
        return {
          image,
          tracks,
          pngSha256: new Bun.CryptoHasher("sha256")
            .update(Buffer.from(dataURL.split(",")[1] ?? "", "base64"))
            .digest("hex"),
        };
      } finally {
        await browser.close();
      }
    } finally {
      await fixture.server.stop(true);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
