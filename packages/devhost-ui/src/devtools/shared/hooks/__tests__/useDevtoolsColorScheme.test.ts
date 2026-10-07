import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useDevtoolsColorScheme } from "../useDevtoolsColorScheme";
import { factory_colorSchemeWrapper } from "./fixtures";

describe("useDevtoolsColorScheme", () => {
  test("returns the color scheme of the enclosing provider", () => {
    const darkHook = renderHook(() => useDevtoolsColorScheme(), { wrapper: factory_colorSchemeWrapper("dark") });
    const lightHook = renderHook(() => useDevtoolsColorScheme(), { wrapper: factory_colorSchemeWrapper("light") });

    expect(darkHook.result.current).toBe("dark");
    expect(lightHook.result.current).toBe("light");
  });

  test("throws outside a provider", () => {
    expect(() => renderHook(() => useDevtoolsColorScheme())).toThrow(
      "Devtools color scheme is unavailable outside ColorSchemeProvider.",
    );
  });
});
