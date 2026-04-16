import type { Meta, StoryObj } from "@storybook/react-vite";
import type { JSX } from "react";

import { DevhostMockShell } from "../DevhostMockShell";

const meta: Meta<typeof DevhostMockShell> = {
  title: "devhost-test-app/devhostMock/DevhostMockShell",
  component: DevhostMockShell,
  render: (): JSX.Element => {
    return <div data-testid="DevhostMockShellStory">Capture shell story placeholder.</div>;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as DevhostMockShell };
