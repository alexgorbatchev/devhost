import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState, type JSX } from "react";
import { expect, waitFor, within } from "storybook/test";

import { HighlightOverlay } from "../index";
import { StoryContainer } from "./StoryContainer";
import { StorybookThemeProvider } from "./storybookTheme";

function HighlightOnlyScene(): JSX.Element {
  const [targetElement, setTargetElement] = useState<HTMLButtonElement | null>(null);
  const highlights = useMemo(() => {
    if (targetElement === null) {
      return [];
    }

    return [{ id: "highlight-only", readRectangle: () => targetElement.getBoundingClientRect() }];
  }, [targetElement]);

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
        <HighlightOverlay highlights={highlights} />
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
  title: "@alexgorbatchev/devhost-ui/devtools/shared/HighlightOverlay",
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

    expect(Math.abs(highlightRectangle.x - (targetRectangle.x - 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(highlightRectangle.y - (targetRectangle.y - 1))).toBeLessThanOrEqual(1);
    expect(Math.abs(highlightRectangle.width - (targetRectangle.width + 4))).toBeLessThanOrEqual(1);
    expect(Math.abs(highlightRectangle.height - (targetRectangle.height + 2))).toBeLessThanOrEqual(1);
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
