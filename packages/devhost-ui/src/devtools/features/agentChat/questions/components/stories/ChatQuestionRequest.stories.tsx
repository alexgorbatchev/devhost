import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatQuestionRequest } from "../ChatQuestionRequest";
import { ChatRequestsFixture } from "../../../components/stories/helpers";
import { fixture_codexQuestion, fixture_claudeQuestion } from "./fixtures";
const meta: Meta<typeof ChatQuestionRequest> = {
  component: ChatQuestionRequest,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/questions/components/ChatQuestionRequest",
  render: () => <ChatRequestsFixture target="questions" request={fixture_codexQuestion} />,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const CodexSecret: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Submit Answers" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("radio", { name: /Native/ }));
    const secret = canvas.getByLabelText("Answer");
    await expect(secret).toHaveAttribute("type", "password");
    await userEvent.type(secret, "private-token");
    await userEvent.click(canvas.getByRole("button", { name: "Submit Answers" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"library":{"answers":["Native"]}');
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"secret":{"answers":["private-token"]}');
    await expect(canvas.getByRole("button", { name: "Submit Answers" })).toBeDisabled();
  },
};
export const ClaudeMultiple: Story = {
  render: () => <ChatRequestsFixture target="questions" request={fixture_claudeQuestion} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("**Search preview**")).toBeVisible();
    await userEvent.click(canvas.getByRole("checkbox", { name: /Search/ }));
    await userEvent.click(canvas.getByRole("checkbox", { name: /History/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Submit Answers" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"Which features?":"Search, History"');
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('"metadata":{"source":"native"}');
  },
};
export const OtherAnswer: Story = {
  render: () => <ChatRequestsFixture target="questions" request={fixture_claudeQuestion} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: "Other answer" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Other answer" }), "A native alternative");
    await userEvent.click(canvas.getByRole("button", { name: "Submit Answers" }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent(
      '"Which features?":"A native alternative"',
    );
  },
};
export const TransportError: Story = {
  render: () => <ChatRequestsFixture target="questions" request={fixture_claudeQuestion} shouldFail />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: /Search/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Submit Answers" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("no longer pending");
    await expect(canvas.getByRole("checkbox", { name: /Search/ })).toBeChecked();
  },
};
