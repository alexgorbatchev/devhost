import type { Meta, StoryObj } from "@storybook/react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { Textarea } from "../../../../components/ui/Textarea";
import { DevtoolsToolbar } from "../DevtoolsToolbar";
import { DevtoolsTopLayer } from "../DevtoolsTopLayer";
import { HighlightOverlay, type IHighlightOverlayItem } from "../HighlightOverlay";
import { ToolbarPopover } from "../ToolbarPopover";
import {
  devtoolsStoryShadowRootHostTestId,
  expectDevtoolsSurfaceOnTop,
  HostShadowPopover,
  hostLayerStyles,
  readDevtoolsStoryShadowCanvas,
  readHostShadowPopover,
  readShadowRoot,
  renderDevtoolsInStoryShadowRoot,
  StorybookThemeProvider,
} from "./helpers";

type HostLayerKind = "auto-popover" | "manual-popover" | "shadow-popover" | "stacking-context";

// Covers the viewport at the highest z-index a page can use, so every devtools surface overlaps it.
const hostLayerStyle: CSSProperties = hostLayerStyles.viewport;
const hostLayerTestId: string = "HostLayer";
const hostLayerShortcutKey: string = "F2";

interface IHostLayerProps {
  children: ReactNode;
  kind: HostLayerKind;
}

/** Host-page content that competes with devtools for the top of the page. Popover kinds start closed. */
function HostLayer({ children, kind }: IHostLayerProps): JSX.Element {
  const layerId: string = useId();
  const [manualLayerElement, setManualLayerElement] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (manualLayerElement === null) {
      return;
    }

    // The host page opens its layer from a keyboard shortcut, so a story can open it without moving focus.
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === hostLayerShortcutKey) {
        manualLayerElement.showPopover();
      }
    };

    manualLayerElement.ownerDocument.addEventListener("keydown", handleKeyDown);

    return () => {
      manualLayerElement.ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [manualLayerElement]);

  if (kind === "shadow-popover") {
    return (
      <HostShadowPopover coverage="viewport" openLabel="Open host layer" testId={hostLayerTestId}>
        {children}
      </HostShadowPopover>
    );
  }

  if (kind === "stacking-context") {
    return (
      <div data-testid={hostLayerTestId} style={hostLayerStyle}>
        {children}
      </div>
    );
  }

  if (kind === "manual-popover") {
    return (
      <div data-testid={hostLayerTestId} popover="manual" ref={setManualLayerElement} style={hostLayerStyle}>
        {children}
      </div>
    );
  }

  return (
    <>
      <button type="button" popoverTarget={layerId}>
        Open host layer
      </button>
      <div id={layerId} data-testid={hostLayerTestId} popover="auto" style={hostLayerStyle}>
        {children}
      </div>
    </>
  );
}

interface IModalDialogProps {
  closeLabel: string;
  isDevtoolsOwned?: boolean;
  label: string;
  openLabel: string;
}

/** A modal dialog with its own open and close buttons, owned by the host page or by devtools. */
function ModalDialog({ closeLabel, isDevtoolsOwned = false, label, openLabel }: IModalDialogProps): JSX.Element {
  const dialogReference = useRef<HTMLDialogElement | null>(null);

  return (
    <>
      <button
        type="button"
        className={isDevtoolsOwned ? "pointer-events-auto fixed top-2 right-2 z-(--devhost-z-dock)" : undefined}
        onClick={() => dialogReference.current?.showModal()}
      >
        {openLabel}
      </button>
      <dialog ref={dialogReference} aria-label={label} className={isDevtoolsOwned ? "pointer-events-auto" : undefined}>
        <button type="button" onClick={() => dialogReference.current?.close()}>
          {closeLabel}
        </button>
      </dialog>
    </>
  );
}

interface ITopLayerSceneProps {
  globals: Partial<Record<string, unknown>>;
  hasHostDialog?: boolean;
  hasNote?: boolean;
  hasOwnDialog?: boolean;
  hostLayer: HostLayerKind;
  isShadowMounted?: boolean;
}

