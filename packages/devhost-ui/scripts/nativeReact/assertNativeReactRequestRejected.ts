import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { INativeBrowserBinding } from "../../src/devtools/shared/nativeBrowser/types";

interface INativeReactRejectionOptions {
  page: Page;
  binding: INativeBrowserBinding;
  controlOrigin: string;
  label: string;
  outputPath: string;
}

export async function assertNativeReactRequestRejected(options: INativeReactRejectionOptions): Promise<void> {
  const outcome = await options.page.evaluate(
    async (input) => {
      const url = new URL("/__devhost__/ws/native-browser", input.controlOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url, "devhost-native-browser.v1");
      const messages: string[] = [];
      let hasBoundState: boolean = false;
      let hasClosed: boolean = false;
      try {
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(
            () => reject(new Error("Real rejected request did not close or return unbound state.")),
            10_000,
          );
          socket.addEventListener(
            "open",
            () => socket.send(JSON.stringify({ id: "native_rejected", command: "connect", binding: input.binding })),
            { once: true },
          );
          socket.addEventListener("message", (event) => {
            messages.push(String(event.data));
            const value: unknown = JSON.parse(String(event.data));
            if (
              typeof value === "object" &&
              value !== null &&
              "state" in value &&
              typeof value.state === "object" &&
              value.state !== null &&
              "documentState" in value.state
            ) {
              hasBoundState ||= value.state.documentState === "bound";
              clearTimeout(deadline);
              resolve();
            }
          });
          socket.addEventListener(
            "close",
            () => {
              hasClosed = true;
              clearTimeout(deadline);
              resolve();
            },
            { once: true },
          );
        });
      } finally {
        socket.close();
      }
      return { messages, hasBoundState, hasClosed };
    },
    { binding: options.binding, controlOrigin: options.controlOrigin },
  );
  await Bun.write(resolve(options.outputPath, `${options.label}.json`), JSON.stringify(outcome, null, 2));
  assert.equal(outcome.hasBoundState, false, "Rejected native request acquired an actual document.");
  assert(outcome.hasClosed || outcome.messages.length > 0, "No native rejection was observed.");
}
