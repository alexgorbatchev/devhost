import type { Meta, StoryObj } from "@storybook/preact-vite";
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
  title: "@alexgorbatchev/devhost/devtools/shared/ThemeProvider",
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
    await expect(consumer).toHaveTextContent("Background: #24283b");
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
    await expect(consumer).toHaveTextContent("Background: #e1e2e7");
  },
};
