import { useCallback, useState, type ComponentProps, type JSX } from "react";
import { expect, userEvent, waitFor } from "storybook/test";

import type { IWorktreeRepository } from "../../../../shared/types";
import { readDevtoolsStoryShadowCanvas } from "../../../../shared/components/stories/helpers";
import { ServiceStatusPanel } from "../ServiceStatusPanel";

type ServiceStatusPanelProps = ComponentProps<typeof ServiceStatusPanel>;

export async function exerciseHealthPollErrorContrast(
  canvasElement: HTMLElement,
  args: ServiceStatusPanelProps,
): Promise<void> {
  const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const trigger = await canvas.findByRole("button", { name: "Services: 2 of 3 up, 1 changed, error" });

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expectReadableServiceTrigger(trigger);
  await userEvent.hover(trigger);
  expectReadableServiceTrigger(trigger);
  await userEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  const panel = await canvas.findByRole("region", { name: "Services" });
  await waitFor(() => expect(panel).toBeVisible());
  await expect(canvas.getByRole("alert").textContent).toBe(args.errorMessage);
  await userEvent.unhover(trigger);
  expectReadableServiceTrigger(trigger);
  await userEvent.hover(trigger);
  expectReadableServiceTrigger(trigger);
  await userEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  await waitFor(() => expect(canvas.queryByRole("region", { name: "Services" })).toBeNull());
  expectReadableServiceTrigger(trigger);
}

function expectReadableServiceTrigger(trigger: HTMLElement): void {
  let surface: Element | null = trigger;
  let background: string = getComputedStyle(trigger).backgroundColor;
  while (background === "rgba(0, 0, 0, 0)" && surface.parentElement !== null) {
    surface = surface.parentElement;
    background = getComputedStyle(surface).backgroundColor;
  }
  const backgroundLuminance = readRelativeLuminance(background);
  const textLuminance = readRelativeLuminance(getComputedStyle(trigger).color);
  expect(readContrastRatio(textLuminance, backgroundLuminance)).toBeGreaterThanOrEqual(4.5);

  const indicators = trigger.querySelectorAll("svg, [data-state]");
  expect(indicators).toHaveLength(4);
  for (const indicator of indicators) {
    const style = getComputedStyle(indicator);
    const color = indicator instanceof SVGElement ? style.color : style.backgroundColor;
    expect(readContrastRatio(readRelativeLuminance(color), backgroundLuminance)).toBeGreaterThanOrEqual(3);
  }
}

// WCAG 2.2 sRGB relative luminance and contrast ratio, evaluated against the rendered toolbar surface.
function readRelativeLuminance(color: string): number {
  const weights: number[] = [0.2126, 0.7152, 0.0722];
  const channels = Array.from(color.matchAll(/[\d.]+/g), (match) => Number(match[0])).slice(0, 3);
  expect(channels).toHaveLength(3);
  return channels.reduce((sum, value, index) => {
    const channel = value / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * weights[index];
  }, 0);
}

function readContrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function WorktreePanelHarness(args: ServiceStatusPanelProps): JSX.Element {
  const [repositories, setRepositories] = useState<IWorktreeRepository[]>(args.repositories ?? []);
  const { onSwitchWorktree } = args;
  const onSwitch = useCallback(
    async (id: string, path: string): Promise<string | null> => {
      const error = (await onSwitchWorktree?.(id, path)) ?? null;
      setRepositories((current) =>
        current.map((repository) =>
          repository.id === id
            ? { ...repository, selectedPath: path, runningPath: error === null ? path : "", error: error ?? undefined }
            : repository,
        ),
      );
      return error;
    },
    [onSwitchWorktree],
  );
  return <ServiceStatusPanel {...args} repositories={repositories} onSwitchWorktree={onSwitch} />;
}
