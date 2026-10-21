import assert from "node:assert/strict";
import { z } from "zod";
import type { Browser, Page } from "playwright";
import { readNativeReactTargets } from "./readNativeReactTargets";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import { NativeReactTargetDriver } from "./NativeReactTargetDriver";

interface INativeReactInspectorOptions {
  browser: Browser;
  host: Page;
  endpoint: string;
  extensionId: string;
  // Where each driven step records what it read and did.
  evidencePath: string;
  projectName: string;
}

type NativeReactPanel = "Components" | "Profiler";
const targetInfoSchema = z.object({ targetInfo: z.object({ targetId: z.string() }) });
const nativeWindowSchema = z.object({ targetId: z.string().optional() });

export class NativeReactInspector {
  readonly options: INativeReactInspectorOptions;
  private windowId: string = "";
  private readonly panels = new Map<NativeReactPanel, string>();
  private readonly drivers = new Map<string, NativeReactTargetDriver>();

  constructor(options: INativeReactInspectorOptions) {
    this.options = options;
  }

  // Connects to a target of the owned browser once, through the debugging WebSocket the browser lists for it.
  private async driver(targetId: string): Promise<NativeReactTargetDriver> {
    const existing = this.drivers.get(targetId);
    if (existing !== undefined) return existing;
    const target = (await readNativeReactTargets(this.options.endpoint)).find((candidate) => candidate.id === targetId);
    assert(target?.webSocketDebuggerUrl, "Owned native target is gone or exposes no debugging WebSocket.");
    const driver = await NativeReactTargetDriver.connect(
      target.webSocketDebuggerUrl,
      targetId,
      this.options.evidencePath,
    );
    this.drivers.set(targetId, driver);
    return driver;
  }

