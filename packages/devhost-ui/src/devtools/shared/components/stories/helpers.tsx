import React, { type CSSProperties, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import { expect, within } from "storybook/test";

import { DEVTOOLS_ROOT_ID } from "../../constants";
import type { DevtoolsColorScheme } from "../../DevtoolsColorScheme";
import { installDevtoolsStyles } from "../../devtoolsStyles";
import { readStorybookDevtoolsColorScheme } from "../../storybookTheme";
import { ColorSchemeProvider } from "../ColorSchemeProvider";

interface IDevtoolsStoryShadowRootProps {
  children: ReactNode;
}

export const devtoolsStoryShadowRootHostTestId: string = "DevtoolsStoryShadowRoot";
// The mount node carries no marker, like the one `renderDevtools` creates, so stories find it through this map.
const storyMountNodes = new WeakMap<ShadowRoot, HTMLElement>();

/**
 * Renders a devtools component on its own inside a shadow root. In production every component sits in a surface of
 * the devtools root, so the component is wrapped in a stand-in for that root.
 */
export function renderInDevtoolsStoryShadowRoot(children: ReactNode): JSX.Element {
  return (
    <DevtoolsStoryShadowRoot>
      <DevtoolsStoryRoot>{children}</DevtoolsStoryRoot>
    </DevtoolsStoryShadowRoot>
  );
}

/**
 * Renders a tree that brings its own `DevtoolsTopLayer`, such as the app, inside a shadow root built like the one
 * `renderDevtools` builds.
 */
export function renderDevtoolsInStoryShadowRoot(devtools: ReactNode): JSX.Element {
  return <DevtoolsStoryShadowRoot>{devtools}</DevtoolsStoryShadowRoot>;
}

// Queries are scoped to the mount element rather than the ShadowRoot itself: testing-library cannot format a
// ShadowRoot in its failure messages, which turns a failed query into a hang until the test timeout.
export async function readDevtoolsStoryShadowCanvas(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const hostElement: HTMLElement = await within(canvasElement).findByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "The story did not attach a devtools shadow root.");
  const mountElement: HTMLElement | undefined = storyMountNodes.get(shadowRoot);

  if (mountElement === undefined) {
    throw new Error("The story shadow root has no devtools mount element.");
  }

  return within(mountElement);
}

export function readShadowRoot(hostElement: HTMLElement, errorMessage: string): ShadowRoot {
  const shadowRoot: ShadowRoot | null = hostElement.shadowRoot;

  if (shadowRoot === null) {
    throw new Error(errorMessage);
  }

  return shadowRoot;
}

/**
 * Asserts that the browser paints a devtools surface above everything else at its center, including host content
 * outside the story shadow root. Passive overlays are excluded from native hit testing, so the surface opts in only
 * while it is checked.
 */
export function expectDevtoolsSurfaceOnTop(shadowRoot: ShadowRoot, surface: HTMLElement): void {
  const rectangle: DOMRect = surface.getBoundingClientRect();
  const x: number = rectangle.left + rectangle.width / 2;
  const y: number = rectangle.top + rectangle.height / 2;

  surface.style.pointerEvents = "auto";
  try {
    expect(shadowRoot.ownerDocument.elementFromPoint(x, y)).toBe(shadowRoot.host);
    expect(surface.contains(shadowRoot.elementFromPoint(x, y))).toBe(true);
  } finally {
    surface.style.removeProperty("pointer-events");
  }
}

/**
 * Asserts that the browser paints `upperSurface` above `lowerSurface` where the two overlap. Passive overlays are
 * excluded from native hit testing, so both surfaces opt in only while they are checked.
 */
