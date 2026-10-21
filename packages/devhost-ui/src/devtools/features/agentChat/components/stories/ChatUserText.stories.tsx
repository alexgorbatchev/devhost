import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readContrastRatio } from "../../../../../../../../test-support/readContrastRatio";
import { ChatUserText } from "../ChatUserText";
import { UserMessageScene } from "./helpers";

const meta: Meta<typeof ChatUserText> = {
  component: ChatUserText,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatUserText",
  render: () => <UserMessageScene />,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsedContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Page Context" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(canvas.getByText("Improve This Layout")).toBeVisible());
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(canvas.getByText(/"title": "Example Page"/)).toBeVisible());
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};

export const VisibleBubble: Story = {
  play: async ({ canvasElement }) => {
    const text = await within(canvasElement).findByText("Improve This Layout");
    const bubble = text.closest(".aui-user-message-content")!;
    await waitFor(() => expect(readContrastRatio(text)).toBeGreaterThanOrEqual(4.5));
    expect(Number.parseFloat(getComputedStyle(bubble).borderTopWidth)).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        readContrastRatio(bubble, { property: "borderTopColor", useParentBackground: true }),
      ).toBeGreaterThanOrEqual(3),
    );
  },
};

export const LightBubble: Story = {
  ...VisibleBubble,
  globals: { devhostTheme: "light" },
  play: VisibleBubble.play,
};
