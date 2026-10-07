import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { JSX } from "react";

import { App as DevtoolsApp } from "../App";
import { DEVTOOLS_HOST_ID, installDevtoolsStyles } from "../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";
import {
  devtoolsStoryShadowRootHostTestId,
  readDevtoolsStoryShadowCanvas,
  readHostShadowPopover,
  readShadowRoot,
  renderDevtoolsInStoryShadowRoot,
} from "../../shared/components/stories/helpers";
import { StoryContainer } from "@/devtools/shared/components/stories/helpers";
import { DesignOverviewScene } from "../../../../.storybook/DesignOverviewScene";
import {
  cursorTargetShadowPopoverTestId,
  ReactHighlightLayeringScene,
} from "../../../../.storybook/ReactHighlightLayeringScene";
import { withDevhostMock } from "../../../../.storybook/withDevhostMock";
import { InjectedMountScene } from "../../../../.storybook/InjectedMountScene";
import {
  readInjectedDevtoolsStory,
  setupInjectedDevtoolsStory,
} from "../../../../.storybook/setupInjectedDevtoolsStory";
import {
  verifyDevtoolsClickDuringSelection,
  verifyReactHighlightLayering,
  verifyRestartShortcut,
  verifySelectionLayering,
  verifySurfaceOrder,
} from "./helpers";

const meta: Meta<typeof DevtoolsApp> = {
  title: "@alexgorbatchev/devhost-ui/devtools/components/App",
  component: DevtoolsApp,
  decorators: [withDevhostMock],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const ReactHighlightsAboveHostStackingContext: Story = {
  render: () => <ReactHighlightLayeringScene />,
  play: async ({ canvasElement }): Promise<void> => {
    await verifyReactHighlightLayering(canvasElement);
  },
};

export const ReactHighlightsAboveHostPopover: Story = {
  render: () => <ReactHighlightLayeringScene hostLayer="popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open cursor target popover" }));
    await verifyReactHighlightLayering(canvasElement);
    expect(canvas.getByRole("region", { name: "Cursor targets" }).matches(":popover-open")).toBe(true);
  },
};

/**
 * Web-component dialogs slot page content into a popover inside their shadow root. The document cannot observe
 * that popover opening, so cursor rectangles bring devtools above it when they appear.
 */
export const ReactHighlightsAboveHostShadowPopover: Story = {
  render: () => <ReactHighlightLayeringScene hostLayer="shadow-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open cursor target popover" }));
    const shadowPopover = readHostShadowPopover(canvas.getByTestId(cursorTargetShadowPopoverTestId));
    await waitFor(() => {
      expect(shadowPopover.matches(":popover-open")).toBe(true);
    });
    await verifyReactHighlightLayering(canvasElement);
    expect(shadowPopover.matches(":popover-open")).toBe(true);
  },
};

export const SelectionHighlightsBelowDevtoolsSurfaces: Story = {
  render: () => <SelectionLayeringScene />,
  play: async ({ canvasElement }): Promise<void> => {
    await verifySelectionLayering(canvasElement);
  },
};

/** Bottom to top: selection highlights, annotation drafts, the toolbar and minimap, terminal windows. */
export const SurfacesStackInOrder: Story = {
  render: () => <SelectionLayeringScene />,
  play: async ({ canvasElement }): Promise<void> => {
    await verifySurfaceOrder(canvasElement);
  },
};

/** While Alt-selection is active, clicks on devtools surfaces reach them instead of marking the page beneath. */
export const DevtoolsStayClickableDuringSelection: Story = {
  render: () => <SelectionLayeringScene />,
  play: async ({ canvasElement }): Promise<void> => {
    await verifyDevtoolsClickDuringSelection(canvasElement);
  },
};

/**
 * The restart shortcut restarts the primary service, and leaves keystrokes typed into a field, editable content, or
 * the terminal alone.
 */
export const RestartShortcut: Story = {
  render: () => <RestartShortcutScene />,
  play: async ({ canvasElement }): Promise<void> => {
    await verifyRestartShortcut(canvasElement);
  },
};