export function expectDevtoolsSurfaceAbove(
  shadowRoot: ShadowRoot,
  upperSurface: HTMLElement,
  lowerSurface: HTMLElement,
): void {
  const upperRectangle: DOMRect = upperSurface.getBoundingClientRect();
  const lowerRectangle: DOMRect = lowerSurface.getBoundingClientRect();
  const left: number = Math.max(upperRectangle.left, lowerRectangle.left);
  const right: number = Math.min(upperRectangle.right, lowerRectangle.right);
  const top: number = Math.max(upperRectangle.top, lowerRectangle.top);
  const bottom: number = Math.min(upperRectangle.bottom, lowerRectangle.bottom);

  // Paint order is only observable where the two surfaces overlap.
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);

  upperSurface.style.pointerEvents = "auto";
  lowerSurface.style.pointerEvents = "auto";
  try {
    expect(upperSurface.contains(shadowRoot.elementFromPoint((left + right) / 2, (top + bottom) / 2))).toBe(true);
  } finally {
    upperSurface.style.removeProperty("pointer-events");
    lowerSurface.style.removeProperty("pointer-events");
  }
}

type HostLayerCoverage = "inset" | "viewport";

/** Host-page layers at the highest z-index a page can use: across the viewport, or leaving a margin around it. */
export const hostLayerStyles: Record<HostLayerCoverage, CSSProperties> = {
  inset: {
    background: "white",
    inset: 100,
    margin: 0,
    padding: 40,
    position: "fixed",
    zIndex: 2147483647,
  },
  viewport: {
    background: "white",
    border: 0,
    height: "auto",
    inset: 0,
    margin: 0,
    padding: 40,
    position: "fixed",
    width: "auto",
    zIndex: 2147483647,
  },
};

interface IHostShadowPopoverProps {
  children: ReactNode;
  coverage: HostLayerCoverage;
  openLabel: string;
  testId: string;
}

/**
 * A host popover built like a web component: light-DOM children are slotted into a manual popover inside a shadow
 * root. Its toggle events never reach the document, so devtools cannot observe it opening.
 */
export function HostShadowPopover({ children, coverage, openLabel, testId }: IHostShadowPopoverProps): JSX.Element {
  const ownerElementReference = useRef<HTMLDivElement | null>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const [popoverElement, setPopoverElement] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const ownerElement: HTMLDivElement | null = ownerElementReference.current;

    if (ownerElement === null) {
      return;
    }

    setShadowRoot(ownerElement.shadowRoot ?? ownerElement.attachShadow({ mode: "open" }));
  }, []);

  return (
    <>
      <button type="button" onClick={() => popoverElement?.showPopover()}>
        {openLabel}
      </button>
      <div data-testid={testId} ref={ownerElementReference}>
        {children}
        {shadowRoot === null
          ? null
          : createPortal(
              <div popover="manual" ref={setPopoverElement} style={hostLayerStyles[coverage]}>
                <slot />
              </div>,
              shadowRoot,
            )}
      </div>
    </>
  );
}

export function readHostShadowPopover(ownerElement: HTMLElement): HTMLElement {
  const popoverElement: HTMLElement | null = ownerElement.shadowRoot?.querySelector<HTMLElement>("[popover]") ?? null;

  if (popoverElement === null) {
    throw new Error("The host shadow popover is not mounted.");
  }

  return popoverElement;
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

    shadowRoot.append(mountNode);
    storyMountNodes.set(shadowRoot, mountNode);

    installDevtoolsStyles(shadowRoot);
    setShadowMountNode(mountNode);

    return () => {
      setShadowMountNode(null);
      storyMountNodes.delete(shadowRoot);
      mountNode.remove();
    };
  }, []);

  return (
    // Marked like the production host in `renderDevtools`: events leaving the shadow root are retargeted to this
    // element, which is how page-level listeners recognize a devtools interaction.
    <div data-devhost-devtools="" data-testid={devtoolsStoryShadowRootHostTestId} ref={hostElementReference}>
      {shadowMountNode ? createPortal(props.children, shadowMountNode) : null}
    </div>
  );
}

interface IDevtoolsStoryRootProps {
  children: ReactNode;
}

/**
 * Stands in for `DevtoolsTopLayer` around a component rendered on its own: it carries the root's id and marker,
 * stays in normal flow so the story keeps its layout, and opts back in to pointer events as surfaces do (the shadow
 * host sets `pointer-events: none`).
 */
function DevtoolsStoryRoot({ children }: IDevtoolsStoryRootProps): JSX.Element {
  return (
    <div id={DEVTOOLS_ROOT_ID} className="pointer-events-auto" data-devhost-devtools="" data-testid="DevtoolsStoryRoot">
      {children}
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
