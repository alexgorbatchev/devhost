import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

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

async function createAnnotationDraft(canvas: ReturnType<typeof within>): Promise<void> {
  const targetButton = canvas.getByTestId("host-action-target");

  await userEvent.keyboard("{Alt>}");
  await userEvent.hover(targetButton);

  await waitFor(() => {
    expect(canvas.getByTestId("AnnotationComposer--hover-highlight")).toBeInTheDocument();
  });

  await userEvent.click(targetButton);

  await waitFor(() => {
    expect(canvas.getByTestId("AnnotationComposer--popup")).toBeInTheDocument();
    expect(canvas.getAllByTestId("AnnotationComposer--marker")).toHaveLength(1);
  });

  await userEvent.keyboard("{/Alt}");
}

async function expectDraftToReset(canvas: ReturnType<typeof within>): Promise<void> {
  await waitFor(() => {
    expect(canvas.queryByTestId("AnnotationComposer--popup")).not.toBeInTheDocument();
    expect(canvas.queryAllByTestId("AnnotationComposer--marker")).toHaveLength(0);
  });
}

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
    await createAnnotationDraft(canvas);

    const commentInput = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentInput, "Fix the red button");

    const submitButton = canvas.getByRole("button", { name: /submit/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          comment: "Fix the red button",
          stackName: "story-stack",
          markers: expect.arrayContaining([
            expect.objectContaining({
              markerNumber: 1,
            }),
          ]),
        }),
        undefined,
      );
    });

    await expectDraftToReset(canvas);
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
    await createAnnotationDraft(canvas);

    const commentInput = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentInput, "Update this component");

    await expect(canvas.getByLabelText("Append to active session queue")).toBeChecked();

    const submitButton = canvas.getByRole("button", { name: /submit/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          comment: "Update this component",
          stackName: "story-stack",
        }),
        "session-123",
      );
    });

    await expectDraftToReset(canvas);
  },
};

export const WithSubmitError: Story = {
  args: {
    agentDisplayName: "Pi",
    onSubmit: fn(async () => {
      return {
        errorMessage: "Failed to start the Pi session.",
        success: false,
      };
    }),
    stackName: "story-stack",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await createAnnotationDraft(canvas);

    await userEvent.type(await canvas.findByTestId("AnnotationComposer--comment"), "Retry the submit flow");
    await userEvent.click(canvas.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(canvas.getByTestId("AnnotationComposer--error")).toHaveTextContent("Failed to start the Pi session.");
    });

    await userEvent.keyboard("{Escape}");
    await expectDraftToReset(canvas);
  },
};
