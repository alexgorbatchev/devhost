import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { TabShareContext } from "../../TabShareContext";
import { TabShareActions } from "../TabShareActions";
const share = fn(async () => {});
const meta: Meta<typeof TabShareActions> = {
  component: TabShareActions,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/TabShareActions",
  render: () => (
    <TabShareContext value={{ stream: undefined, isRequesting: false, error: null, share, stop: fn() }}>
      <TabShareActions />
    </TabShareContext>
  ),
};
export default meta;
type Story = StoryObj<typeof meta>;
const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Share Tab" }));
    expect(share).toHaveBeenCalledOnce();
  },
};
export { Default as TabShareActions };
