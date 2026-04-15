import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SectionHeader } from "../SectionHeader";

const meta: Meta<typeof SectionHeader> = {
  title: "devhost-test-app/components/ui/SectionHeader",
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
    await expect(canvas.getByText("Keep the routed debugging loop close to the page.")).toBeInTheDocument();
  },
};

export const TitleOnly: Story = {
  args: {
    title: "Title-only section",
    titleId: "section-header-story-title-only",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Title-only section" })).toBeInTheDocument();
    await expect(canvas.queryByText(/routed debugging loop/i)).not.toBeInTheDocument();
  },
};

export { Default as SectionHeader };
