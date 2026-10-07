import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useRetainedValue } from "../useRetainedValue";

interface IRetainedValueProps {
  isActive: boolean;
  value: string | null;
}

function renderRetainedValue(initialProps: IRetainedValueProps) {
  return renderHook(({ isActive, value }: IRetainedValueProps) => useRetainedValue(value, isActive), {
    initialProps,
  });
}

describe("useRetainedValue", () => {
  test("returns the current value while active", () => {
    const hook = renderRetainedValue({ isActive: true, value: "first" });

    expect(hook.result.current).toBe("first");

    hook.rerender({ isActive: true, value: "second" });
    expect(hook.result.current).toBe("second");
  });

  test("keeps the last active value once inactive, whatever the value becomes", () => {
    const hook = renderRetainedValue({ isActive: true, value: "first" });

    hook.rerender({ isActive: true, value: "second" });
    hook.rerender({ isActive: false, value: null });
    expect(hook.result.current).toBe("second");

    hook.rerender({ isActive: false, value: "ignored" });
    expect(hook.result.current).toBe("second");
  });

  test("returns the new value when it becomes active again, and retains that one next", () => {
    const hook = renderRetainedValue({ isActive: true, value: "first" });

    hook.rerender({ isActive: false, value: null });
    hook.rerender({ isActive: true, value: "third" });
    expect(hook.result.current).toBe("third");

    hook.rerender({ isActive: false, value: null });
    expect(hook.result.current).toBe("third");
  });

  test("returns the value it mounted with until it has been active", () => {
    const hook = renderRetainedValue({ isActive: false, value: "initial" });

    expect(hook.result.current).toBe("initial");

    hook.rerender({ isActive: false, value: "later" });
    expect(hook.result.current).toBe("initial");
  });
});
