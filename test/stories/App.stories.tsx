import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { App } from "../App";

const meta: Meta<typeof App> = {
  component: App,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const themeSelect = canvas.getByLabelText("Theme");
    const scrollDepthButton = canvas.getByRole("button", { name: "Scroll depth" });

    await expect(canvas.getByRole("heading", { name: "Framer-style overlay audit surface" })).toBeInTheDocument();
    await userEvent.selectOptions(themeSelect, "light");
    await expect(themeSelect).toHaveValue("light");
    await userEvent.click(scrollDepthButton);
    await expect(scrollDepthButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("heading", { name: "Scroll depth stays attached" })).toBeInTheDocument();
  },
};

export { Default as App };
