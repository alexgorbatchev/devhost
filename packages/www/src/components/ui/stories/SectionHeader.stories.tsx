import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SectionHeader } from "../SectionHeader";

const meta: Meta<typeof SectionHeader> = {
  component: SectionHeader,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    description: "Keep the routed debugging loop close to the page.",
    title: "A routed development surface, not another localhost wrapper.",
    titleId: "section-header-story-title",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("SectionHeader")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "A routed development surface, not another localhost wrapper." }),
    ).toBeInTheDocument();
  },
};

export { Default as SectionHeader };
