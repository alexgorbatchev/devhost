import { renderHook, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useToolbarPopoverId } from "../useToolbarPopoverId";
import { factory_toolbarPanelWrapper } from "./fixtures";

describe("useToolbarPopoverId", () => {
  test("returns the id of the enclosing toolbar popover panel, the one its trigger targets", () => {
    const hook = renderHook(() => useToolbarPopoverId(), { wrapper: factory_toolbarPanelWrapper() });
    const panelId: string = screen.getByTestId("ToolbarPopover--panel").id;

    expect(panelId).not.toBe("");
    expect(hook.result.current).toBe(panelId);
    expect(screen.getByRole("button", { name: "Show sessions" }).getAttribute("popovertarget")).toBe(panelId);
  });

  test("returns undefined outside a toolbar popover panel", () => {
    const hook = renderHook(() => useToolbarPopoverId());

    expect(hook.result.current).toBeUndefined();
  });
});
