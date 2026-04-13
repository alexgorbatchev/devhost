import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { InsetList } from "../InsetList";

const meta: Meta<typeof InsetList> = {
  title: "components/ui/InsetList",
  component: InsetList,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    items: ["Start the edge.", "Run the manifest.", "Open the routed host."],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("InsetList")).toBeInTheDocument();
    await expect(canvas.getByText("Start the edge.")).toBeInTheDocument();
    await expect(canvas.getByText("Open the routed host.")).toBeInTheDocument();
  },
};

export { Default as InsetList };
