import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, within } from "storybook/test";

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
    onSubmit: async () => {
      return { success: true };
    },
    stackName: "story-stack",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    const targetButton = canvas.getByTestId("host-action-target");
    await expect(targetButton).toBeInTheDocument();
    await expect(canvas.getByTestId("AnnotationComposer")).toBeInTheDocument();
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
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const targetButton = canvas.getByTestId("host-action-target");
    await expect(targetButton).toBeInTheDocument();

    // Triggering Alt+Click selection mode is tricky in JSDOM/Storybook, so we just verify the basic render.
    await expect(canvas.getByTestId("AnnotationComposer")).toBeInTheDocument();
  },
};
