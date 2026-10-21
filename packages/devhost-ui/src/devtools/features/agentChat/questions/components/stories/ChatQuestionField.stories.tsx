import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatQuestionField } from "../ChatQuestionField";
import { ChatRequestsFixture } from "../../../components/stories/helpers";
import { fixture_codexQuestion, fixture_claudeQuestion } from "./fixtures";
const meta: Meta<typeof ChatQuestionField> = {
  component: ChatQuestionField,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/questions/components/ChatQuestionField",
  render: () => <ChatRequestsFixture target="field" request={fixture_codexQuestion} />,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const SingleChoiceKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: /Native/ }));
    await userEvent.keyboard("{ArrowDown}");
    await expect(canvas.getByRole("radio", { name: "Other answer" })).toBeChecked();
    await userEvent.type(canvas.getByRole("textbox", { name: "Other answer" }), "Different library");
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent("Different library");
  },
};
export const MultipleChoice: Story = {
  render: () => <ChatRequestsFixture target="field" request={fixture_claudeQuestion} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: /Search/ }));
    await userEvent.click(canvas.getByRole("checkbox", { name: /History/ }));
    await userEvent.click(canvas.getByRole("checkbox", { name: /Search/ }));
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('["History"]');
  },
};

export const OtherCanMatchOptionLabel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Other answer" }));
    const input = canvas.getByRole("textbox", { name: "Other answer" });
    await userEvent.type(input, "Native");
    await expect(input).toHaveValue("Native");
    await expect(canvas.getByLabelText("Native response")).toHaveTextContent('["Native"]');
  },
};
