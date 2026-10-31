import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "storybook/test";
import { AgentActivityPage } from "../AgentActivityPage";
import { installAgentActivityStream, sendAgentActivity } from "./helpers";

const meta: Meta<typeof AgentActivityPage> = {
  component: AgentActivityPage,
  title: "@alexgorbatchev/devhost-ui/statusPages/components/AgentActivityPage",
  args: {
    title: "Agent activity",
    message: "What the agents in this checkout do from now on.",
    streamURL: "ws://127.0.0.1:4000/__devhost__/ws/agents/activity",
  },
  beforeEach: installAgentActivityStream,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const WaitsForActivityWithoutHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByText("Waiting for activity")).toBeVisible();
    expect(await canvas.findByText("Live")).toBeVisible();
  },
};

export const ShowsNormalizedEventsNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Live");
    sendAgentActivity({
      harness: "codex",
      pid: 1,
      eventType: "turn_start",
      timestamp: 1,
      role: "user",
      text: "Fix the heading",
    });
    sendAgentActivity({
      harness: "claude-code",
      pid: 2,
      eventType: "tool_result",
      timestamp: 2,
      toolName: "Read",
      text: "denied",
      isError: true,
    });
    await waitFor(() => expect(canvas.getAllByTestId("AgentActivityPage--event")).toHaveLength(2));
    const events = canvas.getAllByTestId("AgentActivityPage--event");
    expect(events[0]).toHaveTextContent("claude-code · tool_result · Read");
    expect(events[0]).toHaveTextContent("denied");
    expect(events[1]).toHaveTextContent("Fix the heading");
  },
};
