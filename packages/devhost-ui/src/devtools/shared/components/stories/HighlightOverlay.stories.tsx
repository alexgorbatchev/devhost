import type { Meta, StoryObj } from "@storybook/react";
import { useId, useMemo, useState, type JSX } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { HighlightOverlay } from "../../index";
import { StoryContainer } from "./helpers";
import { StorybookThemeProvider } from "./helpers";
import { readDevtoolsStoryShadowCanvas, readShadowRoot, renderInDevtoolsStoryShadowRoot } from "./helpers";

interface IHostLayerSceneProps {
  isPopover?: boolean;
}

function HostLayerScene({ isPopover = false }: IHostLayerSceneProps): JSX.Element {
  const panelId = useId();
  const [targetElement, setTargetElement] = useState<HTMLButtonElement | null>(null);
  const [isHighlighted, setIsHighlighted] = useState<boolean>(false);
  const highlights = useMemo(() => {
    if (targetElement === null || !isHighlighted) {
      return [];
    }

    return [{ id: "host-layer", label: "host target", readRectangle: () => targetElement.getBoundingClientRect() }];
  }, [isHighlighted, targetElement]);

  return (
    <>
      {isPopover ? (
        <button type="button" popoverTarget={panelId}>
          Open host popover
        </button>
      ) : null}
      <div
        id={panelId}
        popover={isPopover ? "auto" : undefined}
        data-testid="HostLayerScene--panel"
        style={{ position: "fixed", inset: 100, margin: 0, padding: 40, background: "white", zIndex: 2147483647 }}
      >
        <button
          type="button"
          ref={setTargetElement}
          aria-pressed={isHighlighted}
          onClick={() => setIsHighlighted((currentValue) => !currentValue)}
        >
          Toggle host highlight
        </button>
      </div>
      <div style={{ position: "relative", zIndex: 0, transform: "translateZ(0)", contain: "paint", height: 1 }}>
        {renderInDevtoolsStoryShadowRoot(
          <HighlightOverlay appearance="hover" highlights={highlights} rootTestId="HostHighlightOverlay" />,
        )}
      </div>
    </>
  );
}

async function verifyHostLayerHighlight(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const target = canvas.getByRole("button", { name: "Toggle host highlight" });
  const overlay = shadowCanvas.getByTestId("HostHighlightOverlay");
  const shadowRoot = readShadowRoot(canvas.getByTestId("DevtoolsStoryShadowRoot"), "Missing story shadow root.");

  await userEvent.click(target);
  await waitFor(() => {
    expect(shadowCanvas.getByTestId("HighlightOverlay--highlight")).toBeVisible();
    expect(shadowCanvas.getByTestId("HighlightOverlay--label")).toHaveTextContent("host target");
  });

  // Passive overlays are excluded from hit testing. Opt in only while checking the browser's actual paint order.
  const expectSurfaceOnTop = (surface: HTMLElement): void => {
    const rectangle = surface.getBoundingClientRect();
    surface.style.pointerEvents = "auto";
    try {
      expect(shadowRoot.elementFromPoint(rectangle.left + rectangle.width / 2, rectangle.top + 1)).toBe(surface);
    } finally {
      surface.style.removeProperty("pointer-events");
    }
  };

  await waitFor(() => {
    expectSurfaceOnTop(shadowCanvas.getByTestId("HighlightOverlay--highlight"));
    expectSurfaceOnTop(shadowCanvas.getByTestId("HighlightOverlay--label"));
  });
  expect(target.ownerDocument.activeElement).toBe(target);
  expect(overlay.matches(":popover-open")).toBe(true);

  await userEvent.click(target);
  await waitFor(() => {
    expect(target).toHaveAttribute("aria-pressed", "false");
    expect(overlay.matches(":popover-open")).toBe(false);
    expect(shadowCanvas.queryByTestId("HighlightOverlay--highlight")).not.toBeInTheDocument();
  });

  await userEvent.click(target);
  await waitFor(() => {
    expect(target).toHaveAttribute("aria-pressed", "true");
    expect(overlay.matches(":popover-open")).toBe(true);
    expectSurfaceOnTop(shadowCanvas.getByTestId("HighlightOverlay--label"));
  });
}

interface IHighlightOnlySceneProps {
  appearance?: "hover" | "selected";
  label?: string;
}

function HighlightOnlyScene({ appearance, label }: IHighlightOnlySceneProps): JSX.Element {
  const [targetElement, setTargetElement] = useState<HTMLButtonElement | null>(null);
  const highlights = useMemo(() => {
    if (targetElement === null) {
      return [];
    }

    return [{ id: "highlight-only", label, readRectangle: () => targetElement.getBoundingClientRect() }];
  }, [label, targetElement]);

  return (
    <StoryContainer align="center">
      <div style={{ display: "grid", gap: "16px", width: "280px" }}>
        <button
          ref={setTargetElement}
          type="button"
          style={{
            background: "#38bdf8",
            border: 0,
            borderRadius: "12px",
            color: "#082f49",
            fontSize: "12px",
            fontWeight: 700,
            minHeight: "48px",
            padding: "12px 16px",
            textAlign: "left",
          }}
        >
          highlight only target
        </button>
        <HighlightOverlay appearance={appearance} highlights={highlights} />
      </div>
    </StoryContainer>
  );
}

