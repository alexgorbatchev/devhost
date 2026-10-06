import { expect, test } from "bun:test";
import { openNativeReduxExtension, selectReduxStore, waitForReduxHistoryIndex, withNativeReduxHost } from "./helpers";

test("callable Zustand bound stores retain genuine extension replay through registration and producer cleanup", async () => {
  await withNativeReduxHost({ isExtensionEnabled: true }, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(`${host.url}unrelated`);
    const native = await openNativeReduxExtension(page, browser);
    await native.getByText("No store found. Make sure to follow", { exact: false }).waitFor();
    await page.goto(`${host.url}?zustand=bound`);
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    expect(await page.evaluate(() => window.reduxNativeFixture.read().isZustandBoundStore)).toEqual([true, true]);
    await selectReduxStore(native, "A Zustand1");
    await native.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 1);
    await native.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 2);
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 2);
    await monitor.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 3);
    expect(await launcher.getAttribute("title")).toBe("Close Redux DevTools: connected to 4 registered host stores");
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasOriginalActions)).toEqual([true, true]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasNativeZustandMiddleware)).toEqual([
      true,
      true,
    ]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().isHookUnchanged)).toBe(true);
    await Bun.write(`${host.rootPath}/bound-native-inspector.snapshot`, await monitor.locator("body").ariaSnapshot());
    const closed = monitor.waitForEvent("close");
    await page.getByRole("button", { name: "Unregister stores", exact: true }).click();
    await closed;
    await launcher.waitFor({ state: "detached" });
    expect(await launcher.count()).toBe(0);
    await selectReduxStore(native, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await native.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 4);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().zustand)).toEqual([4, 0]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasOriginalActions)).toEqual([true, true]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasNativeZustandMiddleware)).toEqual([
      true,
      true,
    ]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().isHookUnchanged)).toBe(true);
    await Bun.write(`${host.rootPath}/bound-native-extension.snapshot`, await native.locator("body").ariaSnapshot());
  });
}, 60000);

test("the production toolbar opens genuine Redux DevTools and replays real Toolkit and Zustand stores", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(host.url);
    const launcher = page
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Redux", exact: true });
    await launcher.waitFor();
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Toolkit1");
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 1);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([1, 0]);
    await monitor.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 2);
    await selectReduxStore(monitor, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 1);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    await monitor.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 2);
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    expect(await launcher.getAttribute("title")).toBe("Close Redux DevTools: connected to 4 registered host stores");
    await Bun.write(`${host.rootPath}/native-inspector.snapshot`, await monitor.locator("body").ariaSnapshot());
    await monitor.screenshot({ path: `${host.rootPath}/native-inspector.png` });
    await monitor.close();
    await page.getByRole("button", { name: "Redux", exact: true, pressed: false }).waitFor();
    expect(await page.evaluate(() => window.reduxNativeFixture.read().isHookUnchanged)).toBe(true);
  });
}, 60000);

test("late setup, HMR replacement, native reload and StrictMode disable/remount recover with actual stores", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(`${host.url}?registration=late`);
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Redux", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Register stores", exact: true }).click();
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    await launcher.waitFor();
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 0);
    await page.getByRole("button", { name: "Replace stores", exact: true }).click();
    await selectReduxStore(monitor, "A Toolkit1");
    expect(await monitor.getByRole("combobox").count()).toBe(1);
    await monitor.reload();
    await selectReduxStore(monitor, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 0);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    const closed = monitor.waitForEvent("close");
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await closed;
    await launcher.waitFor({ state: "detached" });
    expect(await launcher.count()).toBe(0);
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await launcher.waitFor();
    const reopened = page.waitForEvent("popup");
    await launcher.click();
    const second = await reopened;
    await selectReduxStore(second, "A Toolkit1");
    const unmounted = second.waitForEvent("close");
    await page.getByRole("button", { name: "Unmount devhost", exact: true }).click();
    await unmounted;
    await page.getByRole("button", { name: "Mount devhost", exact: true }).click();
    await launcher.waitFor();
    const remounted = page.waitForEvent("popup");
    await launcher.click();
    const third = await remounted;
    await selectReduxStore(third, "A Toolkit1");
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    await third.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 0);
    expect(await launcher.getAttribute("title")).toBe("Close Redux DevTools: connected to 4 registered host stores");
    const removed = third.waitForEvent("close");
    await page.getByRole("button", { name: "Unregister stores", exact: true }).click();
    await removed;
    await launcher.waitFor({ state: "detached" });
    expect(await launcher.count()).toBe(0);
  });
}, 60000);

