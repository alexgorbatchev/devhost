import { test } from "bun:test";
import { runTabCaptureAcceptance } from "../../../../../test-support/nativeTabCapture/runTabCaptureAcceptance";

test("sends the actual annotated browser tab PNG, hides devtools chrome, and stops the native track", async () => {
  console.log(JSON.stringify(await runTabCaptureAcceptance()));
}, 60_000);
