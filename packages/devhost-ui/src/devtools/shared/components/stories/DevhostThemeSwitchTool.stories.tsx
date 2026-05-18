import type { Meta, StoryObj } from "@storybook/react";
import type { JSX } from "react";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import type { DevtoolsColorScheme } from "../../DevtoolsColorScheme";
import { DevhostThemeSwitchTool, type IDevhostThemeSwitchToolProps } from "../DevhostThemeSwitchTool";

function DevhostThemeSwitchToolHarness({
  colorScheme,
  onSelectColorScheme,
}: IDevhostThemeSwitchToolProps): JSX.Element {
  const [selectedColorScheme, setSelectedColorScheme] = useState<DevtoolsColorScheme>(() => colorScheme);

  function handleSelectColorScheme(nextColorScheme: DevtoolsColorScheme): void {
    setSelectedColorScheme(nextColorScheme);
    onSelectColorScheme(nextColorScheme);
  }

  return <DevhostThemeSwitchTool colorScheme={selectedColorScheme} onSelectColorScheme={handleSelectColorScheme} />;
}

const meta: Meta<typeof DevhostThemeSwitchTool> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/DevhostThemeSwitchTool",
  component: DevhostThemeSwitchTool,
  render: (args) => {
    return <DevhostThemeSwitchToolHarness {...args} />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const LightSelected: Story = {
  args: {
    colorScheme: "light",
    onSelectColorScheme: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const lightButton = canvas.getByRole("button", { name: "Use light preview theme" });
    const darkButton = canvas.getByRole("button", { name: "Use dark preview theme" });

    await expect(lightButton).toHaveAttribute("aria-pressed", "true");
    await expect(darkButton).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(darkButton);

    await expect(lightButton).toHaveAttribute("aria-pressed", "false");
    await expect(darkButton).toHaveAttribute("aria-pressed", "true");
    await expect(args.onSelectColorScheme).toHaveBeenCalledWith("dark");
  },
};

export const DarkSelected: Story = {
  args: {
    colorScheme: "dark",
    onSelectColorScheme: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const lightButton = canvas.getByRole("button", { name: "Use light preview theme" });
    const darkButton = canvas.getByRole("button", { name: "Use dark preview theme" });

    await expect(lightButton).toHaveAttribute("aria-pressed", "false");
    await expect(darkButton).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(lightButton);

    await expect(lightButton).toHaveAttribute("aria-pressed", "true");
    await expect(darkButton).toHaveAttribute("aria-pressed", "false");
    await expect(args.onSelectColorScheme).toHaveBeenCalledWith("light");
  },
};
