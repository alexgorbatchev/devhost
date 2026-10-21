import assert from "node:assert/strict";
import { resolve } from "node:path";
import CDP from "chrome-remote-interface";
import { z } from "zod";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";

interface IPoint {
  x: number;
  y: number;
}

export interface INativeReactTab {
  name: string;
  isSelected: boolean;
}

type AccessibilityNode = Awaited<ReturnType<CDP.Client["Accessibility"]["queryAXTree"]>>["nodes"][number];

const pointSchema = z.object({ x: z.number(), y: z.number() }).nullable();

// DevTools' next-panel shortcut is Command+] on macOS and Control+] elsewhere.
const nextPanelModifier = process.platform === "darwin" ? 4 : 2;

let evidenceSequence: number = 0;

// Drives one browser target, such as the native DevTools window or an extension panel inside it, over its own
// debugging WebSocket. Clicks and key presses are dispatched as browser input, so the page receives trusted events.
export class NativeReactTargetDriver {
  private readonly client: CDP.Client;
  private readonly evidencePath: string;
  readonly targetId: string;

  private constructor(client: CDP.Client, targetId: string, evidencePath: string) {
    this.client = client;
    this.targetId = targetId;
    this.evidencePath = evidencePath;
  }

  static async connect(
    webSocketDebuggerUrl: string,
    targetId: string,
    evidencePath: string,
  ): Promise<NativeReactTargetDriver> {
    const client = await CDP({ target: webSocketDebuggerUrl, local: true });
    // Accessibility queries answer from a tree that the domain keeps once it is enabled.
    await client.Accessibility.enable();
    return new NativeReactTargetDriver(client, targetId, evidencePath);
  }

  private async record(label: string, value: unknown): Promise<void> {
    const name = `${String(++evidenceSequence).padStart(3, "0")}-${label}.json`;
    await Bun.write(resolve(this.evidencePath, name), JSON.stringify({ targetId: this.targetId, value }, null, 2));
  }

  // Evaluates an expression in the target and returns its JSON value.
  async evaluate(label: string, expression: string): Promise<unknown> {
    const { result, exceptionDetails } = await this.client.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails !== undefined) {
      throw new Error(`${label}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    await this.record(label, result.value);
    return result.value;
  }

  async waitFor(label: string, expression: string): Promise<void> {
    await waitForNativeReactCondition(label, async () => (await this.evaluate(label, expression)) === true);
  }

  async waitForText(label: string, text: string): Promise<void> {
    await this.waitFor(label, `document.body.innerText.includes(${JSON.stringify(text)})`);
  }

  async scrollIntoView(label: string, selector: string): Promise<void> {
    await this.evaluate(
      label,
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center", inline: "center" }), true`,
    );
  }

  private async clickPoint(point: IPoint): Promise<void> {
    await this.client.Input.dispatchMouseEvent({ type: "mouseMoved", x: point.x, y: point.y });
    await this.client.Input.dispatchMouseEvent({ type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await this.client.Input.dispatchMouseEvent({ type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  }

  // Clicks the center of the index-th element the selector matches, after scrolling it into view.
  async click(label: string, selector: string, index: number = 0): Promise<void> {
    const value = await this.evaluate(
      label,
      `(() => {
        const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        if (!(element instanceof Element)) return null;
        element.scrollIntoView({ block: "center", inline: "center" });
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0
          ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
          : null;
      })()`,
    );
    const point = pointSchema.parse(value);
    assert(point !== null, `${label}: ${selector} [${index}] is not a visible element`);
    await this.clickPoint(point);
  }

  private async findAccessibleNodes(role: string, name: string): Promise<AccessibilityNode[]> {
    const { root } = await this.client.DOM.getDocument({ depth: 0 });
    const { nodes } = await this.client.Accessibility.queryAXTree({ nodeId: root.nodeId, role, accessibleName: name });
    return nodes;
  }

  // Clicks the one element with this accessible role and exact name.
  async clickRole(label: string, role: string, name: string): Promise<void> {
    const nodes = await this.findAccessibleNodes(role, name);
    assert.equal(nodes.length, 1, `${label}: ${role} "${name}" is not unique`);
    const backendNodeId = nodes[0]?.backendDOMNodeId;
    assert(backendNodeId !== undefined, `${label}: ${role} "${name}" has no DOM node`);
    await this.client.DOM.scrollIntoViewIfNeeded({ backendNodeId });
    const { model } = await this.client.DOM.getBoxModel({ backendNodeId });
    const [x1, y1, , , x3, y3] = model.content;
    assert(x1 !== undefined && y1 !== undefined && x3 !== undefined && y3 !== undefined);
    await this.record(label, { role, name, box: model.content });
    await this.clickPoint({ x: (x1 + x3) / 2, y: (y1 + y3) / 2 });
  }

  // Reads every tab in the target's accessibility tree, in document order, and which one is selected.
  async readTabs(label: string): Promise<INativeReactTab[]> {
    const { nodes } = await this.client.Accessibility.getFullAXTree({});
    const tabs = nodes.flatMap((node) =>
      node.role?.value === "tab"
        ? [
            {
              name: String(node.name?.value ?? ""),
              isSelected:
                node.properties?.some((property) => property.name === "selected" && property.value.value === true) ??
                false,
            },
          ]
        : [],
    );
    await this.record(label, tabs);
    return tabs;
  }

  async pressNextPanel(label: string): Promise<void> {
    const key = { key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, modifiers: nextPanelModifier };
    await this.client.Input.dispatchKeyEvent({ type: "rawKeyDown", ...key });
    await this.client.Input.dispatchKeyEvent({ type: "keyUp", ...key });
    await this.record(label, key);
  }

  // Chooses an option of a select element, as a user choosing it does: the value changes and change fires.
  async selectOption(label: string, selector: string, value: string): Promise<void> {
    await this.evaluate(
      label,
      `(() => {
        const select = document.querySelector(${JSON.stringify(selector)});
        if (!(select instanceof HTMLSelectElement)) throw new Error("not a select element");
        select.value = ${JSON.stringify(value)};
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return select.value;
      })()`,
    );
  }

  // Records the target's accessibility tree as evidence.
  async snapshot(label: string): Promise<void> {
    const { nodes } = await this.client.Accessibility.getFullAXTree({});
    await this.record(
      label,
      nodes.flatMap((node) => (node.ignored ? [] : [{ role: node.role?.value, name: node.name?.value }])),
    );
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
