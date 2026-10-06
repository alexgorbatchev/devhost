import { expect, test } from "bun:test";
import assert from "node:assert/strict";

import { fixture_visibilityModes } from "./fixtures";
import { authorizeNativeVueHost, revealNativeVueHost, withNativeVueHosts } from "./helpers";

test("the real Vue host opens its native Components inspector through devhost", async () => {
  await withNativeVueHosts([{}], async ([host], browser) => {
    assert(host);
    const page = await browser.newPage();
    await page.goto(host.url);
    await authorizeNativeVueHost(page, host);
    const group = page.getByRole("group", { name: "External devtools", exact: true });
    const launcher = group.getByRole("button", { name: "Vue", exact: true });
    const openLauncher = group.getByRole("button", { name: "Vue", exact: true, pressed: true });
    const closedLauncher = group.getByRole("button", { name: "Vue", exact: true, pressed: false });
    await launcher.waitFor({ timeout: 5000 });
    expect(await launcher.getAttribute("aria-pressed")).toBe("false");
    await launcher.click();
    const inspector = page.frameLocator('iframe[src*="/__devtools__/"]');
    await inspector.getByRole("link", { name: "Components", exact: true }).click();
    await inspector.getByRole("treeitem").first().waitFor();
    await Bun.write(`${host.rootPath}/components.snapshot`, await inspector.locator("body").ariaSnapshot());
    await inspector
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .click();
    await Bun.write(`${host.rootPath}/selected.snapshot`, await inspector.locator("body").ariaSnapshot());
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    const count = inspector
      .locator('[class~="group/state-row"]')
      .filter({ has: inspector.getByText("count", { exact: true }) })
      .locator(".literal-state-type");
    await count.filter({ hasText: /^0$/ }).waitFor();
    expect(await count.textContent()).toBe("0");
    await page.getByRole("button", { name: "Increment Vue A", exact: true }).click();
    await count.filter({ hasText: /^1$/ }).waitFor();
    expect(await count.textContent()).toBe("1");
    const component = Bun.file(`${host.rootPath}/host/HostCounter.vue`);
    await Bun.write(
      component,
      (await component.text()).replace("Vue {{ project }} count", "Vue {{ project }} refreshed count"),
    );
    await page.getByRole("heading", { name: "Vue A refreshed count 1", exact: true }).waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    await inspector.getByRole("button", { name: "Select component in the page", exact: true }).click();
    await closedLauncher.waitFor();
    await page.getByRole("heading", { name: "Vue A refreshed count 1", exact: true }).click();
    await openLauncher.waitFor();
    expect(await count.textContent()).toBe("1");
    await page.getByRole("button", { name: "Toggle counter mount", exact: true }).click();
    await inspector
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Toggle counter mount", exact: true }).click();
    await inspector
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .waitFor();
    await page.evaluate(async () => {
      await window.nativeVueFixture.readContext().docks.switchEntry("~settings");
    });
    await closedLauncher.waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("false");
    await launcher.click();
    await openLauncher.waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Escape");
    await closedLauncher.waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("false");
    await launcher.click();
    await openLauncher.waitFor();
    await launcher.click();
    await closedLauncher.waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("false");
    await page.getByRole("button", { name: "Replace Vue application", exact: true }).click();
    await launcher.waitFor();
    await launcher.click();
    await inspector.getByRole("link", { name: "Components", exact: true }).click();
    await inspector
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .click();
    await count.filter({ hasText: /^0$/ }).waitFor();
    expect(await count.textContent()).toBe("0");
    await page.getByRole("button", { name: "Increment Vue A", exact: true }).click();
    await count.filter({ hasText: /^1$/ }).waitFor();
    expect(await count.textContent()).toBe("1");
  });
}, 120000);

