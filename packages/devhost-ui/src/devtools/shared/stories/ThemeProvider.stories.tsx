import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../ThemeProvider";
import { useDevtoolsTheme } from "../useDevtoolsTheme";

function ThemeConsumer() {
  const theme = useDevtoolsTheme();
  return (
    <div
      data-testid="theme-consumer"
      style={{
        background: theme.colors.background,
        color: theme.colors.foreground,
      }}
    >
      Background: {theme.colors.background}
    </div>
  );
}

const meta: Meta<typeof ThemeProvider> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/ThemeProvider",
  component: ThemeProvider,
  render: (args) => {
    return (
      <ThemeProvider {...args}>
        <ThemeConsumer />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Dark: Story = {
  args: {
    colorScheme: "dark",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const consumer = await canvas.findByTestId("theme-consumer");
    await expect(consumer).toBeInTheDocument();
    await expect(consumer).toHaveTextContent("Background: hsl(229 18.644% 23.137%)");
  },
};

export const Light: Story = {
  args: {
    colorScheme: "light",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const consumer = await canvas.findByTestId("theme-consumer");
    await expect(consumer).toBeInTheDocument();
    await expect(consumer).toHaveTextContent("Background: hsl(220 23.077% 94.902%)");
  },
};
