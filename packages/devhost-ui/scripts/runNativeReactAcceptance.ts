import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import type { Server } from "bun";
import { readNativeReactProvisioning } from "./nativeReact/readNativeReactProvisioning";
import { prepareNativeReactAssets } from "./nativeReact/prepareNativeReactAssets";
import { buildNativeReactFixture } from "./nativeReact/buildNativeReactFixture";
import { serveNativeReactFixture } from "./nativeReact/serveNativeReactFixture";
import { startNativeReactBrowser } from "./nativeReact/startNativeReactBrowser";
import { startNativeReactStack } from "./nativeReact/startNativeReactStack";
import { createNativeReactAutomation } from "./nativeReact/createNativeReactAutomation";
import { NativeReactInspector } from "./nativeReact/NativeReactInspector";
import {
  connectNativeReactControl,
  disconnectNativeReactControl,
  exerciseNativeReactLifecycle,
} from "./nativeReact/exerciseNativeReactLifecycle";
import { readNativeReactBinding } from "./nativeReact/readNativeReactBinding";
import { assertNativeReactRequestRejected } from "./nativeReact/assertNativeReactRequestRejected";
import { exerciseNativeReactLoss } from "./nativeReact/exerciseNativeReactLoss";
import { exerciseNativeReactPendingAction } from "./nativeReact/exerciseNativeReactPendingAction";
import { removeNativeReactAssets } from "./nativeReact/removeNativeReactAssets";
import { assertNativeReactDockLayout } from "./nativeReact/assertNativeReactDockLayout";
import { activateNativeReactFixtureControl } from "./nativeReact/activateNativeReactFixtureControl";
import { assertNativeReactCompiledAssets } from "./nativeReact/assertNativeReactCompiledAssets";
import type { INativeReactAutomation, INativeReactBrowser, INativeReactStack } from "./nativeReact/types";

