import React from "react";
import type { CSSProperties, JSX } from "react";

import type { DevtoolsColorScheme } from "../DevtoolsColorScheme";

export interface IDevhostThemeSwitchToolProps {
  colorScheme: DevtoolsColorScheme;
  onSelectColorScheme: (nextColorScheme: DevtoolsColorScheme) => void;
}

export function DevhostThemeSwitchTool({
  colorScheme,
  onSelectColorScheme,
}: IDevhostThemeSwitchToolProps): JSX.Element {
  return (
    <div aria-label="Devhost UI color scheme" data-testid="DevhostThemeSwitchTool" role="group" style={toolStyle}>
      <button
        aria-label="Use light preview theme"
        aria-pressed={colorScheme === "light"}
        style={colorScheme === "light" ? activeButtonStyle : inactiveButtonStyle}
        title="Use light preview theme"
        type="button"
        onClick={(): void => onSelectColorScheme("light")}
      >
        Light
      </button>
      <button
        aria-label="Use dark preview theme"
        aria-pressed={colorScheme === "dark"}
        style={colorScheme === "dark" ? activeButtonStyle : inactiveButtonStyle}
        title="Use dark preview theme"
        type="button"
        onClick={(): void => onSelectColorScheme("dark")}
      >
        Dark
      </button>
    </div>
  );
}

const toolStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(0, 0, 0, 0.06)",
  border: "1px solid rgba(0, 0, 0, 0.12)",
  borderRadius: "6px",
  display: "inline-flex",
  gap: "2px",
  marginInline: "6px",
  padding: "2px",
};

const buttonStyle: CSSProperties = {
  border: 0,
  borderRadius: "4px",
  cursor: "pointer",
  font: "inherit",
  fontSize: "12px",
  lineHeight: "16px",
  padding: "3px 8px",
};

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#029cfd",
  color: "#ffffff",
};

const inactiveButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  color: "inherit",
};