export const App: Story = {
  render: () =>
    renderDevtoolsInStoryShadowRoot(
      <StoryContainer>
        <DevtoolsApp />
      </StoryContainer>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowRoot = await readStoryShadowRoot(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    expect(shadowRoot.querySelector("[data-testid='DevtoolsTopLayer']")).not.toBeNull();

    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });

    await waitFor(() => {
      expect(within(toolbar).getByRole("button", { name: "Services: 2 of 3 up" })).toBeVisible();
      expect(within(toolbar).getByRole("button", { name: /^Annotation queues: / })).toBeVisible();
      expect(within(toolbar).getByRole("button", { name: /^Pi terminal, / })).toBeVisible();
      expect(within(toolbar).getByRole("button", { name: /^<Header> terminal, / })).toBeVisible();
      expect(shadowRoot.querySelector("[data-testid='LogMinimap--canvas']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='AnnotationComposer']")).not.toBeNull();
    });

    // Restored sessions stay minimized: their windows are mounted but not shown.
    await expect(shadowCanvas.queryByRole("dialog")).toBeNull();

    await userEvent.click(within(toolbar).getByRole("button", { name: /^Pi terminal, / }));
    await waitFor(async () => {
      await expect(await shadowCanvas.findByRole("dialog", { name: "Pi terminal" })).toBeVisible();
    });
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Minimize" }));
    await waitFor(() => expect(shadowCanvas.queryByRole("dialog", { name: "Pi terminal" })).toBeNull());
  },
};

export const ServiceCrashRecovery: Story = {
  parameters: { serviceRecovery: true },
  render: () => renderDevtoolsInStoryShadowRoot(<DevtoolsApp />),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Services: 1 of 1 up" })).toBeVisible();
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Crash api" }));
    const dialog = await canvas.findByRole("dialog", { name: "Service exited" });
    await expect(within(dialog).getByRole("region", { name: "api logs" })).toHaveTextContent(
      "stdout: [api] readystderr: [api] fatal error",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Restart api" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Failed to restart api: Service api exited before passing its health check with code 1.",
    );
    await expect(canvas.getByRole("heading", { name: "api (exit code 1)" })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Restart api" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Service exited" })).toBeNull());
    await expect(canvas.getByRole("button", { name: "Services: 1 of 1 up" })).toBeVisible();
  },
};

