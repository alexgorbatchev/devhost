import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

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
        <StoryContainer align={args.minimapPosition === "left" ? "left" : "right"}>
          <LogMinimap {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultRight: Story = {
  args: {
    entries: mockEntries,
    isHovered: false,
    minimapPosition: "right",
    onHoveredChange: fn(),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LogMinimap")).toBeInTheDocument();
    
    const minimapCanvas = canvas.getByTestId("LogMinimap--canvas");
    await expect(minimapCanvas).toBeInTheDocument();
    
    // Simulate hover interactions
    await userEvent.hover(minimapCanvas);
    await expect(args.onHoveredChange).toHaveBeenCalledWith(true);
    
    await userEvent.unhover(minimapCanvas);
    await expect(args.onHoveredChange).toHaveBeenCalledWith(false);
  },
};

export const HoveredRight: Story = {
  args: {
    entries: mockEntries,
    isHovered: true,
    minimapPosition: "right",
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LogMinimap")).toBeInTheDocument();
    await expect(canvas.getByTestId("LogMinimap--canvas")).toBeInTheDocument();
  },
};

export const DefaultLeft: Story = {
  args: {
    entries: mockEntries,
    isHovered: false,
    minimapPosition: "left",
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LogMinimap")).toBeInTheDocument();
    await expect(canvas.getByTestId("LogMinimap--canvas")).toBeInTheDocument();
  },
};

export const HoveredLeft: Story = {
  args: {
    entries: mockEntries,
    isHovered: true,
    minimapPosition: "left",
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LogMinimap")).toBeInTheDocument();
    await expect(canvas.getByTestId("LogMinimap--canvas")).toBeInTheDocument();
  },
};