test("invalid explicit instrumentation exposes setup guidance and recovers after genuine registration", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(host.url);
    await page.getByRole("button", { name: "Invalid store", exact: true }).click();
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    await page.waitForFunction(() =>
      Boolean(
        document.querySelector("#devhost-fixture")?.shadowRoot?.querySelector('[title^="Redux DevTools unavailable:"]'),
      ),
    );
    expect(await launcher.getAttribute("title")).toBe(
      "Redux DevTools unavailable: Invalid Toolkit: Redux DevTools requires the public instrument EnhancedStore.liftedStore capability. Instrument the host store once; do not add another enhancer to an already instrumented store.",
    );
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await monitor
      .getByText(
        "Invalid Toolkit: Redux DevTools requires the public instrument EnhancedStore.liftedStore capability. Instrument the host store once; do not add another enhancer to an already instrumented store.",
        { exact: true },
      )
      .waitFor();
    await page.getByRole("button", { name: "Register stores", exact: true }).click();
    await selectReduxStore(monitor, "A Toolkit1");
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 0);
    expect(await launcher.getAttribute("title")).toBe("Close Redux DevTools: connected to 4 registered host stores");
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
  });
}, 60000);

test("native reorder, reset, revert, commit, lock, recording, skip, sweep and file controls operate on the real Toolkit host", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(host.url);
    const opened = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Redux", exact: true }).click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Toolkit1");
    const increment = page.getByRole("button", { name: "Increment A Toolkit1", exact: true });
    await increment.click();
    await increment.click();
    await waitForReduxHistoryIndex(monitor, 2);
    const action = monitor.locator('[data-id="2"]').locator("..");
    await action.focus();
    await action.press("Space");
    await monitor
      .getByRole("status")
      .getByText("Draggable item 2 was moved over droppable area 2.", { exact: true })
      .waitFor();
    await action.press("ArrowUp");
    await monitor
      .getByRole("status")
      .getByText("Draggable item 2 was moved over droppable area 1.", { exact: true })
      .waitFor();
    await action.press("Space");
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkitActionIds[0]?.join(",") === "0,2,1");
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkitActionIds)).toEqual([[0, 2, 1], [0]]);
    const downloadStarted = monitor.waitForEvent("download");
    await monitor.getByRole("button", { name: "Export to a file", exact: true }).click();
    const download = await downloadStarted;
    const historyPath = `${host.rootPath}/native-history.json`;
    await download.saveAs(historyPath);
    expect(download.suggestedFilename()).toBe("state.json");
    await monitor.getByRole("button", { name: "Reset to the state you created the store with", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 0);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([0, 0]);
    await monitor.locator('input[type="file"]').setInputFiles(historyPath);
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 2);
    await waitForReduxHistoryIndex(monitor, 2);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([2, 0]);
    await monitor.locator('[data-id="1"]').hover();
    await monitor.locator('[data-id="1"]').getByText("Skip", { exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 1);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([1, 0]);
    await monitor
      .getByRole("button", { name: "Remove all currently disabled actions from the log", exact: true })
      .click();
    await monitor.locator('[data-id="1"]').waitFor({ state: "detached" });
    expect(await monitor.locator('[data-id="2"]').count()).toBe(1);
    await monitor.getByRole("button", { name: "Lock changes", exact: true }).click();
    await monitor.getByRole("button", { name: "Unlock changes", exact: true }).waitFor();
    await increment.click();
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([1, 0]);
    await monitor.getByRole("button", { name: "Unlock changes", exact: true }).click();
    await monitor.getByRole("button", { name: "Pause recording", exact: true }).click();
    await monitor.getByRole("button", { name: "Start recording", exact: true }).waitFor();
    await increment.click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 2);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([2, 0]);
    await monitor.getByRole("button", { name: "Start recording", exact: true }).click();
    await increment.click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 3);
    await monitor.getByRole("button", { name: "Roll back to the last committed state", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 2);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([2, 0]);
    await increment.click();
    await waitForReduxHistoryIndex(monitor, 1);
    await monitor
      .getByRole("button", {
        name: "Remove all actions from the log,\\a and make the current state your initial state",
        exact: true,
      })
      .click();
    await waitForReduxHistoryIndex(monitor, 0);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([3, 0]);
    await Bun.write(`${host.rootPath}/native-controls.snapshot`, await monitor.locator("body").ariaSnapshot());
  });
}, 60000);