test("independent native Vue projects preserve state and suppression across origins and a Vite base path", async () => {
  await withNativeVueHosts([{}, { base: "/project-b/" }], async ([first, second], browser) => {
    assert(first && second);
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await pageA.goto(first.url);
    await pageB.goto(new URL("?project=B", second.url).href);
    await authorizeNativeVueHost(pageA, first);
    await authorizeNativeVueHost(pageB, second);
    const launcherA = pageA
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Vue", exact: true });
    const launcherB = pageB
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Vue", exact: true });
    await launcherA.waitFor();
    await launcherB.waitFor();
    expect(new URL(first.url).origin === new URL(second.url).origin).toBe(false);
    expect(new URL(second.url).pathname).toBe("/project-b/");
    await launcherA.click();
    await pageA.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    expect(await launcherB.getAttribute("aria-pressed")).toBe("false");
    await launcherB.click();
    const inspectorA = pageA.frameLocator('iframe[src*="/__devtools__/"]');
    const inspectorB = pageB.frameLocator('iframe[src*="/__devtools__/"]');
    await inspectorA.getByRole("link", { name: "Components", exact: true }).click();
    await inspectorB.getByRole("link", { name: "Components", exact: true }).click();
    await inspectorA
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .click();
    await inspectorB
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .click();
    const countA = inspectorA
      .locator('[class~="group/state-row"]')
      .filter({ has: inspectorA.getByText("count", { exact: true }) })
      .locator(".literal-state-type");
    const countB = inspectorB
      .locator('[class~="group/state-row"]')
      .filter({ has: inspectorB.getByText("count", { exact: true }) })
      .locator(".literal-state-type");
    await countA.filter({ hasText: /^0$/ }).waitFor();
    await countB.filter({ hasText: /^0$/ }).waitFor();
    await pageB.getByRole("button", { name: "Increment Vue B", exact: true }).click();
    await countB.filter({ hasText: /^1$/ }).waitFor();
    expect(await countA.textContent()).toBe("0");
    expect(await countB.textContent()).toBe("1");
    await launcherA.click();
    await pageA.getByRole("button", { name: "Vue", exact: true, pressed: false }).waitFor();
    expect(await launcherB.getAttribute("aria-pressed")).toBe("true");
    await pageA.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await pageA.locator("devframes-dock-embedded").getByRole("button", { name: "Vue DevTools", exact: true }).waitFor();
    expect(
      await pageA
        .locator("devframes-dock-embedded")
        .evaluate((element) => element.shadowRoot?.adoptedStyleSheets.length),
    ).toBe(0);
    expect(
      await pageB
        .locator("devframes-dock-embedded")
        .evaluate((element) => element.shadowRoot?.adoptedStyleSheets.length),
    ).toBe(1);
    expect(await countB.textContent()).toBe("1");
    await Bun.write(
      `${first.rootPath}/independent-projects.json`,
      JSON.stringify({
        firstOrigin: new URL(first.url).origin,
        secondOrigin: new URL(second.url).origin,
        secondBase: new URL(second.url).pathname,
        firstCount: await countA.textContent(),
        secondCount: await countB.textContent(),
      }),
    );
  });
}, 120000);

test.each([...fixture_visibilityModes])(
  "Vue availability follows %j docks, authorization and real mounted applications",
  async (options) => {
    await withNativeVueHosts([options], async ([host], browser) => {
      assert(host);
      const page = await browser.newPage();
      await page.goto(host.url);
      const launcher = page
        .getByRole("group", { name: "External devtools", exact: true })
        .getByRole("button", { name: "Vue", exact: true });
      await page.waitForFunction(() => window.nativeVueFixture?.readContext()?.panel.state.state === "hidden");
      expect(await launcher.count()).toBe(0);
      await revealNativeVueHost(page);
      await page.getByRole("button", { name: "Unauthorized", exact: true }).waitFor();
      expect(await launcher.count()).toBe(0);
      await authorizeNativeVueHost(page, host);
      await launcher.waitFor();
      expect(await launcher.getAttribute("title")).toBe("Toggle Vue inspector (connected)");
      const oldRoot = await page
        .locator("devframes-dock-embedded")
        .evaluateHandle((element) => element.shadowRoot as ShadowRoot);
      await launcher.click();
      await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
      await page.keyboard.press("Alt+Shift+D");
      await launcher.waitFor({ state: "detached" });
      expect(await oldRoot.evaluate((root) => root.adoptedStyleSheets.length)).toBe(0);
      await page.keyboard.press("Alt+Shift+D");
      await launcher.waitFor();
      expect(
        await oldRoot.evaluate((root) => root === document.querySelector("devframes-dock-embedded")?.shadowRoot),
      ).toBe(true);
      expect(await launcher.getAttribute("aria-pressed")).toBe("true");
      await launcher.click();
      await page.getByRole("button", { name: "Unmount Vue application", exact: true }).click();
      await launcher.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Mount Vue application", exact: true }).click();
      await launcher.waitFor();
      expect(await launcher.getAttribute("aria-pressed")).toBe("false");
      await page.goto(new URL("unrelated.html", host.url).href);
      await page.getByRole("heading", { name: "Unrelated host page", exact: true }).waitFor();
      await revealNativeVueHost(page);
      await page.waitForFunction(() => window.nativeVueFixture?.readContext()?.rpc.isTrusted === true);
      await page.waitForFunction(() =>
        window.nativeVueFixture.readContext().docks.entries.some((entry) => entry.id === "vue-devtools"),
      );
      expect(await page.evaluate(() => window.nativeVueFixture.readVueEntry().id)).toBe("vue-devtools");
      expect(await launcher.count()).toBe(0);
      await page.goto(host.url);
      await revealNativeVueHost(page);
      await launcher.waitFor();
      expect(await launcher.getAttribute("aria-pressed")).toBe("false");
      await oldRoot.dispose();
    });
  },
  120000,
);

