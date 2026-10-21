import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ApprovalRequests } from "../ApprovalRequests";
import { ChatRequestsFixture, NativeQuestionsFixture } from "./helpers";
import { fixture_commandRequest, fixture_unknownRequest } from "./fixtures";
const meta: Meta<typeof ApprovalRequests> = {
  component: ApprovalRequests,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ApprovalRequests",
  render: () => <ChatRequestsFixture request={fixture_commandRequest} />,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const ExplicitApproval: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/"command": "bun test"/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Always Allow" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Allow Once" }));
    await expect(within(canvas.getByRole("region", { name: "Run command" })).getByRole("status")).toHaveTextContent(
      "Decision sent",
    );
    await expect(within(canvas.getByRole("region", { name: "Run command" })).getByRole("status")).not.toHaveTextContent(
      "Approved, running",
    );
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"requestId":7');
  },
};
export const Unsupported: Story = {
  render: () => <ChatRequestsFixture request={fixture_unknownRequest} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "Unsupported agent request" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Allow Once" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByText("Native request details"));
    await expect(canvas.getByText(/Native-only interaction/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Stop Turn" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent("Interrupted");
  },
};
export const Questions: Story = {
  render: () => <NativeQuestionsFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("form", { name: "Agent questions" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Allow Once" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Stop Turn" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent("Interrupted");
  },
};