test("native Zustand reset, revert, commit and export preserve host functions and reconnect after monitor navigation", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(host.url);
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Zustand1");
    const increment = page.getByRole("button", { name: "Increment A Zustand1", exact: true });
    await increment.click();
    await increment.click();
    await waitForReduxHistoryIndex(monitor, 2);
    await monitor.getByRole("button", { name: "Roll back to the last committed state", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 0);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().zustand)).toEqual([0, 0]);
    await increment.click();
    await waitForReduxHistoryIndex(monitor, 1);
    await monitor
      .getByRole("button", {
        name: "Remove all actions from the log,\\a and make the current state your initial state",
        exact: true,
      })
      .click();
    await waitForReduxHistoryIndex(monitor, 0);
    await increment.click();
    await waitForReduxHistoryIndex(monitor, 1);
    await monitor.getByRole("button", { name: "Roll back to the last committed state", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 1);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().zustand)).toEqual([1, 0]);
    const downloadStarted = monitor.waitForEvent("download");
    await monitor.getByRole("button", { name: "Export to a file", exact: true }).click();
    const download = await downloadStarted;
    await download.saveAs(`${host.rootPath}/native-zustand-history.json`);
    expect(download.suggestedFilename()).toBe("state.json");
    await monitor.getByRole("button", { name: "Reset to the state you created the store with", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 0);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    await monitor.goto(`${host.url}unrelated`);
    await page.getByRole("button", { name: "Redux", exact: true }).waitFor();
    await page.waitForFunction(() =>
      Boolean(
        document
          .querySelector("#devhost-fixture")
          ?.shadowRoot?.querySelector('[title="Close Redux DevTools: window open, waiting for host connection"]'),
      ),
    );
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    await increment.click();
    await monitor.goBack();
    await selectReduxStore(monitor, "A Zustand1");
    await increment.click();
    await waitForReduxHistoryIndex(monitor, 1);
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 1);
    expect(await launcher.getAttribute("title")).toBe("Close Redux DevTools: connected to 4 registered host stores");
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
  });
}, 60000);