export async function runNativeReactAcceptance(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dir, "../../..");
  assert.equal(process.cwd(), repositoryRoot, "Run native acceptance from the repository root.");
  const provisioning = await readNativeReactProvisioning(Bun.env.DEVHOST_NATIVE_REACT_ASSETS);
  const outputPath = resolve(repositoryRoot, ".tmp/native-react-acceptance", crypto.randomUUID());
  await mkdir(outputPath, { recursive: true });
  console.log(`Native React acceptance evidence: ${outputPath}`);
  const assetsPath = resolve(outputPath, "assets");
  let fixture: Server<undefined> | null = null;
  let siblingFixture: Server<undefined> | null = null;
  const runtimeErrors: string[] = [];
  const runtimeErrorDetails: unknown[] = [];
  const responses: unknown[] = [];
  const controlFrames: unknown[] = [];
  const fixtureConfigurations: unknown[] = [];
  let ownedBrowser: INativeReactBrowser | null = null;
  let automation: INativeReactAutomation | null = null;
  let browser: Browser | null = null;
  let stack: INativeReactStack | null = null;
  let failure: unknown;
  try {
    const assets = await prepareNativeReactAssets(provisioning, assetsPath);
    await Bun.write(
      resolve(outputPath, "provisioning-proof.json"),
      await Bun.file(resolve(assetsPath, "provisioning-proof.json")).bytes(),
    );
    await buildNativeReactFixture(resolve(outputPath, "fixture"), repositoryRoot);
    fixture = serveNativeReactFixture(resolve(outputPath, "fixture"));
    siblingFixture = serveNativeReactFixture(resolve(outputPath, "fixture"));
    ownedBrowser = await startNativeReactBrowser({ ...assets, outputPath, repositoryRoot });
    browser = await chromium.connectOverCDP(ownedBrowser.endpoint);
    const context = browser.contexts()[0];
    assert(context);
    context.on("page", (page) => {
      page.on("websocket", (socket) => {
        if (socket.url().includes("/__devhost__/ws/native-browser"))
          socket.on("framereceived", (event) =>
            controlFrames.push({ url: page.url(), payload: String(event.payload) }),
          );
      });
      page.on("console", (message) => {
        if (message.type() === "info" && message.text().startsWith("Native fixture external toolbar configuration "))
          fixtureConfigurations.push({ url: page.url(), message: message.text() });
      });
      page.on("pageerror", (error) => {
        runtimeErrors.push(`${page.url()}: ${error.message}`);
        runtimeErrorDetails.push({ url: page.url(), message: error.message, stack: error.stack });
      });
      page.on("response", (response) => {
        if (response.url().includes("/__devhost__/"))
          responses.push({ url: response.url(), status: response.status(), headers: response.headers() });
      });
    });
    automation = createNativeReactAutomation(ownedBrowser.endpoint, outputPath, repositoryRoot);
    assert(fixture.port && siblingFixture.port);
    assert.notEqual(fixture.port, siblingFixture.port);
    stack = await startNativeReactStack({
      provisioning,
      outputPath,
      fixturePorts: { A: fixture.port, B: siblingFixture.port },
      browserEndpoint: ownedBrowser.endpoint,
      extensionId: ownedBrowser.extensionId,
    });
    const first = stack.projects[0];
    const second = stack.projects[1];
    assert(first && second);
    const host = await context.newPage();
    const sibling = await context.newPage();
    await host.emulateMedia({ colorScheme: "light" });
    await sibling.emulateMedia({ colorScheme: "dark" });
    await host.goto(`${first.url}&owner=fixture`);
    await sibling.goto(second.aliasUrl);
    await connectNativeReactControl(sibling);
    await sibling.getByRole("button", { name: "React DevTools", exact: true }).click();
    const siblingInspector = new NativeReactInspector({
      browser,
      host: sibling,
      endpoint: ownedBrowser.endpoint,
      extensionId: ownedBrowser.extensionId,
      automation,
      projectName: "B",
    });
    await siblingInspector.assertWindowPreserved();
    await siblingInspector.assertComponents(0);
    await sibling.setViewportSize({ width: 360, height: 480 });
    await Bun.write(
      resolve(outputPath, "sibling-dock-layout.json"),
      JSON.stringify(await assertNativeReactDockLayout(sibling), null, 2),
    );
    await connectNativeReactControl(host);
    const oldBinding = await readNativeReactBinding(host);
    const siblingBinding = await readNativeReactBinding(sibling);
    assert.notEqual(oldBinding.instanceId, siblingBinding.instanceId);
    await assertNativeReactRequestRejected({
      page: host,
      binding: siblingBinding,
      controlOrigin: new URL(first.url).origin,
      label: "foreign-instance-rejected",
      outputPath,
    });
    await assertNativeReactRequestRejected({
      page: host,
      binding: oldBinding,
      controlOrigin: new URL(second.aliasUrl).origin,
      label: "actual-foreign-Origin-rejected",
      outputPath,
    });
    const unrelated = await context.newPage();
    await unrelated.goto(`http://127.0.0.1:${fixture.port}/unrelated`);
    assert.equal(await unrelated.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
    await assertNativeReactRequestRejected({
      page: unrelated,
      binding: oldBinding,
      controlOrigin: new URL(first.url).origin,
      label: "actual-unrelated-Origin-rejected",
      outputPath,
    });
    const inspector = new NativeReactInspector({
      browser,
      host,
      endpoint: ownedBrowser.endpoint,
      extensionId: ownedBrowser.extensionId,
      automation,
      projectName: "A",
    });
    await exerciseNativeReactLifecycle({ host, inspector, project: first, outputPath, sibling, siblingInspector });
    await assertNativeReactRequestRejected({
      page: host,
      binding: oldBinding,
      controlOrigin: new URL(first.url).origin,
      label: "actual-stale-instance-document-rejected",
      outputPath,
    });
    // This page has no reserved initial App container: actual compiled Go
    // injection creates and owns the toolbar and its complete asset graph.
    const shipped = await context.newPage();
    await shipped.goto(first.aliasUrl);
    await connectNativeReactControl(shipped);
    const firstShippedBinding = await readNativeReactBinding(shipped);
    const duplicate = await context.newPage();
    await duplicate.goto(first.aliasUrl);
    await connectNativeReactControl(duplicate);
    const duplicateBinding = await readNativeReactBinding(duplicate);
    assert.equal(firstShippedBinding.instanceId, duplicateBinding.instanceId);
    assert.notEqual(firstShippedBinding.documentId, duplicateBinding.documentId);
    await shipped.getByRole("button", { name: "React DevTools", exact: true }).click();
    const shippedInspector = new NativeReactInspector({
      browser,
      host: shipped,
      endpoint: ownedBrowser.endpoint,
      extensionId: ownedBrowser.extensionId,
      automation,
      projectName: "A",
    });
    await shippedInspector.assertComponents(0);
    await shippedInspector.startRecording();
    await activateNativeReactFixtureControl(shipped, "Increment host A", outputPath, "compiled host increment 1");
    await shippedInspector.assertComponents(1);
    await shippedInspector.finishRecording(1);
    await disconnectNativeReactControl(duplicate);
    await activateNativeReactFixtureControl(shipped, "Increment host A", outputPath, "compiled host increment 2");
    await shippedInspector.assertComponents(2);
    await shipped.goto(`${first.aliasUrl}&host=none`);
    const oldShippedBinding = firstShippedBinding;
    await shipped.getByRole("button", { name: "Connect browser control", exact: true }).click();
    await shipped.getByRole("status").filter({ hasText: "Browser control is connected." }).waitFor();
    assert.equal(await shipped.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
    await assertNativeReactRequestRejected({
      page: shipped,
      binding: oldShippedBinding,
      controlOrigin: new URL(first.aliasUrl).origin,
      label: "actual-navigation-document-rejected",
      outputPath,
    });
    // This per-request setting matches the owned Chrome TLS fixture: its
    // real Caddy CA is intentionally not installed into the user's trust.
    const config = await shipped.request.get(new URL("/__devhost__/config.json", first.aliasUrl).href, {
      ignoreHTTPSErrors: true,
    });
    try {
      assert.equal(config.status(), 200);
      assert.equal(config.headers()["cache-control"], "no-store");
      assert.equal((await config.text()).includes(ownedBrowser.endpoint), false);
      await Bun.write(
        resolve(outputPath, "compiled-config-response.json"),
        JSON.stringify({ url: config.url(), status: config.status(), headers: config.headers() }, null, 2),
      );
    } finally {
      await config.dispose();
    }
    await assertNativeReactCompiledAssets(shipped, repositoryRoot, outputPath);
    await exerciseNativeReactPendingAction({
      browser,
      context,
      endpoint: ownedBrowser.endpoint,
      extensionId: ownedBrowser.extensionId,
      automation,
      project: first,
      outputPath,
    });
    await exerciseNativeReactLoss({ host, inspector, outputPath });
    assert.deepEqual(runtimeErrors, []);
    await Bun.write(
      resolve(outputPath, "acceptance-result.json"),
      JSON.stringify(
        {
          urls: [host.url(), sibling.url(), duplicate.url(), shipped.url()],
          firstShippedBinding,
          duplicateBinding,
          extensionId: ownedBrowser.extensionId,
          hasCompiledInjectionAcceptance: true,
          hasNativeComponentsAndProfiler: true,
          provisioning,
        },
        null,
        2,
      ),
    );
    console.log("Native React acceptance passed.");
  } catch (error) {
    failure = error;
    if (browser !== null) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      const snapshots = await Promise.allSettled(
        pages.map(async (page) => ({
          url: page.url(),
          snapshot: await page.locator("body").ariaSnapshot(),
          markers: await page
            .locator("[data-devhost-devtools]")
            .evaluateAll((elements) =>
              elements.map((element) => ({ html: element.outerHTML, shadow: element.shadowRoot?.innerHTML })),
            ),
        })),
      );
      await Bun.write(resolve(outputPath, "failure-page-snapshots.json"), JSON.stringify(snapshots, null, 2));
    }
    await Bun.write(
      resolve(outputPath, "failure.log"),
      error instanceof Error ? `${error.stack}\n` : `${String(error)}\n`,
    );
  } finally {
    await Bun.write(resolve(outputPath, "control-frames.json"), JSON.stringify(controlFrames, null, 2));
    await Bun.write(
      resolve(outputPath, "fixture-configuration-ownership.json"),
      JSON.stringify(fixtureConfigurations, null, 2),
    );
    await Bun.write(resolve(outputPath, "runtime-errors.json"), JSON.stringify(runtimeErrors, null, 2));
    await Bun.write(resolve(outputPath, "runtime-error-details.json"), JSON.stringify(runtimeErrorDetails, null, 2));
    await Bun.write(resolve(outputPath, "asset-responses.json"), JSON.stringify(responses, null, 2));
    const cleanup = await Promise.allSettled([automation?.stop(), stack?.stop()]);
    // Playwright only connects to this run's fresh owned browser. Production
    // disconnect/Stop assertions above never close a browser-owned target.
    // Snapshot/join Chrome's owned child processes before disconnecting the
    // Playwright object, so native crashpad ownership is observed while live.
    const browserCleanup = await Promise.allSettled([ownedBrowser?.stop()]);
    const finalCleanup = await Promise.allSettled([browser?.close(), fixture?.stop(true), siblingFixture?.stop(true)]);
    await Bun.write(
      resolve(outputPath, "cleanup.json"),
      JSON.stringify(
        { cleanup, browserCleanup, finalCleanup, fixturePorts: [fixture?.port, siblingFixture?.port] },
        null,
        2,
      ),
    );
    const cleanupErrors = [...cleanup, ...browserCleanup, ...finalCleanup]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (cleanupErrors.length > 0)
      failure = new AggregateError(
        failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
        "Native acceptance resource cleanup failed.",
      );
    else await removeNativeReactAssets(assetsPath, outputPath);
  }
  if (failure !== undefined) throw failure;
}

if (import.meta.main) await runNativeReactAcceptance();