function BadgedHighlightsScene(): JSX.Element {
  const [firstTargetElement, setFirstTargetElement] = useState<HTMLButtonElement | null>(null);
  const [secondTargetElement, setSecondTargetElement] = useState<HTMLButtonElement | null>(null);
  const highlights = useMemo(() => {
    if (firstTargetElement === null || secondTargetElement === null) {
      return [];
    }

    return [
      { badge: 1, id: "first-badge", readRectangle: () => firstTargetElement.getBoundingClientRect() },
      { badge: 2, id: "second-badge", readRectangle: () => secondTargetElement.getBoundingClientRect() },
    ];
  }, [firstTargetElement, secondTargetElement]);

  return (
    <StoryContainer align="center">
      <div style={{ display: "grid", gap: "16px", width: "280px" }}>
        <button
          ref={setFirstTargetElement}
          type="button"
          style={{
            background: "#f59e0b",
            border: 0,
            borderRadius: "12px",
            color: "#451a03",
            fontSize: "12px",
            fontWeight: 700,
            minHeight: "48px",
            padding: "12px 16px",
            textAlign: "left",
          }}
        >
          first badged target
        </button>
        <button
          ref={setSecondTargetElement}
          type="button"
          style={{
            background: "#a78bfa",
            border: 0,
            borderRadius: "12px",
            color: "#2e1065",
            fontSize: "12px",
            fontWeight: 700,
            minHeight: "48px",
            padding: "12px 16px",
            textAlign: "left",
          }}
        >
          second badged target
        </button>
        <HighlightOverlay highlights={highlights} />
      </div>
    </StoryContainer>
  );
}

const meta: Meta<typeof HighlightOverlay> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/HighlightOverlay",
  component: HighlightOverlay,
  render: (_args, context) => {
    return (
      <StorybookThemeProvider globals={context.globals}>
        <HighlightOnlyScene />
      </StorybookThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const HighlightOnly: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const target = canvas.getByRole("button", { name: "highlight only target" });

    await waitFor(() => {
      expect(page.getByTestId("HighlightOverlay")).toBeInTheDocument();
      expect(page.getAllByTestId("HighlightOverlay--highlight")).toHaveLength(1);
      expect(page.queryAllByTestId("HighlightOverlay--badge")).toHaveLength(0);
    });

    const targetRectangle = target.getBoundingClientRect();
    const highlightRectangle = page.getByTestId("HighlightOverlay--highlight").getBoundingClientRect();

    // The ring sits 3px outside the target on every side so the two-tone outline never covers target content.
    expect(Math.abs(highlightRectangle.x - (targetRectangle.x - 3))).toBeLessThanOrEqual(1);
    expect(Math.abs(highlightRectangle.y - (targetRectangle.y - 3))).toBeLessThanOrEqual(1);
    expect(Math.abs(highlightRectangle.width - (targetRectangle.width + 6))).toBeLessThanOrEqual(1);
    expect(Math.abs(highlightRectangle.height - (targetRectangle.height + 6))).toBeLessThanOrEqual(1);
    expect(page.getByTestId("HighlightOverlay--highlight")).toHaveAttribute("data-appearance", "selected");
  },
};

export const HoverWithLabel: Story = {
  render: (_args, context) => {
    return (
      <StorybookThemeProvider globals={context.globals}>
        <HighlightOnlyScene appearance="hover" label='button "highlight only target"' />
      </StorybookThemeProvider>
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const page = within(canvasElement.ownerDocument.body);

    await waitFor(() => {
      expect(page.getByTestId("HighlightOverlay--label")).toHaveTextContent('button "highlight only target"');
    });

    const highlight = page.getByTestId("HighlightOverlay--highlight");
    const label = page.getByTestId("HighlightOverlay--label");

    expect(highlight).toHaveAttribute("data-appearance", "hover");
    expect(label.getBoundingClientRect().bottom).toBeLessThanOrEqual(highlight.getBoundingClientRect().top);
  },
};

export const WithBadges: Story = {
  render: (_args, context) => {
    return (
      <StorybookThemeProvider globals={context.globals}>
        <BadgedHighlightsScene />
      </StorybookThemeProvider>
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const page = within(canvasElement.ownerDocument.body);

    await waitFor(() => {
      expect(page.getByTestId("HighlightOverlay")).toBeInTheDocument();
      expect(page.getAllByTestId("HighlightOverlay--highlight")).toHaveLength(2);
      expect(page.getAllByTestId("HighlightOverlay--badge")).toHaveLength(2);
      expect(page.getByText("1")).toBeInTheDocument();
      expect(page.getByText("2")).toBeInTheDocument();
    });
  },
};

export const AboveHostStackingContext: Story = {
  render: (_args, context) => (
    <StorybookThemeProvider globals={context.globals}>
      <HostLayerScene />
    </StorybookThemeProvider>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    await verifyHostLayerHighlight(canvasElement);
  },
};

export const AboveHostPopover: Story = {
  render: (_args, context) => (
    <StorybookThemeProvider globals={context.globals}>
      <HostLayerScene isPopover />
    </StorybookThemeProvider>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open host popover" }));
    await verifyHostLayerHighlight(canvasElement);
    expect(canvas.getByTestId("HostLayerScene--panel").matches(":popover-open")).toBe(true);
  },
};
