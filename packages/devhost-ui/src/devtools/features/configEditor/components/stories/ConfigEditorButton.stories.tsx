import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { ConfigEditorButton } from "../ConfigEditorButton";

const onToggle = fn();
const meta: Meta<typeof ConfigEditorButton> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/configEditor/components/ConfigEditorButton",
  component: ConfigEditorButton,
  args: { isOpen: false, isRejected: false, onToggle },
  beforeEach: (): void => {
    onToggle.mockClear();
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const button: HTMLElement = within(canvasElement).getByRole("button", { name: "Config" });

    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAttribute("aria-haspopup", "dialog");
    await expect(button).toHaveAttribute("title", "Edit the configuration");
    await userEvent.click(button);
    await expect(onToggle).toHaveBeenCalledTimes(1);
  },
};

export const Open: Story = {
  args: { isOpen: true },
  play: async ({ canvasElement }): Promise<void> => {
    const button: HTMLElement = within(canvasElement).getByRole("button", { name: "Config" });

    await expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(button);
    await expect(onToggle).toHaveBeenCalledTimes(1);
  },
};

export const AfterARejectedReload: Story = {
  args: { isRejected: true },
  play: async ({ canvasElement }): Promise<void> => {
    const button: HTMLElement = within(canvasElement).getByRole("button", { name: "Config" });

    await expect(button).toHaveAttribute("title", "Edit the configuration; devhost rejected its last change");
    await expect(button).toHaveAttribute("data-variant", "danger");
  },
};
