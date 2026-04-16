import type { Meta, StoryObj } from "@storybook/react-vite";
import type { JSX } from "react";

import { Main } from "../Main";

const meta: Meta<typeof Main> = {
  title: "devhost-test-app/marketingCapture/Main",
  component: Main,
  render: (): JSX.Element => {
    return <div data-testid="MarketingCaptureMainStory">Marketing capture main story placeholder.</div>;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as Main };
