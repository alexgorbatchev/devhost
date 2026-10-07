import assert from "node:assert/strict";
import type { Page } from "playwright";

interface INativeReactDockGeometry {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  hasNativeHit: boolean;
  hasVisibleText: boolean;
}

export async function assertNativeReactDockLayout(page: Page): Promise<INativeReactDockGeometry[]> {
  const readout = page.getByRole("region", { name: "Native browser control status", exact: true });
  await readout.waitFor();
  const viewport = page.viewportSize();
  assert(viewport);
  const command = page
    .getByTestId("DevtoolsToolbar--readout")
    .getByRole("button", { name: /^(?:Connect|Disconnect) browser control$/ });
  assert.equal(await command.count(), 1, "The dock must own one native browser connection command.");
  const elements = [
    command,
    page.getByTestId("DevtoolsToolbar--bar"),
    readout,
    ...(await readout.locator("p").all()),
    ...(await readout.getByRole("button").all()),
  ];
  const geometries: INativeReactDockGeometry[] = [];
  for (const locator of elements) {
    const geometry: INativeReactDockGeometry = await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const root = element.getRootNode();
      const hit =
        root instanceof ShadowRoot
          ? root.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          : null;
      const style = getComputedStyle(element);
      return {
        text: element.textContent ?? "",
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
        hasNativeHit: hit !== null && (hit === element || element.contains(hit)),
        hasVisibleText: style.visibility === "visible" && style.display !== "none" && style.textOverflow !== "ellipsis",
      };
    });
    assert(geometry.left >= 0 && geometry.right <= viewport.width, JSON.stringify(geometry));
    assert(geometry.top >= 0 && geometry.bottom <= viewport.height, JSON.stringify(geometry));
    assert(geometry.height > 0);
    assert.equal(geometry.hasNativeHit, true, JSON.stringify(geometry));
    assert.equal(geometry.hasVisibleText, true);
    geometries.push(geometry);
  }
  const bar = geometries[1];
  assert(bar);
  assert.equal(bar.height, 26, "Existing inner command bar height must remain unchanged.");
  return geometries;
}
