import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useScreenshotSelection } from "../useScreenshotSelection";
import { createScreenshotFixture } from "../../../../../../test-support/createScreenshotFixture";
import type { ITabSnapshot } from "../../types";

test("holds a screenshot until explicitly confirmed and clears its preview", async () => {
  const hook = renderHook(() => useScreenshotSelection(undefined));
  const snapshot = createScreenshotFixture();
  let pending!: Promise<ITabSnapshot>;
  act(() => {
    pending = hook.result.current.select(snapshot);
  });
  expect(hook.result.current.snapshot).toBe(snapshot);
  act(() => hook.result.current.confirm(snapshot));
  await expect(pending).resolves.toBe(snapshot);
  expect(hook.result.current.snapshot).toBeNull();
  hook.unmount();
});

test("cancels a pending preview when sharing changes or chat unmounts", async () => {
  const stream = new MediaStream();
  const hook = renderHook((current) => useScreenshotSelection(current), { initialProps: stream });
  let pending!: Promise<ITabSnapshot>;
  act(() => {
    pending = hook.result.current.select(createScreenshotFixture());
  });
  const cancelled = pending.catch((error: unknown) => error);
  hook.rerender(new MediaStream());
  await expect(cancelled).resolves.toEqual(
    new Error("Screenshot sharing cancelled. Your draft and page context have been retained."),
  );
  expect(hook.result.current.snapshot).toBeNull();
  act(() => {
    pending = hook.result.current.select(createScreenshotFixture());
  });
  const unmounted = pending.catch((error: unknown) => error);
  hook.unmount();
  await expect(unmounted).resolves.toEqual(
    new Error("Screenshot sharing cancelled. Your draft and page context have been retained."),
  );
});

test("ignores a crop completed for a cancelled preview after a new preview opens", async () => {
  const hook = renderHook(() => useScreenshotSelection(undefined));
  const first = createScreenshotFixture();
  let pending!: Promise<ITabSnapshot>;
  act(() => {
    pending = hook.result.current.select(first);
  });
  const oldConfirm = hook.result.current.confirm;
  const cancelled = pending.catch((error: unknown) => error);
  act(() => hook.result.current.cancel());
  await expect(cancelled).resolves.toEqual(
    new Error("Screenshot sharing cancelled. Your draft and page context have been retained."),
  );
  const next = first;
  act(() => {
    pending = hook.result.current.select(next);
  });
  act(() => oldConfirm(first));
  expect(hook.result.current.snapshot).toBe(next);
  act(() => hook.result.current.confirm(next));
  await expect(pending).resolves.toBe(next);
  hook.unmount();
});
