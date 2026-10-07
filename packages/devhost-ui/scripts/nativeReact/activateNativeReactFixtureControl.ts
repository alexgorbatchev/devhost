import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";

interface INativeReactFixtureInput {
  type: string;
  key: string | null;
  isTrusted: boolean;
}

export async function activateNativeReactFixtureControl(
  page: Page,
  name: string,
  outputPath: string,
  evidenceLabel: string = name,
): Promise<void> {
  const button = await page.getByRole("button", { name, exact: true }).elementHandle();
  assert(button, "The real fixture control is missing.");
  const geometry = await button.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      hitElement: hit?.outerHTML.slice(0, 300),
      isPointerTarget: hit === element || element.contains(hit),
      viewport: { width: innerWidth, height: innerHeight },
      docks: Array.from(document.querySelectorAll("[data-devhost-devtools]")).map((host) => {
        const style = getComputedStyle(host);
        const dock = host.shadowRoot?.querySelector('[data-testid="DevtoolsToolbar"]');
        const dockBounds = dock?.getBoundingClientRect();
        return {
          id: host.id,
          display: style.display,
          pointerEvents: style.pointerEvents,
          dockBounds: dockBounds && {
            left: dockBounds.left,
            top: dockBounds.top,
            right: dockBounds.right,
            bottom: dockBounds.bottom,
          },
        };
      }),
    };
  });
  const observer = await button.evaluateHandle((element) => {
    const inputs: INativeReactFixtureInput[] = [];
    const record = (event: Event): void => {
      inputs.push({
        type: event.type,
        key: event instanceof KeyboardEvent ? event.key : null,
        isTrusted: event.isTrusted,
      });
    };
    document.addEventListener("keydown", record);
    document.addEventListener("keyup", record);
    element.addEventListener("click", record);
    return {
      inputs,
      dispose: (): void => {
        document.removeEventListener("keydown", record);
        document.removeEventListener("keyup", record);
        element.removeEventListener("click", record);
      },
    };
  });
  try {
    await page.bringToFront();
    await waitForNativeReactCondition("native Tab reaches the exact existing fixture control", async () => {
      if (await button.evaluate((element) => document.activeElement === element)) return true;
      await page.keyboard.press("Tab");
      return button.evaluate((element) => document.activeElement === element);
    });
    const isOriginalControlFocused = await button.evaluate(
      (element) => element.isConnected && document.activeElement === element,
    );
    assert.equal(isOriginalControlFocused, true);
    await page.keyboard.press("Enter");
    const inputs = await observer.evaluate((value) => value.inputs);
    assert(inputs.length > 0);
    assert.equal(
      inputs.every((input) => input.isTrusted),
      true,
    );
    assert.equal(inputs.filter((input) => input.type === "keydown" && input.key === "Enter").length, 1);
    assert.equal(inputs.filter((input) => input.type === "click").length, 1);
    await Bun.write(
      resolve(outputPath, "fixture-" + evidenceLabel.replaceAll(" ", "-").toLowerCase() + "-keyboard.json"),
      JSON.stringify({ name, geometry, isOriginalControlFocused, inputs }, null, 2),
    );
  } finally {
    await observer.evaluate((value) => value.dispose());
    await observer.dispose();
    await button.dispose();
  }
}
