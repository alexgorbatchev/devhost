import type { NativeReactElementHandle, NativeReactDispose } from "./types";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page, Request, Route, WebSocket } from "playwright";
import { z } from "zod";
import type { NativeReactInspector } from "./NativeReactInspector";
import type { INativeReactProject } from "./types";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import { assertNativeReactDockLayout } from "./assertNativeReactDockLayout";

interface INativeReactCommandOptions {
  host: Page;
  inspector: NativeReactInspector;
  project: INativeReactProject;
  outputPath: string;
}

interface INativeReactCommandCounts {
  configurationRequests: number;
  socketConnections: number;
  socketClosures: number;
  connectCommands: number;
  openCommands: number;
}

interface INativeReactTrustedInput {
  type: string;
  key: string | null;
  isTrusted: boolean;
}

interface INativeReactSentFrame {
  payload: string | Buffer;
}

interface INativeReactCommandStage {
  label: string;
  status: string;
  command: string;
  counts: INativeReactCommandCounts;
  geometry: Awaited<ReturnType<typeof assertNativeReactDockLayout>>;
}

interface INativeReactCommandEvidence {
  stages: INativeReactCommandStage[];
  inputs: INativeReactTrustedInput[];
  cancelledRequestFailure: string | null;
  errorSnapshot: string;
  clipboardText: string;
}

const commandSchema = z.object({ command: z.enum(["connect", "open-react"]) });

async function holdConfigurationRequest(page: Page, url: string) {
  let heldRequest: Request | null = null;
  const released = Promise.withResolvers<void>();
  const tasks: Promise<void>[] = [];
  const handler = (route: Route): Promise<void> => {
    const task = (async (): Promise<void> => {
      heldRequest = route.request();
      await released.promise;
      // Forward the original request unchanged. No response or native state is fabricated.
      await route.continue();
    })();
    tasks.push(task);
    return task;
  };
  await page.route(url, handler, { times: 1 });
  return {
    readRequest: (): Request | null => heldRequest,
    release: (): void => released.resolve(),
    dispose: async (): Promise<void> => {
      released.resolve();
      try {
        await Promise.all(tasks);
      } finally {
        await page.unroute(url, handler);
      }
    },
  };
}

async function assertOriginalFocusedCommand(
  page: Page,
  original: NativeReactElementHandle,
  name: string,
): Promise<void> {
  const command = page.getByRole("button", { name, exact: true });
  await command.waitFor();
  assert.equal(await command.evaluate((element, first) => element === first, original), true);
  assert.equal(
    await original.evaluate((element) => {
      const root = element.getRootNode();
      return (
        element instanceof HTMLButtonElement &&
        element.isConnected &&
        root instanceof ShadowRoot &&
        root.activeElement === element &&
        !element.disabled
      );
    }),
    true,
  );
  assert.equal(await command.getAttribute("aria-expanded"), null);
  assert.equal(await command.getAttribute("aria-pressed"), null);
  assert.equal(await command.getAttribute("aria-haspopup"), null);
  assert.equal(await command.getAttribute("popovertarget"), null);
}

