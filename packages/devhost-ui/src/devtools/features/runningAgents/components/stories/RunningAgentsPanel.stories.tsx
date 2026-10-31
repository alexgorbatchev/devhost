import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "storybook/test";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";
import type { RunningAgent } from "../../../../shared/readRunningAgents";
import { RunningAgentsPanel } from "../RunningAgentsPanel";

const working: RunningAgent = {
  key: "claude-code:1",
  harness: "claude-code",
  state: "working",
  name: "fix-heading",
  subdirectory: ".",
  lastActivity: Date.now(),
  isOwned: true,
};
const waiting: RunningAgent = {
  key: "codex:2",
  harness: "codex",
  state: "waiting",
  subdirectory: "packages/ui",
  lastActivity: Date.now() - 120_000,
  isOwned: false,
};
const unknown: RunningAgent = { ...waiting, key: "pi:3", harness: "pi", state: "unknown", subdirectory: "." };
const idle: RunningAgent = { ...waiting, key: "codex:4", state: "idle" };

const meta: Meta<typeof RunningAgentsPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/runningAgents/components/RunningAgentsPanel",
  component: RunningAgentsPanel,
  args: { activityURL: "http://127.0.0.1:4000/__devhost__/agents/activity?chatTarget=project" },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <RunningAgentsPanel {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEachAgentsState: Story = {
  args: { agents: [waiting, working, unknown] },
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Running agents: 3" }));
    const rows = await canvas.findAllByTestId("RunningAgentsPanel--agent");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("codex");
    expect(rows[0]).toHaveTextContent("Waiting for approval · packages/ui · 2m ago");
    expect(rows[1]).toHaveTextContent("claude-code · fix-heading · this chat");
    expect(rows[2]).toHaveTextContent("Running, state unknown");
  },
};

export const LinksToLiveActivityOnTheDirectOrigin: Story = {
  args: { agents: [working] },
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Running agents: 1" }));
    const link = await canvas.findByRole("link", { name: "Watch Live Activity" });
    expect(new URL(link.getAttribute("href") ?? "").origin).toBe("http://127.0.0.1:4000");
    expect(link).toHaveAttribute("rel", "noreferrer");
  },
};

export const HidesTheLinkWithoutADirectOrigin: Story = {
  args: { agents: [working], activityURL: "" },
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Running agents: 1" }));
    await canvas.findAllByTestId("RunningAgentsPanel--agent");
    expect(canvas.queryByRole("link", { name: "Watch Live Activity" })).toBeNull();
  },
};

export const SpinsWhileAnAgentWorks: Story = {
  args: { agents: [working] },
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Running agents: 1" });
    expect(trigger.querySelector('[data-spinning="true"]')).not.toBeNull();
  },
};

export const StaysStillWithNoAgentWorking: Story = {
  args: { agents: [idle] },
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Running agents: 1" });
    expect(trigger.querySelector('[data-spinning="true"]')).toBeNull();
  },
};

export const HiddenWithNoAgents: Story = {
  args: { agents: [] },
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    expect(canvas.queryByRole("button", { name: /Running agents/ })).toBeNull();
  },
};