test("native browser popup denial is actionable and ordinary navigation positively recovers without fabricated open state", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(`${host.url}?popup=blocked`);
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    await launcher.click();
    await page.waitForFunction(() =>
      Boolean(
        document
          .querySelector("#devhost-fixture")
          ?.shadowRoot?.querySelector(
            '[title="Redux DevTools unavailable: Allow popups for this project and try again."]',
          ),
      ),
    );
    expect(await launcher.getAttribute("title")).toBe(
      "Redux DevTools unavailable: Allow popups for this project and try again.",
    );
    expect(await launcher.getAttribute("aria-pressed")).toBe("false");
    expect(browser.pages().length).toBe(2);
    await page.goto(host.url);
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 0);
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    await monitor.close();
    await page.goto(`${host.url}unrelated`);
    expect(await page.getByRole("button", { name: "Redux", exact: true }).count()).toBe(0);
    const orphan = await browser.newPage();
    await orphan.goto(`${host.url}__devhost__/redux`);
    await orphan
      .getByText("Open Redux DevTools from a registered host page's devhost toolbar to connect real stores.", {
        exact: true,
      })
      .waitFor();
    await orphan.getByRole("combobox").click();
    expect(await orphan.getByRole("option").allTextContents()).toEqual(["Autoselect instances"]);
  });
}, 60000);

test("a genuinely frozen native monitor can close and the owned window watcher recovers actual stores on reopening", async () => {
  await withNativeReduxHost({}, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(host.url);
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Zustand1");
    const protocol = await browser.newCDPSession(monitor);
    const frozen = await protocol.send("Page.setWebLifecycleState", { state: "frozen" });
    await Bun.write(`${host.rootPath}/native-freeze.json`, JSON.stringify(frozen) + "\n");
    await monitor.close();
    await page.getByRole("button", { name: "Redux", exact: true, pressed: false }).waitFor();
    expect(await launcher.getAttribute("title")).toBe("Open Redux DevTools for registered host stores");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    const reopened = page.waitForEvent("popup");
    await launcher.click();
    const second = await reopened;
    await selectReduxStore(second, "A Zustand1");
    await waitForReduxHistoryIndex(second, 0);
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await waitForReduxHistoryIndex(second, 1);
    await second.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 1);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().zustand)).toEqual([1, 0]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    expect(await launcher.getAttribute("title")).toBe("Close Redux DevTools: connected to 4 registered host stores");
  });
}, 60000);

test("the genuine released extension still records and replays both ecosystems through production attachment and cleanup", async () => {
  await withNativeReduxHost({ isExtensionEnabled: true }, async (host, browser) => {
    const page = await browser.newPage();
    await page.goto(`${host.url}unrelated`);
    const native = await openNativeReduxExtension(page, browser);
    await native.getByText("No store found. Make sure to follow", { exact: false }).waitFor();
    await Bun.write(`${host.rootPath}/native-extension-empty.snapshot`, await native.locator("body").ariaSnapshot());
    await page.goto(host.url);
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await selectReduxStore(native, "A Zustand1");
    await native.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 1);
    await native.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 2);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    const launcher = page.getByRole("button", { name: "Redux", exact: true });
    const opened = page.waitForEvent("popup");
    await launcher.click();
    const monitor = await opened;
    await selectReduxStore(monitor, "A Toolkit1");
    await page.getByRole("button", { name: "Increment A Toolkit1", exact: true }).click();
    await monitor.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 2);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().isHookUnchanged)).toBe(true);
    await selectReduxStore(native, "A Toolkit1");
    await waitForReduxHistoryIndex(native, 3);
    await native.getByRole("button", { name: "Go back", exact: true }).click();
    await waitForReduxHistoryIndex(native, 2);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().toolkit)).toEqual([2, 0]);
    await native.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 1);
    await native.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().toolkit[0] === 3);
    const closed = monitor.waitForEvent("close");
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await closed;
    await selectReduxStore(native, "A Zustand1");
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await page.getByRole("button", { name: "Increment A Zustand1", exact: true }).click();
    await native.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForFunction(() => window.reduxNativeFixture.read().zustand[0] === 3);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().hasActions)).toEqual([true, true]);
    expect(await page.evaluate(() => window.reduxNativeFixture.read().isHookUnchanged)).toBe(true);
    await Bun.write(`${host.rootPath}/native-extension.snapshot`, await native.locator("body").ariaSnapshot());
    await native.screenshot({ path: `${host.rootPath}/native-extension.png` });
  });
}, 60000);
