import type { NativeReactElementHandle } from "./types";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Browser, BrowserContext, WebSocketRoute, JSHandle, CDPSession } from "playwright";
import { z } from "zod";
import { parseNativeBrowserUpdate } from "../../src/devtools/shared/nativeBrowser/parseNativeBrowserUpdate";
import { NativeReactInspector } from "./NativeReactInspector";
import { connectNativeReactControl, disconnectNativeReactControl } from "./exerciseNativeReactLifecycle";
import { readNativeReactBinding } from "./readNativeReactBinding";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import { activateNativeReactFixtureControl } from "./activateNativeReactFixtureControl";
import { forwardNativeReactFixtureStream } from "./forwardNativeReactFixtureStream";
import type { INativeReactAutomation, INativeReactProject } from "./types";

interface INativeReactPendingActionOptions {
  browser: Browser;
  context: BrowserContext;
  endpoint: string;
  extensionId: string;
  automation: INativeReactAutomation;
  project: INativeReactProject;
  outputPath: string;
}

interface INativeReactPendingFrame {
  direction: "page" | "server";
  payload: string;
}

const requestSchema = z.object({
  id: z.string(),
  command: z.enum(["connect", "open-react"]),
  binding: z.object({ instanceId: z.string(), documentId: z.string(), href: z.string() }),
});
const targetIdentitySchema = z.object({ targetInfo: z.object({ targetId: z.string() }) });

