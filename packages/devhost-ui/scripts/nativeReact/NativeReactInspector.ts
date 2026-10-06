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
const nativeWindowSchema = z.object({ targetId: z.string() });

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
        const current = nativeWindowSchema.parse(value).targetId;
        if (current.length === 0) return false;
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
    const hostRowResult = await this.options.automation.run(targetId, "native-unique-HostApp-row", [
      "eval",
      'Array.from(document.querySelectorAll("[data-testname=ComponentTreeListItem]")).flatMap((element,index) => element.textContent === "HostApp" ? [index] : [])',
    ]);
    const rowIndices = z.array(z.number().int().nonnegative()).parse(JSON.parse(hostRowResult));
    assert.equal(rowIndices.length, 1, "Native HostApp row is not unique.");
    const rowIndex = rowIndices[0];
    assert(rowIndex !== undefined);
    await this.options.automation.run(targetId, "select-native-HostApp", [
      "find",
      "nth",
      String(rowIndex),
      "[data-testname=ComponentTreeListItem]",
      "click",
    ]);
    const projectValue: string = JSON.stringify(this.options.projectName);
    const expression: string = `Array.from(document.querySelectorAll("input")).some(input => input.value === ${JSON.stringify(projectValue)}) && Array.from(document.querySelectorAll("input")).some(input => input.value === ${JSON.stringify(String(count))})`;
    await this.options.automation.run(targetId, `native-props-state-${count}`, ["wait", "--fn", expression]);
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