  // Disconnects every target connection this inspector opened; the browser and its windows stay as they are.
  async close(): Promise<void> {
    const outcomes = await Promise.allSettled(Array.from(this.drivers.values(), (driver) => driver.close()));
    this.drivers.clear();
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length > 0) throw new AggregateError(failures, "Closing native target connections failed.");
  }

  async assertWindowPreserved(): Promise<void> {
    const session = await this.options.browser.newBrowserCDPSession();
    const hostSession = await this.options.host.context().newCDPSession(this.options.host);
    try {
      const hostInfo: unknown = await hostSession.send("Target.getTargetInfo");
      const hostId = targetInfoSchema.parse(hostInfo).targetInfo.targetId;
      await waitForNativeReactCondition("native window opened by actual App", async () => {
        const value: unknown = await session.send("Target.getDevToolsTarget", { targetId: hostId });
        console.info("Native window lookup:", JSON.stringify({ hostId, response: value }));
        const current = nativeWindowSchema.parse(value).targetId;
        if (current === undefined || current.length === 0) {
          assert.equal(this.windowId, "", "Previously bound browser-owned native window is absent.");
          return false;
        }
        if (this.windowId.length > 0) assert.equal(current, this.windowId, "Browser-owned native window changed.");
        this.windowId = current;
        return true;
      });
    } finally {
      await hostSession.detach();
      await session.detach();
    }
  }

  async selectPanel(panel: NativeReactPanel): Promise<string> {
    await this.assertWindowPreserved();
    const window = await this.driver(this.windowId);
    const windowState =
      '({visibility:document.visibilityState,hasFocus:document.hasFocus(),selected:Array.from(document.querySelectorAll("[role=tab][aria-selected=true]")).map(tab=>tab.textContent)})';
    await window.evaluate(`${panel}-window-before-activation`, windowState);
    const activation = await this.options.browser.newBrowserCDPSession();
    try {
      await activation.send("Target.activateTarget", { targetId: this.windowId });
    } finally {
      await activation.detach();
    }
    await window.evaluate(`${panel}-window-after-activation`, windowState);
    const label: string = `${panel} ⚛`;
    // The tab strip as text: which tabs it shows, and which is selected. A panel in the overflow menu shows its tab
    // only while it is selected, so every next-panel shortcut changes this.
    const readTabStrip = async (step: string): Promise<string> => JSON.stringify(await window.readTabs(step));
    // The frontend renders its tabs a while after the window opens.
    await waitForNativeReactCondition("native DevTools panel tabs rendered", async () =>
      (await window.readTabs(`${panel}-tabs-rendered`)).some((tab) => tab.isSelected),
    );
    const initialStrip = await readTabStrip(`${panel}-tab-strip-initial`);
    let isSelected: boolean = false;
    let strip = initialStrip;
    // The shortcut walks every panel in order and wraps around; stop once it has come back to the first one.
    for (let index = 0; index < 40; index++) {
      if ((await window.readTabs(`${panel}-tab-${index}`)).some((tab) => tab.name === label && tab.isSelected)) {
        isSelected = true;
        break;
      }
      const before = strip;
      await window.pressNextPanel(`${panel}-next-native-tab`);
      // While the strip re-renders it briefly shows no selected tab; the next shortcut waits for the settled strip,
      // or it would skip a panel.
      await waitForNativeReactCondition("native DevTools next-panel shortcut moved the selection", async () => {
        const tabs = await window.readTabs(`${panel}-tab-${index}-after-shortcut`);
        strip = JSON.stringify(tabs);
        return strip !== before && tabs.some((tab) => tab.isSelected);
      });
      if (strip === initialStrip) break;
    }
    assert(isSelected, `Original native ${panel} tab was not selected by real keyboard input.`);
    const existing = this.panels.get(panel);
    const targets = await readNativeReactTargets(this.options.endpoint);
    if (existing !== undefined) {
      assert(targets.some((target) => target.id === existing && target.parentId === this.windowId));
      return existing;
    }
    const knownIds = new Set(this.panels.values());
    const candidates = targets.filter(
      (target) =>
        target.parentId === this.windowId &&
        target.url === `chrome-extension://${this.options.extensionId}/panel.html` &&
        !knownIds.has(target.id),
    );
    assert.equal(candidates.length, 1, `Original ${panel} frontend identity is not unique.`);
    const candidate = candidates[0];
    assert(candidate);
    this.panels.set(panel, candidate.id);
    return candidate.id;
  }

  async assertComponents(count: number): Promise<void> {
    const components = await this.driver(await this.selectPanel("Components"));
    await components.waitFor(
      "wait-native-HostApp",
      'Array.from(document.querySelectorAll("[data-testname=ComponentTreeListItem]")).some(element => element.textContent === "HostApp")',
    );
    await components.snapshot("native-tree-before-HostApp-selection");
    await components.evaluate(
      "native-HostApp-row-geometry",
      'Array.from(document.querySelectorAll("[data-testname=ComponentTreeListItem]")).map(element => ({text:element.textContent, innerText:element.innerText, width:element.getBoundingClientRect().width, height:element.getBoundingClientRect().height, display:getComputedStyle(element).display, visibility:getComputedStyle(element).visibility}))',
    );
    const wrapperExpression: string = `(() => {
        const rows = Array.from(document.querySelectorAll("[data-testname=ComponentTreeListItem]"));
        const matches = rows.filter(row => row.textContent === "HostApp");
        if (matches.length !== 1) return null;
        const row = matches[0];
        const wrapper = row?.firstElementChild;
        if (!(row instanceof HTMLElement) || !(wrapper instanceof HTMLElement) || row.parentElement === null) return null;
        const childIndex = Array.from(row.parentElement.children).indexOf(row) + 1;
        const scrollSelector = '[data-testname=ComponentTreeListItem]:nth-child(' + childIndex + ') > div';
        const bounds = wrapper.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const hit = document.elementFromPoint(x, y);
        const clips = [];
        for (let parent = wrapper.parentElement; parent !== null; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if ([style.overflowX, style.overflowY].some(value => ["auto", "scroll", "hidden", "clip"].includes(value))) {
            const rect = parent.getBoundingClientRect();
            clips.push({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,overflowX:style.overflowX,overflowY:style.overflowY});
          }
        }
        return {text:row.textContent,index:rows.indexOf(row),scrollSelector,selectorMatches:document.querySelectorAll(scrollSelector).length,
          row:{left:rowBounds.left,top:rowBounds.top,right:rowBounds.right,bottom:rowBounds.bottom},
          wrapper:{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom},
          viewport:{width:innerWidth,height:innerHeight},clips,hit:hit?.outerHTML.slice(0,300),
          isVisibleHit:bounds.width>0 && bounds.height>0 && row.contains(hit)};
      })()`;
    const scrollTarget = z
      .object({ text: z.literal("HostApp"), scrollSelector: z.string(), selectorMatches: z.literal(1) })
      .parse(await components.evaluate("native-HostApp-wrapper-before-scroll", wrapperExpression));
    await components.scrollIntoView("scroll-native-HostApp-label-into-view", scrollTarget.scrollSelector);
    await components.waitFor("wait-native-HostApp-visible-label-hit", `(${wrapperExpression})?.isVisibleHit === true`);
    const wrapper = z
      .object({ text: z.literal("HostApp"), index: z.number().int().nonnegative(), isVisibleHit: z.literal(true) })
      .parse(await components.evaluate("native-HostApp-visible-wrapper", wrapperExpression));
    await components.click(
      "select-native-HostApp-visible-label",
      "[data-testname=ComponentTreeListItem] > div",
      wrapper.index,
    );
    const projectValue: string = JSON.stringify(this.options.projectName);
    const expression: string = `Array.from(document.querySelectorAll("input")).some(input => input.value === ${JSON.stringify(projectValue)}) && Array.from(document.querySelectorAll("input")).some(input => input.value === ${JSON.stringify(String(count))})`;
    try {
      await components.waitFor(`native-props-state-${count}`, expression);
    } catch (error) {
      const captures = await Promise.allSettled([
        components.snapshot(`native-failed-Components-${count}`),
        components.evaluate(
          `native-failed-visibility-state-${count}`,
          '({visibility:document.visibilityState,hasFocus:document.hasFocus(),inputs:Array.from(document.querySelectorAll("input")).map(input=>({value:input.value,label:input.getAttribute("aria-label")}))})',
        ),
      ]);
      const failures = captures.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
      if (failures.length > 0)
        throw new AggregateError([error, ...failures], "Native inspection failed; readonly capture also failed.");
      throw error;
    }
    await components.snapshot(`native-Components-${count}`);
  }

  async startRecording(): Promise<void> {
    const profiler = await this.driver(await this.selectPanel("Profiler"));
    // The original frontend drops the accessible Start label after a completed profile. Its source-owned toggle
    // remains unchanged.
    await profiler.click("native-start-profile", "[data-testname=ProfilerToggleButton]");
    await profiler.waitForText("native-recording", "Profiling is in progress...");
    await profiler.snapshot("native-recording-snapshot");
  }

  async finishRecording(expectedCommits: number): Promise<void> {
    const profiler = await this.driver(await this.selectPanel("Profiler"));
    await profiler.click("native-stop-profile", "[data-testname=ProfilerToggleButton]");
    await profiler.waitFor(
      "native-profile-data-ready",
      'document.querySelector("[data-testname=SnapshotSelector-Input]") !== null',
    );
    const rootOptions = z
      .array(z.object({ name: z.string(), value: z.string() }))
      .parse(
        await profiler.evaluate(
          "native-profile-roots",
          'Array.from(document.querySelectorAll("select option")).map(option => ({name: option.textContent, value: option.value}))',
        ),
      );
    if (rootOptions.length > 0) {
      const hostOptions = rootOptions.filter((option) => option.name === "HostApp");
      assert.equal(hostOptions.length, 1, "Native profile HostApp root is not unique.");
      const option = hostOptions[0];
      assert(option);
      await profiler.selectOption("native-select-HostApp-profile", "select", option.value);
    }
    const expression: string = `document.querySelector('[data-testname="SnapshotSelector-Label"]')?.textContent?.trim() === ${JSON.stringify(`/ ${expectedCommits}`)} && document.querySelector('[data-testname="SnapshotSelector-Input"]')?.value === "1"`;
    await profiler.waitFor("native-recorded-commits", expression);
    for (let index = 1; index <= expectedCommits; index++) {
      await profiler.waitFor(
        `native-profile-commit-${index}-index`,
        `document.querySelector('[data-testname="SnapshotSelector-Input"]')?.value === ${JSON.stringify(String(index))}`,
      );
      await profiler.waitFor(
        `native-profile-commit-${index}-HostApp`,
        'Array.from(document.querySelectorAll("button")).some(button => button.textContent?.trim() === "HostApp")',
      );
      await profiler.snapshot(`native-profile-commit-${index}`);
      if (index < expectedCommits)
        await profiler.click("native-next-commit", "[data-testname=SnapshotSelector-NextButton]");
    }
  }

  async closeNativeWindowForLoss(): Promise<void> {
    await this.assertWindowPreserved();
    const window = await this.driver(this.windowId);
    await window.clickRole("native-user-Close-loss-only", "button", "Close");
    await waitForNativeReactCondition(
      "actual fixture-owned native window closed by trusted input",
      async () => !(await readNativeReactTargets(this.options.endpoint)).some((target) => target.id === this.windowId),
    );
    // The closed window's connection ended with it.
    this.drivers.delete(this.windowId);
  }
}
