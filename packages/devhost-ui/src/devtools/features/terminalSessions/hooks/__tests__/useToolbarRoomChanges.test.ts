import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, onTestFinished, test } from "vitest";
import { page } from "vitest/browser";

import { placeElement, waitForAnimationFrame } from "../../../../../../test-support/hostPageUtils";
import { useToolbarRoomChanges } from "../useToolbarRoomChanges";

type PageChange = () => Promise<void> | void;

interface IRoomChangesProps {
  isSegmentRendered: boolean;
}

// A toolbar of a stated size holding a segment of a stated size, so each test changes exactly one of them.
let toolbar: HTMLDivElement;
let segment: HTMLDivElement;

function renderRoomChanges(isSegmentRendered: boolean = true): RenderHookResult<number, IRoomChangesProps> {
  // One reference for every render, as `useRef` gives a component.
  const segmentReference: RefObject<HTMLElement | null> = { current: segment };

  return renderHook((props: IRoomChangesProps) => useToolbarRoomChanges(segmentReference, props.isSegmentRendered), {
    initialProps: { isSegmentRendered },
  });
}

// The browser reports a resize to its observers once per frame, after that frame's animation callbacks. Two frames
// after a change, every report it caused has been delivered.
async function settle(change?: PageChange): Promise<void> {
  await act(async (): Promise<void> => {
    await change?.();
    await waitForAnimationFrame();
    await waitForAnimationFrame();
  });
}

beforeEach(() => {
  toolbar = document.createElement("div");
  segment = document.createElement("div");
  placeElement(toolbar, { height: 30, width: 600, x: 10, y: 10 });
  Object.assign(segment.style, { height: "20px", width: "200px" });
  toolbar.append(segment);
  document.body.append(toolbar);
});

describe("useToolbarRoomChanges", () => {
  test("counts a change when the segment itself is resized", async () => {
    const hook = renderRoomChanges();

    await settle();

    const settledCount: number = hook.result.current;

    await settle((): void => {
      segment.style.width = "120px";
    });
    expect(hook.result.current).toBe(settledCount + 1);
    expect(toolbar.getBoundingClientRect().width).toBe(600);
  });

  test("counts a change when the toolbar is resized around a segment that keeps its size", async () => {
    const hook = renderRoomChanges();

    await settle();

    const settledCount: number = hook.result.current;

    await settle((): void => {
      toolbar.style.width = "480px";
    });
    expect(hook.result.current).toBe(settledCount + 1);
    expect(segment.getBoundingClientRect().width).toBe(200);
  });

  test("counts a change when the viewport is resized, though neither the toolbar nor the segment is", async () => {
    const hook = renderRoomChanges();

    onTestFinished(async (): Promise<void> => {
      await page.viewport(1024, 768);
    });
    await settle();

    const settledCount: number = hook.result.current;

    await settle(async (): Promise<void> => {
      await page.viewport(1200, 768);
    });
    expect(hook.result.current).toBe(settledCount + 1);
    expect(toolbar.getBoundingClientRect().width).toBe(600);
    expect(segment.getBoundingClientRect().width).toBe(200);
  });

  test("counts nothing while its page stays as it is", async () => {
    const hook = renderRoomChanges();

    await settle();

    const settledCount: number = hook.result.current;

    await settle((): void => {
      segment.textContent = "three sessions";
    });
    expect(hook.result.current).toBe(settledCount);
  });

  test("watches only while the segment is rendered", async () => {
    const hook = renderRoomChanges(false);

    onTestFinished(async (): Promise<void> => {
      await page.viewport(1024, 768);
    });
    await settle(async (): Promise<void> => {
      segment.style.width = "120px";
      toolbar.style.width = "480px";
      await page.viewport(1200, 768);
    });
    expect(hook.result.current).toBe(0);

    hook.rerender({ isSegmentRendered: true });
    await settle();

    const watchingCount: number = hook.result.current;

    expect(watchingCount).toBeGreaterThan(0);

    hook.rerender({ isSegmentRendered: false });
    await settle(async (): Promise<void> => {
      segment.style.width = "160px";
      toolbar.style.width = "520px";
      await page.viewport(1100, 768);
    });
    expect(hook.result.current).toBe(watchingCount);
  });

  test("stops watching when it unmounts", async () => {
    const hook = renderRoomChanges();

    await settle();

    const settledCount: number = hook.result.current;

    hook.unmount();
    await settle((): void => {
      segment.style.width = "120px";
    });
    expect(hook.result.current).toBe(settledCount);
  });
});
