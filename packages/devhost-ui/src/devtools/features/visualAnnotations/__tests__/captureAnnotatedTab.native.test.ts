import { test } from "bun:test";
import { runTabCaptureAcceptance } from "../../../../../test-support/nativeTabCapture/runTabCaptureAcceptance";

test("sends the actual annotated browser tab PNG, hides devtools chrome, and stops the native track", async () => {
  console.log(JSON.stringify(await runTabCaptureAcceptance()));
}, 60_000);

test.each([false, true])(
  "sends selected devhost UI metadata and retains annotated chat in the PNG (already shared: %s)",
  async (isSharingAheadOfTime) => {
    console.log(JSON.stringify(await runTabCaptureAcceptance({ isChatAnnotated: true, isSharingAheadOfTime })));
  },
  60_000,
);

test("hides unannotated devhost UI when capturing a tab that was already shared", async () => {
  console.log(JSON.stringify(await runTabCaptureAcceptance({ isSharingAheadOfTime: true })));
}, 60_000);
