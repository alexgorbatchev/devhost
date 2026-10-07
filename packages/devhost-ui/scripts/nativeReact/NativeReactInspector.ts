import assert from "node:assert/strict";
import { z } from "zod";
import type { Browser, Page } from "playwright";
import { readNativeReactTargets } from "./readNativeReactTargets";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import type { INativeReactAutomation } from "./types";

interface INativeReactInspectorOptions {
  browser: Browser;
  host: Page;
  endpoint: string;
  extensionId: string;
  automation: INativeReactAutomation;
  projectName: string;
}

type NativeReactPanel = "Components" | "Profiler";
const targetInfoSchema = z.object({ targetInfo: z.object({ targetId: z.string() }) });
const nativeWindowSchema = z.object({ targetId: z.string().optional() });

export class NativeReactInspector {
  readonly options: INativeReactInspectorOptions;
  private windowId: string = "";
  private readonly panels = new Map<NativeReactPanel, string>();

  constructor(options: INativeReactInspectorOptions) {
    this.options = options;
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
    await this.options.automation.run(this.windowId, `${panel}-window-before-activation`, [
      "eval",
      'JSON.stringify({visibility:document.visibilityState,hasFocus:document.hasFocus(),selected:Array.from(document.querySelectorAll("[role=tab][aria-selected=true]")).map(tab=>tab.textContent)})',
    ]);
    const activation = await this.options.browser.newBrowserCDPSession();
    try {
      await activation.send("Target.activateTarget", { targetId: this.windowId });
    } finally {
      await activation.detach();
    }
    await this.options.automation.run(this.windowId, `${panel}-window-after-activation`, [
      "eval",
      'JSON.stringify({visibility:document.visibilityState,hasFocus:document.hasFocus(),selected:Array.from(document.querySelectorAll("[role=tab][aria-selected=true]")).map(tab=>tab.textContent)})',
    ]);
    const label: string = `${panel} ⚛`;
    let isSelected: boolean = false;
    for (let index = 0; index < 13; index++) {
      const snapshot = await this.options.automation.run(this.windowId, `${panel}-tab-${index}`, ["snapshot"]);
      if (snapshot.includes(`tab "${label}" [selected`)) {
        isSelected = true;
        break;
      }
      await this.options.automation.run(this.windowId, `${panel}-next-native-tab`, ["press", "Control+]"]);
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
    const targetId = await this.selectPanel("Components");
    await this.options.automation.run(targetId, "wait-native-HostApp", [
      "wait",
      "--fn",
      'Array.from(document.querySelectorAll("[data-testname=ComponentTreeListItem]")).some(element => element.textContent === "HostApp")',
    ]);
    await this.options.automation.run(targetId, "native-tree-before-HostApp-selection", ["snapshot"]);
    await this.options.automation.run(targetId, "native-HostApp-row-geometry", [
      "eval",
      'Array.from(document.querySelectorAll("[data-testname=ComponentTreeListItem]")).map(element => ({text:element.textContent, innerText:element.innerText, width:element.getBoundingClientRect().width, height:element.getBoundingClientRect().height, display:getComputedStyle(element).display, visibility:getComputedStyle(element).visibility}))',
    ]);
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
    const beforeScroll = await this.options.automation.run(targetId, "native-HostApp-wrapper-before-scroll", [
      "eval",
      wrapperExpression,
    ]);
    const scrollTarget = z
      .object({ text: z.literal("HostApp"), scrollSelector: z.string(), selectorMatches: z.literal(1) })
      .parse(JSON.parse(beforeScroll));
    await this.options.automation.run(targetId, "scroll-native-HostApp-label-into-view", [
      "scrollintoview",
      scrollTarget.scrollSelector,
    ]);
    await this.options.automation.run(targetId, "wait-native-HostApp-visible-label-hit", [
      "wait",
      "--fn",
      `(${wrapperExpression})?.isVisibleHit === true`,
    ]);
    const wrapperResult = await this.options.automation.run(targetId, "native-HostApp-visible-wrapper", [
      "eval",
      wrapperExpression,
    ]);
    const wrapper = z
      .object({ text: z.literal("HostApp"), index: z.number().int().nonnegative(), isVisibleHit: z.literal(true) })
      .parse(JSON.parse(wrapperResult));
    assert.equal(wrapper.isVisibleHit, true);
    await this.options.automation.run(targetId, "select-native-HostApp-visible-label", [
      "find",
      "nth",
      String(wrapper.index),
      "[data-testname=ComponentTreeListItem] > div",
      "click",
    ]);
    const projectValue: string = JSON.stringify(this.options.projectName);
    const expression: string = `Array.from(document.querySelectorAll("input")).some(input => input.value === ${JSON.stringify(projectValue)}) && Array.from(document.querySelectorAll("input")).some(input => input.value === ${JSON.stringify(String(count))})`;
    try {
      await this.options.automation.run(targetId, `native-props-state-${count}`, ["wait", "--fn", expression]);
    } catch (error) {
      const captures = await Promise.allSettled([
        this.options.automation.run(targetId, `native-failed-Components-${count}`, ["snapshot"]),
        this.options.automation.run(targetId, `native-failed-visibility-state-${count}`, [
          "eval",
          'JSON.stringify({visibility:document.visibilityState,hasFocus:document.hasFocus(),inputs:Array.from(document.querySelectorAll("input")).map(input=>({value:input.value,label:input.getAttribute("aria-label")}))})',
        ]),
      ]);
      const failures = captures.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
      if (failures.length > 0)
        throw new AggregateError([error, ...failures], "Native inspection failed; readonly capture also failed.");
      throw error;
    }
    await this.options.automation.run(targetId, `native-Components-${count}`, ["snapshot"]);
  }

  async startRecording(): Promise<void> {
    const targetId = await this.selectPanel("Profiler");
    // The pinned original frontend drops the accessible Start label after a
    // completed profile. Its genuine source-owned toggle remains unchanged.
    await this.options.automation.run(targetId, "native-start-profile", [
      "click",
      "[data-testname=ProfilerToggleButton]",
    ]);
    await this.options.automation.run(targetId, "native-recording", ["wait", "--text", "Profiling is in progress..."]);
    await this.options.automation.run(targetId, "native-recording-snapshot", ["snapshot"]);
  }

  async finishRecording(expectedCommits: number): Promise<void> {
    const targetId = await this.selectPanel("Profiler");
    await this.options.automation.run(targetId, "native-stop-profile", [
      "click",
      "[data-testname=ProfilerToggleButton]",
    ]);
    await this.options.automation.run(targetId, "native-profile-data-ready", [
      "wait",
      "--fn",
      'document.querySelector("[data-testname=SnapshotSelector-Input]") !== null',
    ]);
    const optionsResult = await this.options.automation.run(targetId, "native-profile-roots", [
      "eval",
      'Array.from(document.querySelectorAll("select option")).map(option => ({name: option.textContent, value: option.value}))',
    ]);
    const rootOptions = z.array(z.object({ name: z.string(), value: z.string() })).parse(JSON.parse(optionsResult));
    if (rootOptions.length > 0) {
      const hostOptions = rootOptions.filter((option) => option.name === "HostApp");
      assert.equal(hostOptions.length, 1, "Native profile HostApp root is not unique.");
      const option = hostOptions[0];
      assert(option);
      await this.options.automation.run(targetId, "native-select-HostApp-profile", ["select", "select", option.value]);
    }
    const expression: string = `document.querySelector('[data-testname="SnapshotSelector-Label"]')?.textContent?.trim() === ${JSON.stringify(`/ ${expectedCommits}`)} && document.querySelector('[data-testname="SnapshotSelector-Input"]')?.value === "1"`;
    await this.options.automation.run(targetId, "native-recorded-commits", ["wait", "--fn", expression]);
    for (let index = 1; index <= expectedCommits; index++) {
      await this.options.automation.run(targetId, `native-profile-commit-${index}-index`, [
        "wait",
        "--fn",
        `document.querySelector('[data-testname="SnapshotSelector-Input"]')?.value === ${JSON.stringify(String(index))}`,
      ]);
      await this.options.automation.run(targetId, `native-profile-commit-${index}-HostApp`, [
        "wait",
        "--fn",
        'Array.from(document.querySelectorAll("button")).some(button => button.textContent?.trim() === "HostApp")',
      ]);
      await this.options.automation.run(targetId, `native-profile-commit-${index}`, ["snapshot"]);
      if (index < expectedCommits)
        await this.options.automation.run(targetId, "native-next-commit", [
          "click",
          "[data-testname=SnapshotSelector-NextButton]",
        ]);
    }
  }

  async closeNativeWindowForLoss(): Promise<void> {
    await this.assertWindowPreserved();
    await this.options.automation.run(this.windowId, "native-user-Close-loss-only", [
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Close",
      "--exact",
    ]);
    await waitForNativeReactCondition(
      "actual fixture-owned native window closed by trusted input",
      async () => !(await readNativeReactTargets(this.options.endpoint)).some((target) => target.id === this.windowId),
    );
  }
}
