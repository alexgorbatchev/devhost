import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";
import { ResourceUsagePanel } from "../ResourceUsagePanel";
import { fixture_calmUsage, fixture_mixedLevelUsage } from "./fixtures";
import { expectStableResourceWidth, ResourceUsageWidthScene } from "./helpers";

type ShadowCanvas = Awaited<ReturnType<typeof readDevtoolsStoryShadowCanvas>>;

const meta: Meta<typeof ResourceUsagePanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/resourceUsage/components/ResourceUsagePanel",
  component: ResourceUsagePanel,
  args: {
    usage: fixture_calmUsage,
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ResourceUsagePanel {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

function readMeter(canvas: ShadowCanvas, name: string): HTMLMeterElement {
  const meter: HTMLElement = canvas.getByRole("meter", { name });

  if (!(meter instanceof HTMLMeterElement)) {
    throw new Error(`"${name}" is not a native meter.`);
  }

  return meter;
}

/** All three readouts below the warning level, with the figures behind each percentage in its tooltip. */
export const AllReadouts: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const segment = within(canvas.getByRole("group", { name: "Host resource usage" }));

    await expect(readMeter(canvas, "CPU usage").value).toBe(18);
    await expect(readMeter(canvas, "RAM usage").value).toBe(31);
    await expect(readMeter(canvas, "Disk usage").value).toBe(41);
    await expect(
      segment.getAllByTestId("ResourceUsagePanel--readout").map((readout: HTMLElement): string => readout.title),
    ).toEqual(["CPU: 18% of 8 cores", "RAM: 9.8 of 32 GB used", "Disk: 212 of 512 GB used"]);
    await expect(segment.getByText("18%", { selector: "span" })).toBeVisible();
    await expect(segment.getByText("31%", { selector: "span" })).toBeVisible();
    await expect(segment.getByText("41%", { selector: "span" })).toBeVisible();
  },
};

/**
 * Normal, warning, and critical readouts. The meter picks its fill from the region the value falls in; browsers do
 * not expose that fill to scripts, so the story checks the regions and the heavier critical value.
 */
export const Levels: Story = {
  args: {
    usage: fixture_mixedLevelUsage,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const memoryMeter: HTMLMeterElement = readMeter(canvas, "RAM usage");
    const diskMeter: HTMLMeterElement = readMeter(canvas, "Disk usage");

    await expect(readMeter(canvas, "CPU usage").value).toBeLessThan(memoryMeter.low);
    await expect(memoryMeter.value).toBe(82);
    await expect(memoryMeter.value).toBeGreaterThanOrEqual(memoryMeter.low);
    await expect(memoryMeter.value).toBeLessThan(memoryMeter.high);
    await expect(diskMeter.value).toBe(97);
    await expect(diskMeter.value).toBeGreaterThan(diskMeter.high);
    // A critical value is also heavier, so the level does not rest on color alone.
    await expect(Number(getComputedStyle(canvas.getByText("97%", { selector: "span" })).fontWeight)).toBeGreaterThan(
      Number(getComputedStyle(canvas.getByText("82%", { selector: "span" })).fontWeight),
    );
  },
};

/** Readouts that are off, or have no reading, are left out. */
export const SingleReadout: Story = {
  args: {
    usage: { cpu: fixture_calmUsage.cpu },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(canvas.getAllByRole("meter")).toHaveLength(1);
    await expect(readMeter(canvas, "CPU usage").value).toBe(18);
  },
};

/** Without readings there is no segment, so the toolbar shows no empty group. */
export const NoReadings: Story = {
  args: {
    usage: null,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(canvas.getByRole("toolbar", { name: "devhost" })).toBeVisible();
    await expect(canvas.queryByRole("group", { name: "Host resource usage" })).toBeNull();
  },
};

/** A readout keeps its width from 5% to 100%, so the toolbar does not shift as a value changes. */
export const StableReadoutWidth: Story = {
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <ResourceUsageWidthScene />
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => expectStableResourceWidth(canvasElement),
};

export const StableSingleReadoutWidth: Story = {
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <ResourceUsageWidthScene hasSingleReadout />
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => expectStableResourceWidth(canvasElement),
};
