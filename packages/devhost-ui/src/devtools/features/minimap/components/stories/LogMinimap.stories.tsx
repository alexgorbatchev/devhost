import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { StoryContainer } from "@/devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { LogMinimap } from "../LogMinimap";
import type { ServiceLogEntry } from "../../../../shared/types";

const mockEntries: ServiceLogEntry[] = Array.from({ length: 50 }).map((_, i) => ({
  id: i + 1,
  line: `Mock log line ${i + 1} ${i % 5 === 0 ? "with some error details to show stderr" : ""}`,
  serviceName: "api",
  stream: i % 5 === 0 ? "stderr" : "stdout",
}));

const ansiEntries: ServiceLogEntry[] = [
  {
    id: 1,
    line: "\u001b[38;2;12;34;56mANSI colored output\u001b[0m",
    serviceName: "api",
    stream: "stdout",
  },
  {
    id: 2,
    line: "\u001b[1;31mStyled error output\u001b[0m",
    serviceName: "api",
    stream: "stderr",
  },
];

const clippedEntries: ServiceLogEntry[] = [
  {
    id: 1,
    line: "This is a very long log line that should stay on exactly one preview row even when it exceeds the preview width by a lot.",
    serviceName: "api",
    stream: "stdout",
  },
  {
    id: 2,
    line: "Short line",
    serviceName: "api",
    stream: "stderr",
  },
];

const meta: Meta<typeof LogMinimap> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/minimap/components/LogMinimap",
  component: LogMinimap,
  render: (args, context) => {
    return (
      <StorybookThemeProvider globals={context.globals}>
        <StoryContainer align="right">
          <LogMinimap {...args} />
        </StoryContainer>
      </StorybookThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

async function assertHoveredPreview(canvas: ReturnType<typeof within>): Promise<void> {
  const logMinimap = canvas.getByTestId("LogMinimap");

  await userEvent.hover(logMinimap);

  await waitFor(() => {
    expect(canvas.getByTestId("LogMinimap--preview-overlay")).toBeInTheDocument();
    expect(canvas.getByTestId("LogMinimap--preview")).toBeInTheDocument();
  });

  await expect(canvas.getByTestId("LogMinimap--preview").querySelectorAll("li").length).toBeGreaterThan(0);
}

function readPreviewRowTexts(canvas: ReturnType<typeof within>): string[] {
  const preview: HTMLElement = canvas.getByTestId("LogMinimap--preview");
  const items: NodeListOf<HTMLLIElement> = preview.querySelectorAll("li");

  return Array.from(items, (item: HTMLLIElement): string => item.textContent ?? "");
}

export const Default: Story = {
  args: {
    entries: mockEntries,
    isHovered: false,
    onHoveredChange: fn(),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    const logMinimap = canvas.getByTestId("LogMinimap");
    await expect(logMinimap).toBeInTheDocument();

    const minimapCanvas = canvas.getByTestId("LogMinimap--canvas");
    await expect(minimapCanvas).toBeInTheDocument();

    // Simulate hover interactions on the wrapper, not the canvas which has pointer-events: none
    await userEvent.hover(logMinimap);
    await expect(args.onHoveredChange).toHaveBeenCalledWith(true);

    await userEvent.unhover(logMinimap);
    await expect(args.onHoveredChange).toHaveBeenCalledWith(false);
  },
};

export const Hovered: Story = {
  args: {
    entries: mockEntries,
    isHovered: true,
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LogMinimap")).toBeInTheDocument();
    await expect(canvas.getByTestId("LogMinimap--canvas")).toBeInTheDocument();
    await assertHoveredPreview(canvas);
  },
};

export const AnsiStyled: Story = {
  args: {
    entries: ansiEntries,
    isHovered: true,
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await assertHoveredPreview(canvas);

    await waitFor(() => {
      expect(readPreviewRowTexts(canvas)).toEqual(["ANSI colored output", "Styled error output"]);
    });
  },
};

export const ClippedLines: Story = {
  args: {
    entries: clippedEntries,
    isHovered: true,
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await assertHoveredPreview(canvas);

    await waitFor(() => {
      expect(readPreviewRowTexts(canvas)).toEqual([
        "This is a very long log line that should stay on exactly one preview row even when it exceeds the preview width by a lot.",
        "Short line",
      ]);
    });
  },
};

export const Empty: Story = {
  args: {
    entries: [],
    isHovered: false,
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("LogMinimap")).not.toBeInTheDocument();
  },
};