function TopLayerScene({
  globals,
  hasHostDialog = false,
  hasNote = false,
  hasOwnDialog = false,
  hostLayer,
  isShadowMounted = true,
}: ITopLayerSceneProps): JSX.Element {
  const [targetElement, setTargetElement] = useState<HTMLButtonElement | null>(null);
  const [isHighlighted, setIsHighlighted] = useState<boolean>(false);
  const highlights: IHighlightOverlayItem[] = useMemo(() => {
    if (targetElement === null || !isHighlighted) {
      return [];
    }

    return [{ id: "host-target", label: "host target", readRectangle: () => targetElement.getBoundingClientRect() }];
  }, [isHighlighted, targetElement]);

  const devtools = (
    <StorybookThemeProvider globals={globals}>
      <DevtoolsTopLayer>
        <DevtoolsToolbar
          collapsedIndicator={null}
          isMinimapVisible={false}
          position="bottom-right"
          stackName="demo-stack"
        >
          <ToolbarPopover
            panelLabel="Services"
            panelWidth="sm"
            testId="DevtoolsTopLayerStory--services"
            triggerContent="4/5"
            triggerLabel="Services"
          >
            <p className="px-2 py-1">Services panel body</p>
          </ToolbarPopover>
        </DevtoolsToolbar>
        {hasNote ? (
          <div className="pointer-events-auto fixed bottom-20 left-2 z-(--devhost-z-popover) w-40">
            <Textarea aria-label="Devtools note" rows={2} />
          </div>
        ) : null}
        {hasOwnDialog ? (
          <ModalDialog
            closeLabel="Close devtools dialog"
            isDevtoolsOwned
            label="Devtools dialog"
            openLabel="Open devtools dialog"
          />
        ) : null}
        <HighlightOverlay appearance="hover" highlights={highlights} />
      </DevtoolsTopLayer>
    </StorybookThemeProvider>
  );

  return (
    <>
      <HostLayer kind={hostLayer}>
        <button
          type="button"
          ref={setTargetElement}
          aria-pressed={isHighlighted}
          onClick={() => setIsHighlighted((currentValue) => !currentValue)}
        >
          Toggle host highlight
        </button>
      </HostLayer>
      {hasHostDialog ? (
        <ModalDialog closeLabel="Close host dialog" label="Host dialog" openLabel="Open host dialog" />
      ) : null}
      {isShadowMounted ? (
        // A host ancestor that traps z-index and clips fixed descendants; only the top layer escapes it.
        <div style={{ position: "relative", zIndex: 0, transform: "translateZ(0)", contain: "paint", height: 1 }}>
          {renderDevtoolsInStoryShadowRoot(devtools)}
        </div>
      ) : (
        devtools
      )}
    </>
  );
}

interface ITopLayerStoryQueries {
  canvas: ReturnType<typeof within>;
  hostLayer: HTMLElement;
  shadowCanvas: ReturnType<typeof within>;
  shadowRoot: ShadowRoot;
  toolbar: HTMLElement;
}

async function readTopLayerStory(canvasElement: HTMLElement): Promise<ITopLayerStoryQueries> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

  return {
    canvas,
    hostLayer: canvas.getByTestId(hostLayerTestId),
    shadowCanvas,
    shadowRoot: readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    ),
    toolbar: await shadowCanvas.findByRole("toolbar", { name: "devhost" }),
  };
}

// Listeners on the toggled element run after the document capture phase, where devtools observe host elements.
function waitForToggle(element: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    element.addEventListener("toggle", () => resolve(), { once: true });
  });
}

async function expectHostHighlightOnTop(
  hostTarget: HTMLElement,
  { shadowCanvas, shadowRoot }: ITopLayerStoryQueries,
): Promise<void> {
  await userEvent.click(hostTarget);

  const highlight = await shadowCanvas.findByTestId("HighlightOverlay--highlight");
  const label = await shadowCanvas.findByTestId("HighlightOverlay--label");

  await waitFor(() => {
    expectDevtoolsSurfaceOnTop(shadowRoot, highlight);
    expectDevtoolsSurfaceOnTop(shadowRoot, label);
  });
}

const meta: Meta<typeof DevtoolsTopLayer> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/DevtoolsTopLayer",
  component: DevtoolsTopLayer,
};

export default meta;

type Story = StoryObj<typeof meta>;

