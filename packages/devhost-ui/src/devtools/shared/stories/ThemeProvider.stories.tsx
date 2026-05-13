import type { Meta, StoryObj } from "@storybook/react";

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
};

export const Light: Story = {
  args: {
    colorScheme: "light",
  },
};
