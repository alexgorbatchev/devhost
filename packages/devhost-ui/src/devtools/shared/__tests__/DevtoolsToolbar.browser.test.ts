import { waitFor, within } from "@testing-library/react";
import { assert, afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { DevtoolsPosition } from "../devtoolsConfig";
import { readDevtoolsStoryShadowCanvas } from "../components/stories/helpers";
import { renderResponsiveToolbar, renderResponsiveToolbarWithReadout, settleToolbar } from "./helpers";

afterEach(async () => {
  await settleToolbar(async () => page.viewport(1024, 768));
});

function expectControlsWithinToolbar(toolbar: HTMLElement): void {
  const bounds = toolbar.getBoundingClientRect();
  const root = toolbar.getRootNode();
  assert(root instanceof ShadowRoot);
  for (const control of within(toolbar).getAllByRole("button")) {
    const rectangle = control.getBoundingClientRect();
    expect(rectangle.left).toBeGreaterThanOrEqual(bounds.left);
    expect(rectangle.right).toBeLessThanOrEqual(bounds.right);
    expect(rectangle.top).toBeGreaterThanOrEqual(bounds.top);
    expect(rectangle.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect(
      control.contains(root.elementFromPoint(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2)),
    ).toBe(true);
  }
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
}

describe("responsive toolbar", () => {
  test.each<DevtoolsPosition>(["bottom-right", "top-right"])(
    "keeps controls reachable while resizing the %s dock beside the minimap",
    async (position) => {
      await settleToolbar(async () => page.viewport(1280, 720));
      const view = await renderResponsiveToolbar({ isMinimapVisible: true, position });
      const canvas = await readDevtoolsStoryShadowCanvas(view.container);
      const toolbar = canvas.getByRole("toolbar", { name: "devhost" });
      expect(toolbar.getBoundingClientRect().height).toBe(26);

      for (const width of [768, 640, 480, 375, 320, 768, 1280]) {
        await settleToolbar(async () => page.viewport(width, 768));
        await waitFor(() => expectControlsWithinToolbar(toolbar));
        expect(toolbar.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
        expect(toolbar.getBoundingClientRect().right).toBeLessThan(width - 8);
      }
      expect(toolbar.getBoundingClientRect().height).toBe(26);

      await settleToolbar(async () => page.viewport(320, 768));
      await waitFor(() => expectControlsWithinToolbar(toolbar));
      await settleToolbar(() => userEvent.click(canvas.getByRole("button", { name: "Worktrees" })));
      await waitFor(() => expect(canvas.getByRole("region", { name: "Worktrees" })).toBeVisible());
      await settleToolbar(() => userEvent.keyboard("{Escape}"));
      await settleToolbar(() => userEvent.click(canvas.getByRole("button", { name: "Collapse devhost toolbar" })));
      expect(toolbar.getBoundingClientRect().height).toBe(26);
      await settleToolbar(() => userEvent.click(canvas.getByRole("button", { name: "Expand devhost toolbar" })));
      await waitFor(() => expectControlsWithinToolbar(toolbar));
      await settleToolbar(() => userEvent.keyboard("{Tab}{Tab}{Enter}"));
      await waitFor(() => expect(canvas.getByRole("region", { name: "Worktrees" })).toBeVisible());
      await settleToolbar(() => userEvent.keyboard("{Escape}"));
    },
  );

  test.each<DevtoolsPosition>(["bottom-right", "top-right"])(
    "keeps the wrapped %s toolbar onscreen with a tall browser readout",
    async (position) => {
      await settleToolbar(async () => page.viewport(320, 480));
      const view = await renderResponsiveToolbarWithReadout({ isMinimapVisible: true, position });
      const canvas = await readDevtoolsStoryShadowCanvas(view.container);
      const dock = canvas.getByTestId("DevtoolsToolbar");
      const toolbar = canvas.getByRole("toolbar", { name: "devhost" });
      await waitFor(() => {
        expect(dock.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
        expect(dock.getBoundingClientRect().bottom).toBeLessThanOrEqual(472);
        expectControlsWithinToolbar(toolbar);
      });
      const readout = canvas.getByTestId("DevtoolsToolbar--readout");
      expect(readout.scrollHeight).toBeGreaterThan(readout.clientHeight);
    },
  );

  test("fits long stack and branch names on a narrow screen without the minimap", async () => {
    await settleToolbar(async () => page.viewport(320, 768));
    const view = await renderResponsiveToolbar({
      isMinimapVisible: false,
      position: "bottom-right",
      stackName: "a-very-long-project-name-that-exceeds-the-mobile-viewport",
      branchName: "feature/a-very-long-branch-name-that-exceeds-the-mobile-viewport",
    });
    const canvas = await readDevtoolsStoryShadowCanvas(view.container);
    const toolbar = canvas.getByRole("toolbar", { name: "devhost" });
    await waitFor(() => expectControlsWithinToolbar(toolbar));
    expect(canvas.getByRole("button", { name: "Worktrees" })).toHaveAttribute(
      "title",
      "Worktrees: feature/a-very-long-branch-name-that-exceeds-the-mobile-viewport",
    );
    expect(toolbar.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
    await settleToolbar(() => userEvent.click(canvas.getByRole("button", { name: "Collapse devhost toolbar" })));
    await settleToolbar(() => userEvent.click(canvas.getByRole("button", { name: "Expand devhost toolbar" })));
    await waitFor(() => expectControlsWithinToolbar(toolbar));
  });
});
