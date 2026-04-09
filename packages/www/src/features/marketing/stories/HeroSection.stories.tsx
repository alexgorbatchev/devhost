import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { HeroSection } from "../HeroSection";

const meta: Meta<typeof HeroSection> = {
  component: HeroSection,
  render: () => {
    return <HeroSection themeControl={<button type="button">Theme control</button>} />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("HeroSection")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "devhost is the storefront for routed local stacks." }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Theme control" })).toBeInTheDocument();
  },
};

export { Default as HeroSection };
