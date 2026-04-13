import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { App } from "../App";
import { StoryContainer } from "../shared/stories/StoryContainer";

const meta: Meta<typeof App> = {
  title: "@alexgorbatchev/devhost/devtools/App",
  component: App,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  render: () => (
    <StoryContainer>
      <App />
    </StoryContainer>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AppContent")).toBeInTheDocument();
  },
};

export { Default as App };