test("Vue aggregation follows native floating-to-edge launcher replacement", async () => {
  await withNativeVueHosts([{}], async ([host], browser) => {
    assert(host);
    const page = await browser.newPage();
    await page.goto(host.url);
    await authorizeNativeVueHost(page, host);
    const launcher = page
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Vue", exact: true });
    await launcher.waitFor();
    await page.evaluate(() => {
      const store = window.nativeVueFixture.readContext().panel.store;
      store.position = "top";
      store.mode = "edge";
    });
    await page.locator("devframes-dock-embedded #devframes-edge-panel").waitFor();
    await launcher.waitFor({ timeout: 5000 });
    expect(await launcher.getAttribute("aria-pressed")).toBe("false");
    await launcher.press("Enter");
    await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    expect(await page.evaluate(() => window.nativeVueFixture.readContext().panel.state.selectedDockId)).toBe(
      "vue-devtools",
    );
    await page.evaluate(() => {
      window.nativeVueFixture.readContext().panel.store.mode = "float";
    });
    await page.locator("devframes-dock-embedded #devframes-dock").waitFor();
    await launcher.waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    await launcher.press("Enter");
    await page.getByRole("button", { name: "Vue", exact: true, pressed: false }).waitFor();
  });
}, 120000);

test("Vue suppression preserves native registrations, metadata, selection and foreign stylesheets", async () => {
  await withNativeVueHosts([{}], async ([host], browser) => {
    assert(host);
    const page = await browser.newPage();
    await page.goto(host.url);
    await authorizeNativeVueHost(page, host);
    const launcher = page
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Vue", exact: true });
    await launcher.waitFor();
    const root = await page
      .locator("devframes-dock-embedded")
      .evaluateHandle((element) => element.shadowRoot as ShadowRoot);
    const foreign = await root.evaluateHandle((shadow) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(".foreign-host-fixture {color: blue}");
      shadow.adoptedStyleSheets.push(sheet);
      return sheet;
    });
    const registration = await page.evaluateHandle(() => {
      const context = window.nativeVueFixture.readContext();
      return context.docks.register({
        ...window.nativeVueFixture.readVueEntry(),
        title: "Host-owned Vue inspector",
        defaultOrder: 10,
      });
    });
    const nativeLauncher = page
      .locator("devframes-dock-embedded")
      .getByRole("button", { name: "Host-owned Vue inspector", exact: true, includeHidden: true });
    await nativeLauncher.waitFor({ state: "hidden" });
    await launcher.click();
    await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    const metadata = await page.evaluate(() => JSON.stringify(window.nativeVueFixture.readVueEntry()));
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await nativeLauncher.waitFor({ state: "visible" });
    expect(await page.evaluate(() => JSON.stringify(window.nativeVueFixture.readVueEntry()))).toBe(metadata);
    expect(await page.evaluate(() => ({ ...window.nativeVueFixture.readContext().panel.state }))).toEqual({
      state: "open",
      selectedDockId: "vue-devtools",
    });
    expect(await root.evaluate((shadow, sheet) => shadow.adoptedStyleSheets.includes(sheet), foreign)).toBe(true);
    expect(await root.evaluate((shadow) => shadow.adoptedStyleSheets.length)).toBe(1);
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await launcher.waitFor();
    await page.evaluate(() => {
      const entry = { ...window.nativeVueFixture.readVueEntry() };
      delete entry.defaultOrder;
      window.nativeVueFixture.readContext().docks.update(entry);
    });
    expect(await page.evaluate(() => Object.hasOwn(window.nativeVueFixture.readVueEntry(), "defaultOrder"))).toBe(
      false,
    );
    await registration.evaluate((handle) => handle.update({ title: "Settings" }));
    await launcher.waitFor({ state: "detached" });
    const settings = page.locator("devframes-dock-embedded").getByRole("button", { name: "Settings", exact: true });
    expect(await settings.count()).toBe(2);
    await registration.evaluate((handle) => handle.update({ title: "Recovered Vue inspector" }));
    await launcher.waitFor();
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    await page.evaluate(() => window.nativeVueFixture.replaceDock());
    await page
      .locator("devframes-dock-embedded")
      .getByRole("button", { name: "Recovered Vue inspector", exact: true, includeHidden: true })
      .waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.querySelector("devframes-dock-embedded")?.shadowRoot?.adoptedStyleSheets.length === 1,
    );
    expect(
      await root.evaluate((shadow) => shadow === document.querySelector("devframes-dock-embedded")?.shadowRoot),
    ).toBe(false);
    expect(await root.evaluate((shadow) => shadow.adoptedStyleSheets.length)).toBe(1);
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    const replacementRegistration = await page.evaluateHandle(() =>
      window.nativeVueFixture.readContext().docks.register({ ...window.nativeVueFixture.readVueEntry() }, true),
    );
    const replacedMetadata = await page.evaluate(() => JSON.stringify(window.nativeVueFixture.readVueEntry()));
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("devframes-dock-embedded")?.shadowRoot?.adoptedStyleSheets.length === 0,
    );
    expect(await page.evaluate(() => window.nativeVueFixture.readVueEntry().title)).toBe("Recovered Vue inspector");
    expect(await page.evaluate(() => JSON.stringify(window.nativeVueFixture.readVueEntry()))).toBe(replacedMetadata);
    expect(await root.evaluate((shadow, sheet) => shadow.adoptedStyleSheets.includes(sheet), foreign)).toBe(true);
    await replacementRegistration.evaluate((handle) => handle.update({ title: "Later owner remains active" }));
    await page
      .locator("devframes-dock-embedded")
      .getByRole("button", { name: "Later owner remains active", exact: true })
      .waitFor();
    expect(await page.evaluate(() => window.nativeVueFixture.readVueEntry().title)).toBe("Later owner remains active");
    await replacementRegistration.evaluate((handle) => handle.dispose());
    await replacementRegistration.dispose();
    await registration.dispose();
    await foreign.dispose();
    await root.dispose();
  });
}, 120000);

