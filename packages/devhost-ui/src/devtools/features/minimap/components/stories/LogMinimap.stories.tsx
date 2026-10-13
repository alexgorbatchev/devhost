import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StoryContainer,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { LogMinimap } from "../LogMinimap";
import type { ServiceLogEntry } from "../../../../shared/types";
import { readContrastRatio } from "../../../../../../../../test-support/readContrastRatio";
import { fixture_ansiContrastEntries } from "./fixtures";
import { LogMinimapLiveEntriesHarness, LogMinimapThemeChangeHarness } from "./helpers";

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
  return canvas.getAllByTestId("LogMinimap--preview-line").map((line: HTMLElement): string => line.textContent ?? "");
}

function readPreviewServiceNames(canvas: ReturnType<typeof within>): string[] {
  return canvas
    .getAllByTestId("LogMinimap--preview-service")
    .map((cell: HTMLElement): string => cell.textContent ?? "");
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
    // Collapsed, the minimap is a narrow always-visible strip on the right edge.
    await expect(logMinimap.getBoundingClientRect().width).toBe(12);
    await expect(Math.round(logMinimap.getBoundingClientRect().right)).toBe(window.innerWidth);

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
    await waitFor(() => expect(canvas.getByTestId("LogMinimap").getBoundingClientRect().width).toBe(96));
    await assertHoveredPreview(canvas);
    await expect(readPreviewServiceNames(canvas).length).toBeGreaterThan(0);
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

export const ServiceColumns: Story = {
  args: {
    entries: [
      { id: 1, serviceName: "api", line: "[api] Ready", stream: "stdout" },
      { id: 2, serviceName: "long-background-worker", line: "[long-background-worker] Working", stream: "stdout" },
    ],
    isHovered: true,
    onHoveredChange: fn(),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await assertHoveredPreview(canvas);
    await expect(readPreviewRowTexts(canvas)).toEqual(["Ready", "Working"]);
    const services = canvas.getAllByTestId("LogMinimap--preview-service");
    const lines = canvas.getAllByTestId("LogMinimap--preview-line");
    await waitFor(() => {
      const preview = canvas.getByTestId("LogMinimap--preview").getBoundingClientRect();
      const minimap = canvas.getByTestId("LogMinimap").getBoundingClientRect();
      expect(Math.round(preview.left)).toBe(6);
      expect(Math.round(preview.right)).toBe(Math.round(minimap.left - 6));
      expect(lines[0]!.getBoundingClientRect().left).toBe(lines[1]!.getBoundingClientRect().left);
      for (const service of services) {
        expect(service.scrollWidth).toBeLessThanOrEqual(service.clientWidth);
        expect(service.getBoundingClientRect().left).toBe(services[0]!.getBoundingClientRect().left);
        expect(service.getBoundingClientRect().right).toBeLessThan(lines[0]!.getBoundingClientRect().left);
      }
    });
  },
};

export const StableServiceColumn: Story = {
  args: {
    entries: Array.from({ length: 80 }, (_, index) => ({
      id: index + 1,
      serviceName: index === 0 ? "long-background-worker" : "api",
      line: `Message ${index + 1}`,
      stream: "stdout",
    })),
    isHovered: true,
    onHoveredChange: fn(),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const minimap = canvas.getByTestId("LogMinimap");
    await assertHoveredPreview(canvas);
    const bounds = minimap.getBoundingClientRect();
    await userEvent.pointer({ target: minimap, coords: { clientX: bounds.right - 1, clientY: bounds.bottom - 1 } });
    await waitFor(() => expect(readPreviewServiceNames(canvas).every((name) => name === "api")).toBe(true));
    const messageLeft = canvas.getAllByTestId("LogMinimap--preview-line")[0]!.getBoundingClientRect().left;
    await userEvent.pointer({ target: minimap, coords: { clientX: bounds.right - 1, clientY: bounds.bottom - 238 } });
    await waitFor(() => expect(readPreviewServiceNames(canvas)[0]).toBe("long-background-worker"));
    await expect(canvas.getAllByTestId("LogMinimap--preview-line")[0]!.getBoundingClientRect().left).toBe(messageLeft);
  },
};

export const LiveServiceColumn: Story = {
  render: (_args, context) => (
    <StorybookThemeProvider globals={context.globals}>
      <LogMinimapLiveEntriesHarness />
    </StorybookThemeProvider>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await assertHoveredPreview(canvas);
    await expect(readPreviewRowTexts(canvas)).toEqual(["Ready"]);
    const messageLeft = canvas.getByTestId("LogMinimap--preview-line").getBoundingClientRect().left;
    await userEvent.click(canvas.getByRole("button", { name: "Append worker output" }));
    await assertHoveredPreview(canvas);
    const minimap = canvas.getByTestId("LogMinimap");
    const bounds = minimap.getBoundingClientRect();
    await userEvent.pointer({ target: minimap, coords: { clientX: bounds.right - 1, clientY: bounds.bottom - 1 } });
    await expect(readPreviewRowTexts(canvas)).toEqual(["Ready", "Working"]);
    await expect(canvas.getAllByTestId("LogMinimap--preview-line")[0]!.getBoundingClientRect().left).toBe(messageLeft);
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

export const FocusedErrorDark: Story = {
  globals: { devhostTheme: "dark" },
  args: {
    entries: [{ id: 1, line: "Database connection failed", serviceName: "api", stream: "stderr" }],
    isHovered: true,
    onHoveredChange: fn(),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await assertHoveredPreview(canvas);
    await expect(canvas.getByTestId("LogMinimap--preview-line")).toHaveTextContent("Database connection failed");
    await expect(readContrastRatio(canvas.getByTestId("LogMinimap--preview-line"))).toBeGreaterThanOrEqual(4.5);
    await expect(readContrastRatio(canvas.getByTestId("LogMinimap--preview-service"))).toBeGreaterThanOrEqual(4.5);
  },
};

export const FocusedErrorLight: Story = {
  ...FocusedErrorDark,
  globals: { devhostTheme: "light" },
  play: FocusedErrorDark.play,
};

export const AnsiContrastDark: Story = {
  globals: { devhostTheme: "dark" },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <LogMinimap {...args} />
      </StorybookThemeProvider>,
    ),
  args: { entries: fixture_ansiContrastEntries, isHovered: true, onHoveredChange: fn() },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await assertHoveredPreview(canvas);
    await expect(readPreviewRowTexts(canvas)).toEqual([
      "Standard black",
      "Bright white",
      "Indexed dark",
      "Truecolor dark",
      "Truecolor light",
      "Same-color pair",
      "Inherited on white",
      "Inherited on black",
      "Dim inherited",
      "Dim color pair",
      "Readable decorated",
      "Saturated pair",
    ]);
    for (const text of readPreviewRowTexts(canvas)) {
      await expect(readContrastRatio(canvas.getByText(text))).toBeGreaterThanOrEqual(4.5);
    }
    await expect(getComputedStyle(canvas.getByText("Same-color pair")).backgroundColor).toBe("rgb(128, 128, 128)");
    await expect(getComputedStyle(canvas.getByText("Dim color pair")).backgroundColor).toBe("rgb(128, 128, 128)");
    await expect(getComputedStyle(canvas.getByText("Readable decorated")).color).toBe("rgb(51, 255, 51)");
    await expect(getComputedStyle(canvas.getByText("Readable decorated")).fontStyle).toBe("italic");
    await expect(getComputedStyle(canvas.getByText("Readable decorated")).textDecorationLine).toBe(
      "underline line-through",
    );
    const firstRow = canvas.getAllByTestId("LogMinimap--preview-service")[0].parentElement!;
    const focusedBackground = getComputedStyle(firstRow).backgroundColor;
    const minimap = canvas.getByTestId("LogMinimap");
    const bounds = minimap.getBoundingClientRect();
    await userEvent.pointer({ target: minimap, coords: { clientX: bounds.right - 1, clientY: bounds.bottom - 1 } });
    await waitFor(() => expect(getComputedStyle(firstRow).backgroundColor).not.toBe(focusedBackground));
    for (const text of readPreviewRowTexts(canvas)) {
      await expect(readContrastRatio(canvas.getByText(text))).toBeGreaterThanOrEqual(4.5);
    }
  },
};

export const AnsiContrastLight: Story = {
  ...AnsiContrastDark,
  globals: { devhostTheme: "light" },
  play: AnsiContrastDark.play,
};

export const AnsiErrorContrastDark: Story = {
  ...AnsiContrastDark,
  args: {
    ...AnsiContrastDark.args,
    entries: fixture_ansiContrastEntries.map((entry) => ({ ...entry, stream: "stderr" })),
  },
  play: AnsiContrastDark.play,
};

export const AnsiErrorContrastLight: Story = {
  ...AnsiErrorContrastDark,
  globals: { devhostTheme: "light" },
  play: AnsiErrorContrastDark.play,
};

export const AnsiContrastThemeChange: Story = {
  render: () => <LogMinimapThemeChangeHarness />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Switch to light" })).toHaveFocus();
    await assertHoveredPreview(canvas);
    const darkText = canvas.getByText("Truecolor dark");
    const darkForeground = getComputedStyle(darkText).color;
    await expect(readContrastRatio(darkText)).toBeGreaterThanOrEqual(4.5);
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Switch to dark" })).toBeInTheDocument();
    await expect(canvas.getByText("Truecolor dark")).toBe(darkText);
    await waitFor(() => expect(getComputedStyle(darkText).color).not.toBe(darkForeground));
    for (const text of readPreviewRowTexts(canvas)) {
      await expect(readContrastRatio(canvas.getByText(text))).toBeGreaterThanOrEqual(4.5);
    }
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Switch to light" })).toBeInTheDocument();
    await waitFor(() => expect(getComputedStyle(darkText).color).toBe(darkForeground));
    for (const text of readPreviewRowTexts(canvas)) {
      await expect(readContrastRatio(canvas.getByText(text))).toBeGreaterThanOrEqual(4.5);
    }
  },
};
