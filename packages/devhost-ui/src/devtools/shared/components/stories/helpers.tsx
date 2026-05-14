import React, { type CSSProperties, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import { useGlobals } from "storybook/manager-api";

import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../constants";
import type { DevtoolsColorScheme } from "../../DevtoolsColorScheme";
import { installDevtoolsStyles } from "../../devtoolsStyles";
import { readStorybookDevtoolsColorScheme, storybookDevtoolsThemeGlobalName } from "../../storybookTheme";
import { ColorSchemeProvider } from "../ColorSchemeProvider";

interface IDevtoolsStoryShadowRootProps {
  children: ReactNode;
}

export const devtoolsStoryShadowRootHostTestId: string = "DevtoolsStoryShadowRoot";

export function renderInDevtoolsStoryShadowRoot(children: ReactNode): JSX.Element {
  return <DevtoolsStoryShadowRoot>{children}</DevtoolsStoryShadowRoot>;
}

export function readShadowRoot(hostElement: HTMLElement, errorMessage: string): ShadowRoot {
  const shadowRoot: ShadowRoot | null = hostElement.shadowRoot;

  if (shadowRoot === null) {
    throw new Error(errorMessage);
  }

  return shadowRoot;
}

function DevtoolsStoryShadowRoot(props: IDevtoolsStoryShadowRootProps): JSX.Element {
  const hostElementReference = useRef<HTMLDivElement | null>(null);
  const [shadowMountNode, setShadowMountNode] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const hostElement: HTMLDivElement | null = hostElementReference.current;

    if (hostElement === null) {
      return;
    }

    const shadowRoot: ShadowRoot = hostElement.shadowRoot ?? hostElement.attachShadow({ mode: "open" });
    const mountNode: HTMLDivElement = document.createElement("div");

    mountNode.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
    shadowRoot.append(mountNode);

    installDevtoolsStyles(shadowRoot);
    setShadowMountNode(mountNode);

    return () => {
      setShadowMountNode(null);
      mountNode.remove();
    };
  }, []);

  return (
    <div data-testid={devtoolsStoryShadowRootHostTestId} ref={hostElementReference}>
      {shadowMountNode ? createPortal(props.children, shadowMountNode) : null}
    </div>
  );
}

interface IStorybookThemeProviderProps {
  children: ReactNode;
  globals: Partial<Record<string, unknown>>;
}

export function StorybookThemeProvider(props: IStorybookThemeProviderProps): JSX.Element {
  const colorScheme: DevtoolsColorScheme = readStorybookDevtoolsColorScheme(props.globals);

  return (
    <ColorSchemeProvider colorScheme={colorScheme}>
      <div className="contents" data-devhost-story-theme="" data-theme={colorScheme}>
        {props.children}
      </div>
    </ColorSchemeProvider>
  );
}

interface IStoryContainerProps {
  children: ReactNode;
  align?: "left" | "right" | "center";
}

export function StoryContainer({ children, align = "center" }: IStoryContainerProps): JSX.Element {
  let justifyContent = "center";
  if (align === "left") {
    justifyContent = "flex-start";
  } else if (align === "right") {
    justifyContent = "flex-end";
  }

  return (
    <div
      data-testid="StoryContainer"
      style={{
        border: "1px dashed rgba(150, 150, 150, 0.4)",
        borderRadius: "4px",
        display: "flex",
        justifyContent,
        minHeight: "100px",
        padding: "50px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "4px",
          left: "8px",
          fontSize: "10px",
          color: "rgba(150, 150, 150, 0.6)",
          fontFamily: "monospace",
        }}
      >
        StoryContainer ({align})
      </div>
      {children}
    </div>
  );
}

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