test("Vue suppression follows genuine server metadata replacement, removal and re-registration", async () => {
  await withNativeVueHosts([{}], async ([host], browser) => {
    assert(host);
    const page = await browser.newPage();
    await page.goto(host.url);
    await authorizeNativeVueHost(page, host);
    const launcher = page
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Vue", exact: true });
    await launcher.waitFor();
    const replacementResponse = await fetch(host.controlUrl, {
      method: "POST",
      body: JSON.stringify({ action: "replace" }),
    });
    expect(replacementResponse.status).toBe(200);
    await Bun.write(`${host.rootPath}/server-replacement.json`, await replacementResponse.text());
    await Bun.write(
      `${host.rootPath}/browser-replacement.json`,
      await page.evaluate(() => JSON.stringify(window.nativeVueFixture.readContext().docks.entries)),
    );
    try {
      await page.waitForFunction(() => window.nativeVueFixture.readVueEntry().badge === "Live");
    } finally {
      await Bun.write(
        `${host.rootPath}/browser-shared-state.json`,
        await page.evaluate(async () => {
          const context = window.nativeVueFixture.readContext();
          const state = await context.rpc.sharedState.get("devframe:docks");
          return JSON.stringify({
            sharedState: state.value(),
            entries: context.docks.entries,
            connection: context.connection.status,
            trusted: context.rpc.isTrusted,
          });
        }),
      );
    }
    await page
      .locator("devframes-dock-embedded")
      .getByRole("button", { name: "Server-owned Vue inspector", exact: true, includeHidden: true })
      .waitFor({ state: "hidden" });
    await launcher.click();
    await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    expect(
      (await fetch(host.controlUrl, { method: "POST", body: JSON.stringify({ action: "remove-field" }) })).status,
    ).toBe(200);
    await page.waitForFunction(() => !Object.hasOwn(window.nativeVueFixture.readVueEntry(), "badge"));
    expect(await launcher.getAttribute("aria-pressed")).toBe("true");
    expect((await fetch(host.controlUrl, { method: "POST", body: JSON.stringify({ action: "remove" }) })).status).toBe(
      200,
    );
    await launcher.waitFor({ state: "detached" });
    expect(
      await page
        .locator("devframes-dock-embedded")
        .evaluate((element) => element.shadowRoot?.adoptedStyleSheets.length),
    ).toBe(0);
    expect((await fetch(host.controlUrl, { method: "POST", body: JSON.stringify({ action: "restore" }) })).status).toBe(
      200,
    );
    await launcher.waitFor();
    expect(await page.evaluate(() => window.nativeVueFixture.readVueEntry().title)).toBe("Server-owned Vue inspector");
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await page
      .locator("devframes-dock-embedded")
      .getByRole("button", { name: "Server-owned Vue inspector", exact: true })
      .waitFor();
    expect(await page.evaluate(() => Object.hasOwn(window.nativeVueFixture.readVueEntry(), "badge"))).toBe(false);
    await page.locator("devframes-dock-embedded").getByRole("button", { name: "Settings", exact: true }).press("Enter");
    await page.waitForFunction(() => window.nativeVueFixture.readContext().panel.state.selectedDockId === "~settings");
    expect(await page.evaluate(() => window.nativeVueFixture.readContext().panel.state.state)).toBe("open");
  });
}, 120000);

