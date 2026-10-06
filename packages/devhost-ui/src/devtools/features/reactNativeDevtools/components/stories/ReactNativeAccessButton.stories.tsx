import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ReactNativeAccessButton } from "../ReactNativeAccessButton";

const onOpen = fn();
const meta: Meta<typeof ReactNativeAccessButton> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/reactNativeDevtools/components/ReactNativeAccessButton",
  component: ReactNativeAccessButton,
  args: { isAvailable: true, isActionPending: false, onOpen },
  beforeEach: () => {
    onOpen.mockClear();
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "React DevTools" });
    await expect(button).not.toHaveAttribute("aria-pressed");
    await expect(button).toHaveAttribute(
      "title",
      "Open native DevTools for this React host; select Components or Profiler there",
    );
    await userEvent.click(button);
    await expect(onOpen).toHaveBeenCalledTimes(1);
  },
};
export const Unavailable: Story = {
  args: { isAvailable: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button", { name: "React DevTools" })).toBeNull();
    await expect(onOpen).not.toHaveBeenCalled();
  },
};
export const ActionPending: Story = {
  args: { isActionPending: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "React DevTools" });
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(onOpen).not.toHaveBeenCalled();
  },
};
