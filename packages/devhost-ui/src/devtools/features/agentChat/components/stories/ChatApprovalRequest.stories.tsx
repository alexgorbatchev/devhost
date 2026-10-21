import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatApprovalRequest } from "../ChatApprovalRequest";
import { ChatRequestsFixture } from "./helpers";
import { fixture_commandRequest, fixture_fileRequest, fixture_fileEvents } from "./fixtures";
const meta: Meta<typeof ChatApprovalRequest> = {
  component: ChatApprovalRequest,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatApprovalRequest",
  render: () => <ChatRequestsFixture target="approval" request={fixture_commandRequest} />,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Deny: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Deny" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"decision":"decline"');
    await expect(canvas.queryByRole("button", { name: "Allow Once" })).not.toBeInTheDocument();
  },
};
export const ProposedFileDiff: Story = {
  render: () => <ChatRequestsFixture target="approval" request={fixture_fileRequest} events={fixture_fileEvents} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Proposed diff for /project/app.ts")).toHaveTextContent("+hello world");
    await userEvent.click(canvas.getByRole("button", { name: "Allow Once" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"decision":"accept"');
  },
};
export const MissingFileDiff: Story = {
  render: () => <ChatRequestsFixture target="approval" request={fixture_fileRequest} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("The harness has not supplied a file diff for this request.")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Allow Once" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Deny" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"decision":"decline"');
  },
};
export const SendError: Story = {
  render: () => <ChatRequestsFixture target="approval" request={fixture_commandRequest} shouldFail />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Allow Once" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("no longer pending");
    await expect(canvas.getByRole("button", { name: "Allow Once" })).toBeEnabled();
  },
};
