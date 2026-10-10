import { chromium, type Browser } from "playwright";
import { viewport } from "./constants";

export async function launchDemoBrowser(env: NodeJS.ProcessEnv, captureScale: number = 1): Promise<Browser> {
  return await chromium.launch({
    env,
    // The recorder owns these signals so its finally block can stop the stack and remove routes.
    handleSIGINT: false,
    handleSIGTERM: false,
    // The screencast records CSS pixels under an emulated device scale; only the window's own scale reaches it.
    args:
      captureScale === 1
        ? []
        : [`--force-device-scale-factor=${captureScale}`, `--window-size=${viewport.width},${viewport.height}`],
  });
}