export const WorktreeRecovery: Story = {
  parameters: { worktreeRecovery: true },
  render: () => renderDevtoolsInStoryShadowRoot(<DevtoolsApp />),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const services = await canvas.findByRole("button", { name: "Services: 0 of 1 up" });
    await expect(canvas.queryByRole("dialog", { name: "Service exited" })).toBeNull();
    await userEvent.click(services);
    await userEvent.click(canvas.getByRole("button", { name: "Choose worktree for shop" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Service api failed to start.");
    const recover = canvas.getByRole("button", { name: "Return to configured checkout" });
    await waitFor(() => expect(recover).toBeEnabled());
    await userEvent.click(recover);
    await expect(await canvas.findByRole("button", { name: "Services: 1 of 1 up" })).toBeVisible();
    await expect(canvas.queryByRole("dialog", { name: "Service exited" })).toBeNull();
    await expect(await canvas.findByRole("button", { name: "Choose worktree for shop" })).toHaveTextContent("main");
  },
};

/**
 * Mounts the production devtools host under aggressive host-page CSS and a shrunken root font size. The devtools
 * UI must stay unaffected: shadow-DOM styles plus `:host { all: initial !important }` cut inherited host styles,
 * and px-based tokens ignore the host's rem scale.
 */
export const HostileHostPage: Story = {
  beforeEach: (context) => {
    const hostileStylesheet = document.createElement("style");
    hostileStylesheet.textContent = hostileHostStylesheetText;
    document.head.append(hostileStylesheet);
    const unmountDevtools = setupInjectedDevtoolsStory(context);
    return () => {
      unmountDevtools();
      hostileStylesheet.remove();
    };
  },
  render: (_args, context) => <InjectedMountScene devtools={readInjectedDevtoolsStory(context)} hasControls={false} />,
  play: async (): Promise<void> => {
    const toolbar: HTMLElement = await waitFor(() => {
      const hostElement: HTMLElement | null = document.getElementById(DEVTOOLS_HOST_ID);
      const toolbarBar: HTMLElement | null =
        hostElement?.shadowRoot?.querySelector<HTMLElement>("[data-testid='DevtoolsToolbar--bar']") ?? null;

      expect(toolbarBar).not.toBeNull();

      return toolbarBar as HTMLElement;
    });
    const toolbarStyle: CSSStyleDeclaration = getComputedStyle(toolbar);

    await expect(toolbarStyle.letterSpacing).toBe("normal");
    await expect(toolbarStyle.textTransform).toBe("none");
    await expect(toolbarStyle.fontFamily.startsWith('"devhost JetBrains Mono"')).toBe(true);
    await expect(toolbar.getBoundingClientRect().height).toBe(26);
  },
};

/**
 * Storybook's preview also loads devtools.css into the main document, which registers Tailwind's `@property` rules
 * globally and hides the production failure mode. This story mounts a shadow root inside a clean iframe document so
 * only the shadow stylesheet applies, and asserts that border and shadow utilities still resolve there.
 */
export const ShadowRootWithoutDocumentStyles: Story = {
  render: () => <ShadowRootWithoutDocumentStylesStory />,
  play: async ({ canvasElement }): Promise<void> => {
    const frame: HTMLElement = await waitFor(() => {
      const frameElement: HTMLDivElement | null = readIsolatedFrameProbe(canvasElement);

      expect(frameElement).not.toBeNull();

      return frameElement as HTMLDivElement;
    });
    const frameStyle: CSSStyleDeclaration = frame.ownerDocument.defaultView!.getComputedStyle(frame);

    await expect(frameStyle.borderTopStyle).toBe("solid");
    await expect(frameStyle.borderTopWidth).toBe("1px");
    await expect(frameStyle.boxShadow).not.toBe("none");
  },
};

export const InjectedMount: Story = {
  beforeEach: setupInjectedDevtoolsStory,
  render: (_args, context) => <InjectedMountScene devtools={readInjectedDevtoolsStory(context)} />,
  play: async (): Promise<void> => {
    await waitFor(() => {
      const hostElement = document.getElementById(DEVTOOLS_HOST_ID);
      expect(hostElement).not.toBeNull();
      expect(hostElement?.getAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME)).toBe("");
      expect(hostElement?.shadowRoot).not.toBeNull();
      expect(hostElement?.shadowRoot?.querySelector("[data-testid='DevtoolsTopLayer']")).not.toBeNull();
    });
  },
};

/** Unmounting removes the host and every page-level listener, so the page no longer reacts to devtools keys. */
export const InjectedUnmount: Story = {
  beforeEach: setupInjectedDevtoolsStory,
  render: (_args, context) => <InjectedMountScene devtools={readInjectedDevtoolsStory(context)} />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const hostText = canvas.getByText("Host page text");
    // One session keeps the Alt key state between calls, so releasing it dispatches the keyup that ends selection.
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        document.getElementById(DEVTOOLS_HOST_ID)?.shadowRoot?.querySelector("[data-testid='AnnotationComposer']"),
      ).not.toBeNull();
    });
    // Selection mode replaces the page's cursors: plain text shows the default arrow instead of its own cursor.
    expect(getComputedStyle(hostText).cursor).toBe("auto");
    await user.keyboard("{Alt>}");
    await waitFor(() => {
      expect(getComputedStyle(hostText).cursor).toBe("default");
    });
    await user.keyboard("{/Alt}");
    await waitFor(() => {
      expect(getComputedStyle(hostText).cursor).toBe("auto");
    });

    await user.click(canvas.getByRole("button", { name: "Unmount devtools" }));
    expect(document.getElementById(DEVTOOLS_HOST_ID)).toBeNull();
    await user.keyboard("{Alt>}");
    expect(getComputedStyle(hostText).cursor).toBe("auto");
    await user.keyboard("{/Alt}");

    await user.click(canvas.getByRole("button", { name: "Mount devtools" }));
    await waitFor(() => {
      expect(document.getElementById(DEVTOOLS_HOST_ID)?.shadowRoot).not.toBeNull();
    });
  },
};

const designOverviewComment: string =
  "Change primary button (#1) to modern border-radius and color to match the design spec shown in the card (#2)";