export async function exerciseNativeReactPendingAction(options: INativeReactPendingActionOptions): Promise<void> {
  const page = await options.context.newPage();
  const url = new URL(options.project.url);
  url.searchParams.set("owner", "fixture");
  url.searchParams.set("scenario", "pending-result");
  const socketUrl = new URL("/__devhost__/ws/native-browser", url);
  socketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const frames: INativeReactPendingFrame[] = [];
  const closures: unknown[] = [];
  const chronology: unknown[] = [];
  const exceptions: unknown[] = [];
  const executionContexts: unknown[] = [];
  const scripts: unknown[] = [];
  const socketEvents: unknown[] = [];
  const closeTasks: Promise<void>[] = [];
  const fixtureStreams: ReturnType<typeof forwardNativeReactFixtureStream>[] = [];
  const pageRoutes = new Map<string, WebSocketRoute>();
  let heldResult: string | null = null;
  let pendingId: string = "";
  let shouldHoldResult: boolean = false;
  let hasUpstreamClosed: boolean = false;
  let hasAttemptedLateDelivery: boolean = false;
  let originalDocument: JSHandle<Document> | null = null;
  let originalApp: NativeReactElementHandle | null = null;
  let hostSession: CDPSession | null = null;
  let continuity: unknown = null;
  let failure: unknown;
  try {
    hostSession = await page.context().newCDPSession(page);
    hostSession.on("Runtime.exceptionThrown", (event: unknown) => exceptions.push(event));
    hostSession.on("Runtime.executionContextCreated", (event: unknown) => executionContexts.push(event));
    hostSession.on("Debugger.scriptParsed", (event: unknown) => scripts.push(event));
    hostSession.on("Network.webSocketCreated", (event: unknown) => socketEvents.push({ type: "created", event }));
    hostSession.on("Network.webSocketFrameSent", (event: unknown) => socketEvents.push({ type: "sent", event }));
    hostSession.on("Network.webSocketFrameReceived", (event: unknown) =>
      socketEvents.push({ type: "received", event }),
    );
    hostSession.on("Network.webSocketClosed", (event: unknown) => socketEvents.push({ type: "closed", event }));
    hostSession.on("Network.webSocketFrameError", (event: unknown) => socketEvents.push({ type: "error", event }));
    await hostSession.send("Runtime.enable");
    await hostSession.send("Debugger.enable");
    await hostSession.send("Network.enable");
    // Exact existing streams remain connected to real Go with original
    // frames. Explicit public close forwarding avoids the installed router's
    // unmatched passthrough race during the real StrictMode effect cleanup.
    for (const pathname of ["/__devhost__/ws/health", "/__devhost__/ws/logs"]) {
      const streamUrl = new URL(socketUrl);
      streamUrl.pathname = pathname;
      await page.routeWebSocket(streamUrl.href, (route) => {
        fixtureStreams.push(forwardNativeReactFixtureStream(route, closeTasks));
      });
    }
    // This owning Page and its frames use Playwright's documented constructor
    // instrumentation. The separate compiled acceptance pages remain unrouted.
    await page.routeWebSocket(socketUrl.href, (route) => {
      assert.equal(pageRoutes.size, 0, "Pending-result fixture created more than one control socket.");
      pageRoutes.set(route.url(), route);
      const server = route.connectToServer();
      route.onMessage((message) => {
        assert.equal(typeof message, "string");
        const payload = String(message);
        const request = requestSchema.parse(JSON.parse(payload));
        frames.push({ direction: "page", payload });
        chronology.push({ operation: "page-frame-forward", id: request.id, recordedAt: new Date().toISOString() });
        if (shouldHoldResult && request.command === "open-react") {
          assert.equal(pendingId, "");
          pendingId = request.id;
        }
        // Original URL, Origin and constructor subprotocol reach real Go;
        // forward each original frame without replacing its bytes.
        server.send(message);
      });
      server.onMessage((message) => {
        assert.equal(typeof message, "string");
        const payload = String(message);
        const update = parseNativeBrowserUpdate(JSON.parse(payload));
        assert(update, "Actual Go emitted an invalid native-control update.");
        frames.push({ direction: "server", payload });
        chronology.push({ operation: "server-frame-received", id: update.id, recordedAt: new Date().toISOString() });
        if (shouldHoldResult && update.id === pendingId && pendingId.length > 0) {
          assert.equal(heldResult, null);
          assert.equal(update.type, "state");
          assert(update.type === "state");
          assert.equal(update.state.documentState, "bound");
          assert.equal(update.state.isReactAvailable, true);
          assert.equal(update.state.isNativeWindowOpen, true);
          assert.equal(update.error, undefined);
          heldResult = payload;
          chronology.push({ operation: "correlated-result-held", id: update.id, recordedAt: new Date().toISOString() });
          return;
        }
        chronology.push({ operation: "server-frame-forward", id: update.id, recordedAt: new Date().toISOString() });
        route.send(message);
      });
      // onClose replaces forwarding on this side. Preserve it explicitly and
      // observe the real upstream close rather than trusting close()'s return.
      server.onClose((code, reason) => {
        hasUpstreamClosed = true;
        closures.push({ code, reason });
        chronology.push({ operation: "upstream-close", code, reason, recordedAt: new Date().toISOString() });
        closeTasks.push(route.close({ code, reason }));
      });
    });
    await page.goto(url.href);
    await connectNativeReactControl(page);
    const binding = await readNativeReactBinding(page);
    originalDocument = await page.evaluateHandle(() => document);
    originalApp = await page.getByTestId("DevtoolsTopLayer").elementHandle();
    assert(originalApp);
    const initialTarget: unknown = await hostSession.send("Target.getTargetInfo");
    const originalTargetId = targetIdentitySchema.parse(initialTarget).targetInfo.targetId;
    await page.getByRole("button", { name: "React DevTools", exact: true }).click();
    const inspector = new NativeReactInspector({
      browser: options.browser,
      host: page,
      endpoint: options.endpoint,
      extensionId: options.extensionId,
      automation: options.automation,
      projectName: options.project.name,
    });
    await inspector.assertComponents(0);
    await inspector.startRecording();
    shouldHoldResult = true;
    const opener = page.getByRole("button", { name: "React DevTools", exact: true });
    await opener.click();
    await waitForNativeReactCondition(
      "genuine Go Open result held before client delivery",
      async () => heldResult !== null,
    );
    assert.equal(await opener.isDisabled(), true, "Actual client must still await the correlated Open result.");
    const command = page.getByRole("button", { name: "Disconnect browser control", exact: true });
    assert.equal(await command.isEnabled(), true);
    await disconnectNativeReactControl(page);
    chronology.push({ operation: "client-disconnected", recordedAt: new Date().toISOString() });
    await waitForNativeReactCondition("actual pending-result upstream socket closed", async () => hasUpstreamClosed);
    assert(heldResult !== null);
    const pageRoute = pageRoutes.get(socketUrl.href);
    assert(pageRoute);
    // Attempt only the unchanged real result after client cancellation. The
    // public router swallows closed-channel send errors: this is not a claim
    // of delivery. Actual DOM, frames and the real server close prove cleanup.
    chronology.push({ operation: "closed-side-late-result-attempt", recordedAt: new Date().toISOString() });
    pageRoute.send(heldResult);
    hasAttemptedLateDelivery = true;
    await activateNativeReactFixtureControl(
      page,
      `Increment host ${options.project.name}`,
      options.outputPath,
      "pending result host increment",
    );
    await page.waitForFunction(() => document.querySelector('output[aria-label="Host count"]')?.textContent === "1");
    await inspector.assertWindowPreserved();
    await inspector.assertComponents(1);
    await inspector.finishRecording(1);
    assert.equal(
      await page.getByRole("status").filter({ hasText: "Browser control is disconnected." }).textContent(),
      "Browser control is disconnected.",
    );
    assert.equal(await page.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
    const requests = frames
      .filter((frame) => frame.direction === "page")
      .map((frame) => requestSchema.parse(JSON.parse(frame.payload)));
    assert.deepEqual(
      requests.map((request) => request.command),
      ["connect", "open-react", "open-react"],
    );
    for (const request of requests) assert.deepEqual(request.binding, binding);
    assert.equal(closures.length, 1);
    const hasOriginalDocument = await originalDocument.evaluate((value) => value === document);
    const app = await originalApp.evaluate((element) => ({
      hasOriginalRoot:
        element.isConnected &&
        element ===
          document
            .getElementById("devhost-devtools-host")
            ?.shadowRoot?.querySelector('[data-testid="DevtoolsTopLayer"]'),
      instanceId: element.getAttribute("data-devhost-native-instance"),
      documentId: element.getAttribute("data-devhost-native-document"),
    }));
    const finalTarget: unknown = await hostSession.send("Target.getTargetInfo");
    const targetId = targetIdentitySchema.parse(finalTarget).targetInfo.targetId;
    assert.equal(hasOriginalDocument, true);
    assert.equal(app.hasOriginalRoot, true);
    assert.equal(app.instanceId, null, "Disconnect clears the active instance binding.");
    assert.equal(app.documentId, null, "Disconnect clears the active document binding.");
    assert.equal(page.url(), binding.href);
    assert.equal(targetId, originalTargetId);
    continuity = { hasOriginalDocument, app, originalTargetId, targetId, href: page.url(), originalBinding: binding };
  } catch (error) {
    failure = error;
    const snapshots = await Promise.allSettled([
      page.locator("body").ariaSnapshot(),
      page.getByTestId("DevtoolsTopLayer").ariaSnapshot(),
      page.getByRole("button", { name: "Connect browser control", exact: true }).isVisible(),
      page.getByRole("button", { name: "Native browser connection", exact: true }).isVisible(),
    ]);
    await Bun.write(
      resolve(options.outputPath, "pending-failure-page-snapshots.json"),
      JSON.stringify({ url: page.url(), snapshots }, null, 2),
    );
  } finally {
    const streamCleanup = await Promise.allSettled(fixtureStreams.map((stream) => stream.close()));
    const streamJoin = await Promise.allSettled([
      waitForNativeReactCondition("real owning Page ancillary streams closed", async () =>
        fixtureStreams.every((stream) => stream.hasServerClosed),
      ),
    ]);
    await Bun.write(
      resolve(options.outputPath, "pending-fixture-streams.json"),
      JSON.stringify({ fixtureStreams, streamCleanup, streamJoin }, null, 2),
    );
    await Bun.write(
      resolve(options.outputPath, "pending-runtime-diagnostics.json"),
      JSON.stringify({ exceptions, executionContexts, scripts, socketEvents }, null, 2),
    );
    // There is no public WebSocket unroute API in installed Playwright 1.59.1.
    // Disposing only this Page releases its route and genuine App document.
    const handleCleanup = await Promise.allSettled([
      originalDocument?.dispose(),
      originalApp?.dispose(),
      hostSession?.detach(),
    ]);
    const cleanup = await Promise.allSettled([page.close(), ...closeTasks]);
    await Bun.write(
      resolve(options.outputPath, "pending-native-result.json"),
      JSON.stringify(
        {
          url: url.href,
          socketUrl: socketUrl.href,
          frames,
          chronology,
          closures,
          pendingId,
          heldResult,
          hasUpstreamClosed,
          hasAttemptedLateDelivery,
          hasPageClosed: page.isClosed(),
          continuity,
          handleCleanup,
          cleanup,
          boundary:
            "Instrumented client-pending-result cancellation; Go/CDP action already completed. Unrouted compiled acceptance is separate.",
        },
        null,
        2,
      ),
    );
    const cleanupErrors = [...streamCleanup, ...streamJoin, ...handleCleanup, ...cleanup]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (cleanupErrors.length > 0)
      failure = new AggregateError(
        failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
        "Pending-result Page cleanup failed.",
      );
  }
  if (failure !== undefined) throw failure;
}
