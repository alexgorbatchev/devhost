import { chromium, type Browser } from "playwright";
import { viewport } from "./constants";

export async function launchDemoBrowser(
  env: NodeJS.ProcessEnv,
  captureScale: number = 1,
  hasGpu: boolean = true,
): Promise<Browser> {
  return await chromium.launch({
    env,
    headless: env.DEVHOST_DEMO_INTERACTIVE !== "1",
    // The recorder owns these signals so its finally block can stop the stack and remove routes.
    handleSIGINT: false,
    handleSIGTERM: false,
    args: [
      // On a display without a GPU, such as Xvfb, Chromium's first GPU process fails to start and is replaced by a
      // software one; a screenshot requested before that, which can take many seconds on a cold machine, fails.
      ...(hasGpu ? [] : ["--disable-gpu"]),
      // The screencast records CSS pixels under an emulated device scale; only the window's own scale reaches it.
      ...(captureScale === 1
        ? []
        : [`--force-device-scale-factor=${captureScale}`, `--window-size=${viewport.width},${viewport.height}`]),
    ],
  });
}
