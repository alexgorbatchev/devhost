import { useState, type JSX } from "react";
import { expect, userEvent } from "storybook/test";

import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import { readDevtoolsStoryShadowCanvas } from "../../../../shared/components/stories/helpers";
import { ResourceUsagePanel } from "../ResourceUsagePanel";
import { factory_uniformUsage } from "./fixtures";

interface IResourceUsageWidthSceneProps {
  hasSingleReadout?: boolean;
}

export function ResourceUsageWidthScene({ hasSingleReadout = false }: IResourceUsageWidthSceneProps): JSX.Element {
  const [percent, setPercent] = useState<number>(5);
  const usage = factory_uniformUsage(percent);

  return (
    <>
      <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
        <ResourceUsagePanel usage={hasSingleReadout ? { cpu: usage.cpu } : usage} />
      </DevtoolsToolbar>
      {[0, 5, 70, 90, 100].map((value) => (
        <button key={value} type="button" onClick={(): void => setPercent(value)}>
          Set usage to {value}%
        </button>
      ))}
    </>
  );
}

export async function expectStableResourceWidth(canvasElement: HTMLElement): Promise<void> {
  const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const group = canvas.getByRole("group", { name: "Host resource usage" });
  const font = getComputedStyle(group);
  await document.fonts.load(`400 ${font.fontSize} ${font.fontFamily}`, "CPU RAM Disk 100%");
  await document.fonts.load(`600 ${font.fontSize} ${font.fontFamily}`, "CPU RAM Disk 100%");
  const readWidths = (): number[] =>
    canvas
      .getAllByTestId("ResourceUsagePanel--readout")
      .map((readout: HTMLElement) => readout.getBoundingClientRect().width);
  const widths = readWidths();
  const toolbar = canvas.getByRole("toolbar", { name: "devhost" });
  const toolbarWidth = toolbar.getBoundingClientRect().width;

  for (const percent of [0, 70, 90, 100, 5]) {
    await userEvent.click(canvas.getByRole("button", { name: `Set usage to ${percent}%` }));
    await expect(canvas.getAllByRole("meter").map((meter: HTMLElement) => meter.getAttribute("value"))).toEqual(
      widths.map(() => String(percent)),
    );
    await expect(readWidths()).toEqual(widths);
    await expect(toolbar.getBoundingClientRect().width).toBe(toolbarWidth);
  }
}