export const AboveHostStackingContext: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hostLayer="stacking-context" />,
  play: async ({ canvasElement }): Promise<void> => {
    const queries = await readTopLayerStory(canvasElement);
    const hostTarget = queries.canvas.getByRole("button", { name: "Toggle host highlight" });

    await waitFor(() => {
      expectDevtoolsSurfaceOnTop(queries.shadowRoot, queries.toolbar);
    });
    await expectHostHighlightOnTop(hostTarget, queries);

    // The root and its passive highlights leave the host element under them as the pointer target.
    const targetRectangle = hostTarget.getBoundingClientRect();
    expect(
      document.elementFromPoint(
        targetRectangle.left + targetRectangle.width / 2,
        targetRectangle.top + targetRectangle.height / 2,
      ),
    ).toBe(hostTarget);
  },
};

export const AboveHostPopover: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hostLayer="auto-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const queries = await readTopLayerStory(canvasElement);

    await userEvent.click(queries.canvas.getByRole("button", { name: "Open host layer" }));
    await waitFor(() => {
      expect(queries.hostLayer.matches(":popover-open")).toBe(true);
      expectDevtoolsSurfaceOnTop(queries.shadowRoot, queries.toolbar);
    });

    await expectHostHighlightOnTop(
      within(queries.hostLayer).getByRole("button", { name: "Toggle host highlight" }),
      queries,
    );
    // Re-entering the top layer leaves the host popover open.
    expect(queries.hostLayer.matches(":popover-open")).toBe(true);
  },
};

export const AboveHostShadowPopover: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hostLayer="shadow-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const queries = await readTopLayerStory(canvasElement);

    await userEvent.click(queries.canvas.getByRole("button", { name: "Open host layer" }));
    const shadowPopover = readHostShadowPopover(queries.hostLayer);
    await waitFor(() => {
      expect(shadowPopover.matches(":popover-open")).toBe(true);
    });

    // The document cannot observe this popover opening; highlighting host content brings devtools above it.
    await expectHostHighlightOnTop(queries.canvas.getByRole("button", { name: "Toggle host highlight" }), queries);
    expectDevtoolsSurfaceOnTop(queries.shadowRoot, queries.toolbar);
    expect(shadowPopover.matches(":popover-open")).toBe(true);
  },
};

export const KeepsFocusWhenHostPopoverOpens: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hasNote hostLayer="manual-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const { hostLayer, shadowCanvas, shadowRoot } = await readTopLayerStory(canvasElement);
    const note = shadowCanvas.getByRole("textbox", { name: "Devtools note" });
    const user = userEvent.setup();

    await user.click(note);
    await user.keyboard("before");
    await user.keyboard(`{${hostLayerShortcutKey}}`);
    await waitFor(() => {
      expect(hostLayer.matches(":popover-open")).toBe(true);
      expectDevtoolsSurfaceOnTop(shadowRoot, note);
    });

    await user.keyboard(" after");
    expect(note).toHaveValue("before after");
    expect(shadowRoot.activeElement).toBe(note);
  },
};

export const KeepsOwnPopoverAnchored: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hostLayer="manual-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const { hostLayer, shadowCanvas, shadowRoot, toolbar } = await readTopLayerStory(canvasElement);
    const trigger = within(toolbar).getByRole("button", { name: "Services" });
    // Anchored: directly above the trigger and edge-aligned with it, end-aligned after the flip-inline fallback.
    const expectPanelAnchored = (panel: HTMLElement): void => {
      const panelBounds: DOMRect = panel.getBoundingClientRect();
      const triggerBounds: DOMRect = trigger.getBoundingClientRect();

      expect(panelBounds.bottom).toBeLessThanOrEqual(triggerBounds.top);
      expect([
        Math.round(panelBounds.left) === Math.round(triggerBounds.left),
        Math.round(panelBounds.right) === Math.round(triggerBounds.right),
      ]).toContain(true);
    };

    const panelOpened = waitForToggle(await shadowCanvas.findByLabelText("Services", { selector: "section" }));
    await userEvent.click(trigger);
    await panelOpened;
    const panel = await shadowCanvas.findByRole("region", { name: "Services" });
    await waitFor(() => {
      expect(panel).toBeVisible();
    });
    expectPanelAnchored(panel);

    const hostLayerOpened = waitForToggle(hostLayer);
    await userEvent.keyboard(`{${hostLayerShortcutKey}}`);
    await hostLayerOpened;

    // Re-entering the top layer now would drop the open panel below the root and detach it from its trigger.
    expect(hostLayer.matches(":popover-open")).toBe(true);
    expect(panel.matches(":popover-open")).toBe(true);
    expectPanelAnchored(panel);

    await userEvent.click(trigger);
    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expectDevtoolsSurfaceOnTop(shadowRoot, toolbar);
    });
  },
};