test("unchanged native metadata and inspection recover through StrictMode, disable and full devhost remount", async () => {
  await withNativeVueHosts([{}], async ([host], browser) => {
    assert(host);
    const page = await browser.newPage();
    await page.goto(new URL("?aggregation=disabled", host.url).href);
    await authorizeNativeVueHost(page, host);
    const launcher = page
      .getByRole("group", { name: "External devtools", exact: true })
      .getByRole("button", { name: "Vue", exact: true });
    expect(await launcher.count()).toBe(0);
    expect((await fetch(host.controlUrl, { method: "POST", body: JSON.stringify({ action: "replace" }) })).status).toBe(
      200,
    );
    await page.waitForFunction(() => window.nativeVueFixture.readVueEntry().badge === "Live");
    const native = page
      .locator("devframes-dock-embedded")
      .getByRole("button", { name: "Server-owned Vue inspector", exact: true });
    await native.waitFor();
    await Bun.write(
      `${host.rootPath}/native-control.json`,
      await page.evaluate(() => JSON.stringify(window.nativeVueFixture.readContext().docks.entries)),
    );
    expect(await page.evaluate(() => window.nativeVueFixture.readVueEntry().title)).toBe("Server-owned Vue inspector");
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await launcher.waitFor();
    await launcher.click();
    await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await native.waitFor();
    expect(await page.evaluate(() => window.nativeVueFixture.readContext().panel.state.selectedDockId)).toBe(
      "vue-devtools",
    );
    await native.press("Enter");
    await page.waitForFunction(() => window.nativeVueFixture.readContext().panel.state.state === "closed");
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await page.getByRole("button", { name: "Vue", exact: true, pressed: false }).waitFor();
    await launcher.click();
    await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    await page.getByRole("button", { name: "Unmount devhost fixture", exact: true }).click();
    await native.waitFor();
    expect(
      await page
        .locator("devframes-dock-embedded")
        .evaluate((element) => element.shadowRoot?.adoptedStyleSheets.length),
    ).toBe(0);
    expect(await page.evaluate(() => window.nativeVueFixture.readContext().panel.state.selectedDockId)).toBe(
      "vue-devtools",
    );
    await page.getByRole("button", { name: "Mount devhost fixture", exact: true }).click();
    await page.getByRole("button", { name: "Toggle aggregation", exact: true }).click();
    await page.getByRole("button", { name: "Vue", exact: true, pressed: true }).waitFor();
    const inspector = page.frameLocator('iframe[src*="/__devtools__/"]');
    await inspector.getByRole("link", { name: "Components", exact: true }).click();
    await inspector
      .getByRole("treeitem", { name: "<HostCounter key=0> fragment Add to favorites", exact: true })
      .click();
    const count = inspector
      .locator('[class~="group/state-row"]')
      .filter({ has: inspector.getByText("count", { exact: true }) })
      .locator(".literal-state-type");
    await page.getByRole("button", { name: "Increment Vue A", exact: true }).click();
    await count.filter({ hasText: /^1$/ }).waitFor();
    expect(await count.textContent()).toBe("1");
    await Bun.write(`${host.rootPath}/strict-remount.snapshot`, await inspector.locator("body").ariaSnapshot());
  });
}, 120000);
