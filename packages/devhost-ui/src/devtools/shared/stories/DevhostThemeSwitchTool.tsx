import React, { type CSSProperties, type JSX } from "react";
import { useGlobals } from "storybook/manager-api";

import type { DevtoolsColorScheme } from "../devtoolsTheme";
import { storybookDevtoolsThemeGlobalName } from "./storybookThemeGlobals";

export function DevhostThemeSwitchTool(): JSX.Element {
  const [globals, updateGlobals] = useGlobals();
  const colorScheme: DevtoolsColorScheme = globals[storybookDevtoolsThemeGlobalName] === "light" ? "light" : "dark";

  function selectColorScheme(nextColorScheme: DevtoolsColorScheme): void {
    updateGlobals({ [storybookDevtoolsThemeGlobalName]: nextColorScheme });
  }

  return (
    <div
      aria-label="Devhost UI color scheme"
      data-testid="DevhostThemeSwitchTool"
      role="group"
      style={themeSwitchStyle}
    >
      <button
        aria-pressed={colorScheme === "light"}
        onClick={(): void => selectColorScheme("light")}
        style={colorScheme === "light" ? activeThemeButtonStyle : inactiveThemeButtonStyle}
        title="Use light preview theme"
        type="button"
      >
        Light
      </button>
      <button
        aria-pressed={colorScheme === "dark"}
        onClick={(): void => selectColorScheme("dark")}
        style={colorScheme === "dark" ? activeThemeButtonStyle : inactiveThemeButtonStyle}
        title="Use dark preview theme"
        type="button"
      >
        Dark
      </button>
    </div>
  );
}

const themeSwitchStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(0, 0, 0, 0.06)",
  border: "1px solid rgba(0, 0, 0, 0.12)",
  borderRadius: "6px",
  display: "inline-flex",
  gap: "2px",
  marginInline: "6px",
  padding: "2px",
};

const themeButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: "4px",
  cursor: "pointer",
  font: "inherit",
  fontSize: "12px",
  lineHeight: "16px",
  padding: "3px 8px",
};

const activeThemeButtonStyle: CSSProperties = {
  ...themeButtonStyle,
  background: "#029cfd",
  color: "#ffffff",
};

const inactiveThemeButtonStyle: CSSProperties = {
  ...themeButtonStyle,
  background: "transparent",
  color: "inherit",
};