/** The showcase scene: a host page with two marked elements and a drafted annotation over the full devtools UI. */
export const DesignOverview: Story = {
  parameters: { designOverview: true },
  render: () => <DesignOverviewScene />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
    // One session keeps the Alt key state between calls, so releasing it dispatches the keyup that ends selection.
    const user = userEvent.setup();

    await within(toolbar).findByRole("button", { name: "Services: 6 of 6 up" });
    await within(toolbar).findByRole("button", { name: /^Pi terminal, / });
    await within(toolbar).findByRole("button", { name: /^<WelcomeSection> terminal, / });

    await user.keyboard("{Alt>}");
    await shadowCanvas.findByRole("status", { name: "Annotation selection" });
    await user.click(canvas.getByRole("button", { name: "Get Started" }));
    await user.click(canvas.getByRole("heading", { name: "Service Health status" }));
    await user.keyboard("{/Alt}");

    const draft = await shadowCanvas.findByRole("dialog", { name: "Annotation draft" });
    const comment = within(draft).getByRole("textbox", { name: "Annotation comment" });

    // The draft fades in, so its contents become visible a moment after it mounts.
    await waitFor(() => {
      expect(draft).toHaveTextContent("2 markers");
      expect(within(draft).getByText("WelcomeSection > button")).toBeVisible();
      expect(within(draft).getByText("ServiceHealthPanel")).toBeVisible();
    });

    // user-event cannot reach React's change tracking inside a shadow root, so only the typed text is checked here;
    // the AnnotationComposer stories cover drafting and submitting.
    await user.type(comment, designOverviewComment);
    await expect(comment).toHaveValue(designOverviewComment);
  },
};

function SelectionLayeringScene(): JSX.Element {
  return (
    <>
      {/* Covers the viewport, so its selection highlight overlaps every devtools surface. */}
      <button type="button" style={{ position: "fixed", inset: 0, border: 0, background: "white" }}>
        Viewport target
      </button>
      {/* Sits in the toolbar's corner, so its annotation draft is placed over the toolbar. */}
      <button type="button" style={{ position: "fixed", right: 0, bottom: 0, width: 160, height: 120 }}>
        Corner target
      </button>
      {renderDevtoolsInStoryShadowRoot(<DevtoolsApp />)}
    </>
  );
}

function RestartShortcutScene(): JSX.Element {
  return (
    <>
      <label>
        Host field <input type="text" />
      </label>
      <div contentEditable role="textbox" aria-label="Host note" />
      <button type="button">Host button</button>
      {renderDevtoolsInStoryShadowRoot(<DevtoolsApp />)}
    </>
  );
}

const hostileHostStylesheetText: string = [
  "* { letter-spacing: 0.3em !important; font-family: serif !important; text-transform: uppercase !important; }",
  "html { font-size: 10px !important; }",
].join("\n");

const isolatedFrameTestId: string = "ShadowRootWithoutDocumentStyles--frame";
const isolatedFrameProbeTestId: string = "ShadowRootWithoutDocumentStyles--probe";

function ShadowRootWithoutDocumentStylesStory(): JSX.Element {
  // Mounts on `load`: an srcDoc iframe starts on a temporary about:blank document that is replaced once it loads.
  const mountIsolatedShadowRoot = (event: React.SyntheticEvent<HTMLIFrameElement>): void => {
    const frameDocument: Document | null = event.currentTarget.contentDocument;

    if (frameDocument === null) {
      return;
    }

    const hostElement: HTMLDivElement = frameDocument.createElement("div");
    const shadowRoot: ShadowRoot = hostElement.attachShadow({ mode: "open" });
    const probeElement: HTMLDivElement = frameDocument.createElement("div");

    probeElement.className = "rounded-md border border-edge bg-card shadow-frame";
    probeElement.setAttribute("data-testid", isolatedFrameProbeTestId);
    probeElement.textContent = "framed surface";
    shadowRoot.append(probeElement);
    frameDocument.body.append(hostElement);
    installDevtoolsStyles(shadowRoot);
  };

  return (
    <iframe
      data-testid={isolatedFrameTestId}
      srcDoc="<!doctype html><body></body>"
      title="isolated"
      onLoad={mountIsolatedShadowRoot}
    />
  );
}

function readIsolatedFrameProbe(canvasElement: HTMLElement): HTMLDivElement | null {
  const frameElement: HTMLIFrameElement | null = canvasElement.querySelector(`[data-testid='${isolatedFrameTestId}']`);
  const hostElement: Element | null = frameElement?.contentDocument?.body.firstElementChild ?? null;

  return hostElement?.shadowRoot?.querySelector<HTMLDivElement>(`[data-testid='${isolatedFrameProbeTestId}']`) ?? null;
}

async function readStoryShadowRoot(canvasElement: HTMLElement): Promise<ShadowRoot> {
  const canvas = within(canvasElement);
  const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(shadowHost, "Expected the App story to attach a shadow root.");

  await expect(shadowHost.shadowRoot).toBe(shadowRoot);

  return shadowRoot;
}
