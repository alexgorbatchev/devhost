import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page, Request } from "playwright";
import { createCaptionRecording } from "./createCaptionRecording";
import type { BrowserScene, DemoRuntime, RecordedSourceClip } from "./types";

export async function recordBrowserScene(
  page: Page,
  scene: BrowserScene,
  runtime: DemoRuntime,
  signal: AbortSignal,
): Promise<RecordedSourceClip[]> {
  let clips: RecordedSourceClip[] = [];
  const errors: string[] = [];
  const navigations: string[] = [];
  const onPageError = (error: Error): void => {
    errors.push(error.message);
  };
  const onRequest = (request: Request): void => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
  };
  page.on("pageerror", onPageError);
  page.on("request", onRequest);
  try {
    const recording = await createCaptionRecording(page.screencast, runtime.directoryPath, scene.id, scene.caption);
    try {
      await scene.record(page, runtime, signal, recording.changeCaption);
    } finally {
      clips = await recording.stop();
    }
    assert.deepEqual(navigations, [], "A full-page navigation was included in the recording");
    assert.deepEqual(errors, [], "The recording page raised JavaScript errors");
    await page.screenshot({ path: join(runtime.directoryPath, `${scene.id}.png`) });
  } catch (error) {
    await page.screenshot({ path: join(runtime.directoryPath, `${scene.id}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    page.off("pageerror", onPageError);
    page.off("request", onRequest);
    await Bun.write(join(runtime.directoryPath, `${scene.id}-navigations.json`), JSON.stringify(navigations) + "\n");
  }
  return clips;
}
