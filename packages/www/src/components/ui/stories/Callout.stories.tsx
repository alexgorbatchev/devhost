import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Callout } from "../Callout";

const meta: Meta<typeof Callout> = {
  title: "components/ui/Callout",
  component: Callout,
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Important",
    children: (
      <>
        <p className="!mt-0">This is a callout component.</p>
        <p className="!mb-0">It can have multiple lines of text.</p>
      </>
    ),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Callout")).toBeInTheDocument();
    await expect(canvas.getByText("Important")).toBeInTheDocument();
    await expect(canvas.getByText("This is a callout component.")).toBeInTheDocument();
  },
};

export const WithoutTitle: Story = {
  args: {
    children: <p className="!mt-0 !mb-0">This is a callout without a title.</p>,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Callout")).toBeInTheDocument();
    await expect(canvas.getByText("This is a callout without a title.")).toBeInTheDocument();
  },
};
