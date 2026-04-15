import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { LogMinimap } from "../LogMinimap";
import type { ServiceLogEntry } from "../../../shared/types";

const mockEntries: ServiceLogEntry[] = Array.from({ length: 50 }).map((_, i) => ({
  id: i + 1,
  line: `Mock log line ${i + 1} ${i % 5 === 0 ? "with some error details to show stderr" : ""}`,
  serviceName: "api",
  stream: i % 5 === 0 ? "stderr" : "stdout",
}));

const meta: Meta<typeof LogMinimap> = {
  title: "@alexgorbatchev/devhost/devtools/features/minimap/LogMinimap",
  component: LogMinimap,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align="right">
          <LogMinimap {...args} />
        </StoryContainer>
      </ThemeProvider>
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