export async function exerciseNativeReactCommands(
  options: INativeReactCommandOptions,
): Promise<INativeReactCommandEvidence> {
  const { host, inspector, project } = options;
  const configurationUrl = new URL("/__devhost__/config.json", host.url()).href;
  const requests: Request[] = [];
  const sockets: WebSocket[] = [];
  const closedSockets: WebSocket[] = [];
  const frames: string[] = [];
  const removeSocketListeners: NativeReactDispose[] = [];
  const onRequest = (request: Request): void => {
    requests.push(request);
  };
  const onSocket = (socket: WebSocket): void => {
    sockets.push(socket);
    const recordFrame = (event: INativeReactSentFrame): void => {
      frames.push(JSON.stringify({ url: socket.url(), payload: String(event.payload) }));
    };
    const recordClose = (): void => {
      closedSockets.push(socket);
    };
    socket.on("framesent", recordFrame);
    socket.on("close", recordClose);
    removeSocketListeners.push((): void => {
      socket.off("framesent", recordFrame);
      socket.off("close", recordClose);
    });
  };
  const command = host.getByRole("button", { name: "Disconnect browser control", exact: true });
  await command.waitFor();
  const original = await command.elementHandle();
  assert(original);
  const inputObserver = await original.evaluateHandle((element) => {
    const inputs: INativeReactTrustedInput[] = [];
    const record = (event: Event): void => {
      inputs.push({
        type: event.type,
        key: event instanceof KeyboardEvent ? event.key : null,
        isTrusted: event.isTrusted,
      });
    };
    const events: string[] = ["keydown", "keyup", "click", "pointerdown", "pointerup"];
    for (const event of events) element.addEventListener(event, record);
    return {
      inputs,
      dispose: (): void => {
        for (const event of events) element.removeEventListener(event, record);
      },
    };
  });
  const gates: Awaited<ReturnType<typeof holdConfigurationRequest>>[] = [];
  const stages: INativeReactCommandStage[] = [];
  const frameSchema = z.object({ url: z.string(), payload: z.string() });
  const counts = (): INativeReactCommandCounts => {
    const nativeFrames = frames
      .map((frame) => frameSchema.parse(JSON.parse(frame)))
      .filter((frame) => new URL(frame.url).pathname === "/__devhost__/ws/native-browser")
      .map((frame) => commandSchema.parse(JSON.parse(frame.payload)));
    return {
      configurationRequests: requests.filter((request) => request.url() === configurationUrl).length,
      socketConnections: sockets.filter((socket) => new URL(socket.url()).pathname === "/__devhost__/ws/native-browser")
        .length,
      socketClosures: closedSockets.filter(
        (socket) => new URL(socket.url()).pathname === "/__devhost__/ws/native-browser",
      ).length,
      connectCommands: nativeFrames.filter((frame) => frame.command === "connect").length,
      openCommands: nativeFrames.filter((frame) => frame.command === "open-react").length,
    };
  };
  const assertStage = async (
    label: string,
    status: string,
    name: string,
    expected: INativeReactCommandCounts,
  ): Promise<void> => {
    const statusNode = host.getByRole("status").filter({ hasText: status });
    await statusNode.waitFor();
    assert.equal(await statusNode.textContent(), status);
    await assertOriginalFocusedCommand(host, original, name);
    assert.deepEqual(counts(), expected);
    const beforeEscape = counts();
    const readout = host.getByRole("region", { name: "Native browser control status", exact: true });
    const beforeReadout = await readout.textContent();
    const beforePopovers = await host.locator("[popover]:popover-open").count();
    await host.keyboard.press("Escape");
    await assertOriginalFocusedCommand(host, original, name);
    assert.equal(await statusNode.textContent(), status);
    assert.deepEqual(counts(), beforeEscape);
    assert.equal(await readout.textContent(), beforeReadout);
    assert.equal(await host.locator("[popover]:popover-open").count(), beforePopovers);
    await inspector.assertWindowPreserved();
    const geometry = await assertNativeReactDockLayout(host);
    stages.push({ label, status, command: name, counts: counts(), geometry });
    await Bun.write(resolve(options.outputPath, "direct-command-stages.json"), JSON.stringify(stages, null, 2));
  };
  host.on("request", onRequest);
  host.on("websocket", onSocket);
  const initialViewport =
    host.viewportSize() ?? (await host.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  try {
    await host.setViewportSize({ width: 360, height: 480 });
    // One initial focus placement is test setup. No transition or completion repairs focus.
    await command.focus();
    const initialCounts: INativeReactCommandCounts = {
      configurationRequests: 0,
      socketConnections: 0,
      socketClosures: 0,
      connectCommands: 0,
      openCommands: 0,
    };
    await assertStage(
      "initial connected",
      "Browser control is connected.",
      "Disconnect browser control",
      initialCounts,
    );
    await host.keyboard.press("Space");
    await assertStage("Space disconnect", "Browser control is disconnected.", "Connect browser control", initialCounts);

    const successfulGate = await holdConfigurationRequest(host, configurationUrl);
    gates.push(successfulGate);
    await host.keyboard.press("Enter");
    await waitForNativeReactCondition(
      "real successful configuration request held",
      async () => successfulGate.readRequest() !== null,
    );
    const connectingCounts: INativeReactCommandCounts = {
      configurationRequests: 1,
      socketConnections: 0,
      socketClosures: 0,
      connectCommands: 0,
      openCommands: 0,
    };
    await assertStage(
      "Enter connecting",
      "Connecting to the configured browser…",
      "Disconnect browser control",
      connectingCounts,
    );
    successfulGate.release();
    await successfulGate.dispose();
    const connectedCounts: INativeReactCommandCounts = {
      configurationRequests: 1,
      socketConnections: 1,
      socketClosures: 0,
      connectCommands: 1,
      openCommands: 0,
    };
    await assertStage(
      "Enter connected",
      "Browser control is connected.",
      "Disconnect browser control",
      connectedCounts,
    );
    const firstSocket = sockets.find((socket) => new URL(socket.url()).pathname === "/__devhost__/ws/native-browser");
    assert(firstSocket);
    const firstSocketClosed = firstSocket.waitForEvent("close");
    await host.getByRole("button", { name: "Disconnect browser control", exact: true }).click();
    await firstSocketClosed;
    const disconnectedCounts: INativeReactCommandCounts = { ...connectedCounts, socketClosures: 1 };
    await assertStage(
      "pointer disconnect",
      "Browser control is disconnected.",
      "Connect browser control",
      disconnectedCounts,
    );

    const cancelledGate = await holdConfigurationRequest(host, configurationUrl);
    gates.push(cancelledGate);
    await host.keyboard.press("Space");
    await waitForNativeReactCondition(
      "real cancelled configuration request held",
      async () => cancelledGate.readRequest() !== null,
    );
    const cancelledRequest = cancelledGate.readRequest();
    assert(cancelledRequest);
    const cancellationCounts: INativeReactCommandCounts = { ...disconnectedCounts, configurationRequests: 2 };
    await assertStage(
      "Space connecting",
      "Connecting to the configured browser…",
      "Disconnect browser control",
      cancellationCounts,
    );
    const requestFailed = host.waitForEvent("requestfailed", { predicate: (request) => request === cancelledRequest });
    await host.keyboard.press("Enter");
    await assertStage(
      "Enter cancels connecting",
      "Browser control is disconnected.",
      "Connect browser control",
      cancellationCounts,
    );
    cancelledGate.release();
    await cancelledGate.dispose();
    await requestFailed;
    assert(cancelledRequest.failure());
    assert.deepEqual(counts(), {
      configurationRequests: 2,
      socketConnections: 1,
      socketClosures: 1,
      connectCommands: 1,
      openCommands: 0,
    });
    await assertStage(
      "cancelled request joined",
      "Browser control is disconnected.",
      "Connect browser control",
      cancellationCounts,
    );

    await project.stop();
    await host.getByRole("button", { name: "Connect browser control", exact: true }).click();
    await host.getByRole("alert").waitFor();
    const errorCounts: INativeReactCommandCounts = { ...cancellationCounts, configurationRequests: 3 };
    await assertStage(
      "real stopped-project error",
      "Browser control is disconnected.",
      "Connect browser control",
      errorCounts,
    );
    const errorSnapshot = await host.locator("body").ariaSnapshot();
    const errorText = await host.getByRole("alert").locator('[data-slot="alert-description"]').textContent();
    assert(errorText);
    await host
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(host.url()).origin });
    await host.keyboard.press("Tab");
    const copy = host.getByRole("button", { name: "Copy to clipboard", exact: true });
    assert.equal(
      await copy.evaluate((element) => {
        const root = element.getRootNode();
        return root instanceof ShadowRoot && root.activeElement === element;
      }),
      true,
    );
    await host.keyboard.press("Enter");
    await host.getByRole("button", { name: "Copied", exact: true }).waitFor();
    const clipboardText = await host.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboardText, errorText.trim());
    await host.keyboard.press("Shift+Tab");
    await assertOriginalFocusedCommand(host, original, "Connect browser control");
    await project.start();
    await host.keyboard.press("Enter");
    const recoveryCounts: INativeReactCommandCounts = {
      configurationRequests: 4,
      socketConnections: 2,
      socketClosures: 1,
      connectCommands: 2,
      openCommands: 0,
    };
    await assertStage(
      "Enter real recovery",
      "Browser control is connected.",
      "Disconnect browser control",
      recoveryCounts,
    );
    await host.getByRole("button", { name: "React DevTools", exact: true }).waitFor();
    assert.deepEqual(counts(), {
      configurationRequests: 4,
      socketConnections: 2,
      socketClosures: 1,
      connectCommands: 2,
      openCommands: 0,
    });
    const inputs = await inputObserver.evaluate((observer) => observer.inputs);
    assert.equal(
      inputs.every((input) => input.isTrusted),
      true,
    );
    assert.equal(inputs.filter((input) => input.type === "click").length, 7);
    assert.equal(inputs.filter((input) => input.type === "keydown" && input.key === "Enter").length, 3);
    assert.equal(inputs.filter((input) => input.type === "keydown" && input.key === " ").length, 2);
    assert.equal(inputs.filter((input) => input.type === "pointerdown").length, 2);
    assert.equal(inputs.filter((input) => input.type === "keydown" && input.key === "Escape").length, stages.length);
    const evidence: INativeReactCommandEvidence = {
      stages,
      inputs,
      cancelledRequestFailure: cancelledRequest.failure()?.errorText ?? null,
      errorSnapshot,
      clipboardText,
    };
    await Bun.write(resolve(options.outputPath, "direct-command-assertions.json"), JSON.stringify(evidence, null, 2));
    return evidence;
  } finally {
    for (const gate of gates) gate.release();
    await host.setViewportSize(initialViewport);
    try {
      await Promise.all(gates.map((gate) => gate.dispose()));
    } finally {
      host.off("request", onRequest);
      host.off("websocket", onSocket);
      for (const remove of removeSocketListeners) remove();
      try {
        await inputObserver.evaluate((observer) => observer.dispose());
      } finally {
        await inputObserver.dispose();
        await original.dispose();
        await Bun.write(
          resolve(options.outputPath, "direct-command-transport.json"),
          JSON.stringify(
            {
              frames,
              requests: requests.map((request) => ({ url: request.url(), failure: request.failure() })),
              counts: counts(),
            },
            null,
            2,
          ),
        );
      }
    }
  }
}
