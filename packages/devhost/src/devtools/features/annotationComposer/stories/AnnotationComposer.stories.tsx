import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { AnnotationComposer } from "../AnnotationComposer";

const meta: Meta<typeof AnnotationComposer> = {
  title: "@alexgorbatchev/devhost/devtools/features/annotationComposer/AnnotationComposer",
  component: AnnotationComposer,
  render: (args) => {
    return (
      <StoryContainer align="center">
        <button type="button" data-testid="host-action-target" style={{ padding: "20px", background: "red" }}>
          Host action target
        </button>
        <div data-devhost-devtools="">
          <ThemeProvider colorScheme="dark">
            <AnnotationComposer {...args} />
          </ThemeProvider>
        </div>
      </StoryContainer>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    agentDisplayName: "Pi",
    onSubmit: fn(async () => {
      return { success: true };
    }),
    stackName: "story-stack",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    const targetButton = canvas.getByTestId("host-action-target");
    await expect(targetButton).toBeInTheDocument();
    
    // Press Alt to enter selection mode
    await userEvent.keyboard("{Alt>}");
    
    // Click the target button to select it
    await userEvent.click(targetButton);
    
    // Release Alt
    await userEvent.keyboard("{/Alt}");
    
    // Type a comment
    const commentBox = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentBox, "Make it blue");
    
    // Submit the annotation
    const submitBtn = await canvas.findByRole("button", { name: "Submit" });
    await userEvent.click(submitBtn);
    
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};

export const WithActiveSession: Story = {
  args: {
    activeAgentSessionId: "session-123",
    agentDisplayName: "Pi",
    onSubmit: fn(async () => {
      return { success: true };
    }),
    stackName: "story-stack",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const targetButton = canvas.getByTestId("host-action-target");
    await expect(targetButton).toBeInTheDocument();

    // Press Alt to enter selection mode
    await userEvent.keyboard("{Alt>}");
    
    // Click the target button to select it
    await userEvent.click(targetButton);
    
    // Release Alt
    await userEvent.keyboard("{/Alt}");
    
    // Type a comment
    const commentBox = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentBox, "Make it bigger");
    
    // Check that the checkbox for active session appears
    const checkbox = await canvas.findByRole("checkbox", { name: "Append to active session queue" });
    await expect(checkbox).toBeInTheDocument();
    
    // Submit the annotation
    const submitBtn = await canvas.findByRole("button", { name: "Submit" });
    await userEvent.click(submitBtn);
    
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};