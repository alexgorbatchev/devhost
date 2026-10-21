import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useTabShare } from "../useTabShare";
import { createSharedTabFixture } from "../../__tests__/helpers";

test("retains the approved tab until stopped and releases it on unmount", async () => {
  const fixture = createSharedTabFixture();
  const picker = vi.spyOn(navigator.mediaDevices, "getDisplayMedia").mockResolvedValue(fixture.stream);
  const hook = renderHook(() => useTabShare());
  try {
    await act(async () => {
      await hook.result.current.share();
    });
    expect(hook.result.current.stream).toBe(fixture.stream);
    expect(fixture.stream.active).toBe(true);
    act(() => hook.result.current.stop());
    expect(hook.result.current.stream).toBeUndefined();
    expect(fixture.stream.active).toBe(false);
    const next = createSharedTabFixture();
    picker.mockResolvedValue(next.stream);
    await act(async () => {
      await hook.result.current.share();
    });
    hook.unmount();
    expect(next.stream.active).toBe(false);
  } finally {
    hook.unmount();
    picker.mockRestore();
    fixture.track.stop();
  }
});

test("shows denied sharing and releases a late grant after unmount", async () => {
  const picker = vi.spyOn(navigator.mediaDevices, "getDisplayMedia").mockRejectedValue(new Error("Sharing denied"));
  const hook = renderHook(() => useTabShare());
  const fixture = createSharedTabFixture();
  try {
    await act(async () => {
      await hook.result.current.share();
    });
    expect(hook.result.current.error).toBe("Sharing denied");
    const pending = Promise.withResolvers<MediaStream>();
    picker.mockReturnValue(pending.promise);
    let share: Promise<void>;
    act(() => {
      share = hook.result.current.share();
    });
    hook.unmount();
    await act(async () => {
      pending.resolve(fixture.stream);
      await share;
    });
    expect(fixture.stream.active).toBe(false);
  } finally {
    hook.unmount();
    picker.mockRestore();
    fixture.track.stop();
  }
});