export const AboveHostModalDialog: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hasHostDialog hostLayer="shadow-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const { canvas, hostLayer, shadowRoot, toolbar } = await readTopLayerStory(canvasElement);
    const hostDialog = canvas.getByLabelText("Host dialog");
    const toolbarRectangle = toolbar.getBoundingClientRect();

    // A popover the document cannot observe covers devtools, so a later re-entry changes what is on top.
    await userEvent.click(canvas.getByRole("button", { name: "Open host layer" }));
    await waitFor(() => {
      expect(
        document.elementFromPoint(
          toolbarRectangle.left + toolbarRectangle.width / 2,
          toolbarRectangle.top + toolbarRectangle.height / 2,
        ),
      ).toBe(hostLayer);
    });

    const hostDialogOpened = waitForToggle(hostDialog);
    await userEvent.click(canvas.getByRole("button", { name: "Open host dialog" }));
    await hostDialogOpened;
    expect(hostDialog.matches(":modal")).toBe(true);

    // Content outside a modal dialog is inert and invisible to hit testing, so check once the dialog has closed.
    await userEvent.click(within(hostDialog).getByRole("button", { name: "Close host dialog" }));
    await waitFor(() => {
      expectDevtoolsSurfaceOnTop(shadowRoot, toolbar);
    });
  },
};

export const StaysBelowOwnModalDialog: Story = {
  render: (_args, context) => <TopLayerScene globals={context.globals} hasOwnDialog hostLayer="manual-popover" />,
  play: async ({ canvasElement }): Promise<void> => {
    const { hostLayer, shadowCanvas, shadowRoot, toolbar } = await readTopLayerStory(canvasElement);
    const topLayer = shadowCanvas.getByTestId("DevtoolsTopLayer");
    const ownDialog = shadowCanvas.getByLabelText("Devtools dialog");
    const handleReentry = fn();

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Open devtools dialog" }));
    await waitFor(() => {
      expect(ownDialog.matches(":modal")).toBe(true);
    });

    // Devtools content outside the modal dialog is inert and invisible to hit testing, so observe the root
    // itself: re-entering the top layer fires `beforetoggle` on it.
    topLayer.addEventListener("beforetoggle", handleReentry);
    const hostLayerOpened = waitForToggle(hostLayer);
    await userEvent.keyboard(`{${hostLayerShortcutKey}}`);
    await hostLayerOpened;

    expect(hostLayer.matches(":popover-open")).toBe(true);
    expect(handleReentry).not.toHaveBeenCalled();

    await userEvent.click(within(ownDialog).getByRole("button", { name: "Close devtools dialog" }));
    await waitFor(() => {
      expectDevtoolsSurfaceOnTop(shadowRoot, toolbar);
    });
  },
};

/**
 * Mounted in the document instead of a shadow root, the root's own toggle events reach the listener that watches
 * host popovers. They must not count as host top-layer changes, or every re-entry would trigger the next one.
 */
export const ReentersOncePerHostPopover: Story = {
  render: (_args, context) => (
    <TopLayerScene globals={context.globals} hostLayer="auto-popover" isShadowMounted={false} />
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const topLayer = await canvas.findByTestId("DevtoolsTopLayer");
    const handleReentry = fn();
    // Resolves on the toggle event that follows the first re-entry. Listeners on the root run after the document
    // capture phase, so a re-entry caused by that event has already happened by then.
    const reentryToggled = new Promise<void>((resolve) => {
      topLayer.addEventListener("beforetoggle", () => void waitForToggle(topLayer).then(resolve), { once: true });
    });

    topLayer.addEventListener("beforetoggle", handleReentry);
    await userEvent.click(canvas.getByRole("button", { name: "Open host layer" }));
    await reentryToggled;

    expect(canvas.getByTestId(hostLayerTestId).matches(":popover-open")).toBe(true);
    // One re-entry closes and reopens the root once.
    expect(handleReentry).toHaveBeenCalledTimes(2);
  },
};
