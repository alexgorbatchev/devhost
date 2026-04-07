import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button } from "../Button";
import { ThemeProvider } from "../ThemeProvider";

const meta: Meta<typeof Button> = {
  component: Button,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <Button {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    children: "Click me",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Click me" }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export { Default as Button };
