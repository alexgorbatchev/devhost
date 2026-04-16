import type { Meta, StoryObj } from "@storybook/react-vite";
import type { JSX } from "react";

import { MarketingCapturePage } from "../MarketingCapturePage";

const meta: Meta<typeof MarketingCapturePage> = {
  title: "devhost-test-app/marketingCapture/MarketingCapturePage",
  component: MarketingCapturePage,
  render: (): JSX.Element => {
    return <div data-testid="MarketingCapturePageStory">Marketing capture story placeholder.</div>;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as MarketingCapturePage };
