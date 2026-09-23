import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps, type JSX, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { StoryContainer } from "@/devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { AnnotationComposer } from "../AnnotationComposer";

const agentAction = {
  displayName: "Pi",
  id: "agent",
  kind: "agent" as const,
  queueEnabled: true,
};
const ticketAction = {
  displayName: "Create Ticket",
  id: "create-ticket",
  kind: "command" as const,
  queueEnabled: false,
};

interface IAnnotationComposerStoryFrameProps {
  children: ReactNode;
  globals: Partial<Record<string, unknown>>;
}

function AnnotationComposerStoryFrame({ children, globals }: IAnnotationComposerStoryFrameProps): JSX.Element {
  return (
    <StoryContainer align="center">
      <button type="button" data-testid="host-action-target" style={{ padding: "20px", background: "red" }}>
        Host action target
      </button>
      <div data-devhost-devtools="">
        <StorybookThemeProvider globals={globals}>{children}</StorybookThemeProvider>
      </div>
    </StoryContainer>
  );
}

interface IControlledMultipleActionsAnnotationComposerProps extends ComponentProps<typeof AnnotationComposer> {
  globals: Partial<Record<string, unknown>>;
}

function ControlledMultipleActionsAnnotationComposer({
  globals,
  ...args
}: IControlledMultipleActionsAnnotationComposerProps): JSX.Element {
  const [selectedActionId, setSelectedActionId] = useState<string>(args.selectedActionId);

  return (
    <AnnotationComposerStoryFrame globals={globals}>
      <AnnotationComposer
        {...args}
        selectedActionId={selectedActionId}
        onSelectedActionIdChange={(actionId: string): void => {
          setSelectedActionId(actionId);
          args.onSelectedActionIdChange(actionId);
        }}
      />
    </AnnotationComposerStoryFrame>
  );
}

const meta: Meta<typeof AnnotationComposer> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/annotationComposer/components/AnnotationComposer",
  component: AnnotationComposer,
  render: (args, context) => {
    return (
      <AnnotationComposerStoryFrame globals={context.globals}>
        <AnnotationComposer {...args} />
      </AnnotationComposerStoryFrame>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

interface IAnnotationComposerStoryQueries {
  canvas: ReturnType<typeof within>;
  page: ReturnType<typeof within>;
}

async function createAnnotationDraft({ canvas, page }: IAnnotationComposerStoryQueries): Promise<void> {
  const targetButton = canvas.getByTestId("host-action-target");

  await userEvent.keyboard("{Alt>}");
  await expect(await canvas.findByRole("status", { name: "Annotation selection" })).toHaveTextContent(
    "Annotateclick to mark elementsEsc",
  );
  await userEvent.hover(targetButton);

  await waitFor(() => {
    expect(page.getByTestId("AnnotationComposer--hover-highlight")).toBeInTheDocument();
    // Synthetic hover events carry no pointer coordinates, so only the presence of the label is asserted here.
    expect(page.getByTestId("AnnotationComposer--hover-label")).toBeVisible();
  });

  await userEvent.click(targetButton);

  await waitFor(() => {
    expect(canvas.getByRole("dialog", { name: "Annotation draft" })).toBeVisible();
    expect(page.getAllByTestId("AnnotationComposer--marker")).toHaveLength(1);
    expect(canvas.queryByRole("status", { name: "Annotation selection" })).toBeNull();
  });

  await expect(canvas.getByRole("dialog", { name: "Annotation draft" })).toHaveTextContent("1 marker");
  await userEvent.keyboard("{/Alt}");
}

async function expectDraftToReset({ canvas, page }: IAnnotationComposerStoryQueries): Promise<void> {
  await waitFor(() => {
    expect(canvas.queryByRole("dialog", { name: "Annotation draft" })).toBeNull();
    expect(page.queryAllByTestId("AnnotationComposer--marker")).toHaveLength(0);
  });
}

export const Default: Story = {
  args: {
    annotationActions: [agentAction],
    onSubmit: fn(async () => {
      return { success: true };
    }),
    onSelectedActionIdChange: fn(),
    selectedActionId: "agent",
    stackName: "story-stack",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await createAnnotationDraft({ canvas, page });

    const commentInput = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentInput, "Fix the red button");

    const submitButton = canvas.getByRole("button", { name: /Run Pi/ });
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
        agentAction,
        undefined,
      );
    });

    await expectDraftToReset({ canvas, page });
  },
};

export const WithActiveSession: Story = {
  args: {
    activeAgentSessionId: "session-123",
    annotationActions: [agentAction],
    onSubmit: fn(async () => {
      return { success: true };
    }),
    onSelectedActionIdChange: fn(),
    selectedActionId: "agent",
    stackName: "story-stack",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await createAnnotationDraft({ canvas, page });

    const commentInput = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentInput, "Update this component");

    await expect(canvas.getByLabelText("Append to active Pi queue")).toBeChecked();

    const submitButton = canvas.getByRole("button", { name: /Run Pi/ });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          comment: "Update this component",
          stackName: "story-stack",
        }),
        agentAction,
        "session-123",
      );
    });

    await expectDraftToReset({ canvas, page });
  },
};

export const WithSubmitError: Story = {
  args: {
    annotationActions: [agentAction],
    onSubmit: fn(async () => {
      return {
        errorMessage: "Failed to start the Pi session.",
        success: false,
      };
    }),
    onSelectedActionIdChange: fn(),
    selectedActionId: "agent",
    stackName: "story-stack",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await createAnnotationDraft({ canvas, page });

    await userEvent.type(await canvas.findByTestId("AnnotationComposer--comment"), "Retry the submit flow");
    await userEvent.click(canvas.getByRole("button", { name: /Run Pi/ }));

    await waitFor(() => {
      expect(canvas.getByTestId("AnnotationComposer--error")).toHaveTextContent("Failed to start the Pi session.");
    });

    await userEvent.keyboard("{Escape}");
    await expectDraftToReset({ canvas, page });
  },
};

export const CancelledWithCloseButton: Story = {
  args: {
    annotationActions: [agentAction],
    onSubmit: fn(async () => {
      return { success: true };
    }),
    onSelectedActionIdChange: fn(),
    selectedActionId: "agent",
    stackName: "story-stack",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await createAnnotationDraft({ canvas, page });
    await userEvent.click(canvas.getByRole("button", { name: "Cancel annotation" }));

    await expectDraftToReset({ canvas, page });
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const WithMultipleActions: Story = {
  args: {
    activeAgentSessionId: "session-123",
    annotationActions: [agentAction, ticketAction],
    onSubmit: fn(async () => {
      return { success: true };
    }),
    onSelectedActionIdChange: fn(),
    selectedActionId: "create-ticket",
    stackName: "story-stack",
  },
  render: (args, context) => {
    return <ControlledMultipleActionsAnnotationComposer {...args} globals={context.globals} />;
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await createAnnotationDraft({ canvas, page });

    await expect(canvas.queryByRole("combobox")).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("Append to active Create Ticket queue")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Run Create Ticket/ })).toBeDisabled();

    await userEvent.click(canvas.getByRole("button", { name: /Select annotation action/ }));
    await expect(page.getByRole("menu", { name: /Select annotation action/ })).toBeInTheDocument();

    await userEvent.click(page.getByRole("menuitemradio", { name: "Pi" }));

    await waitFor(() => {
      expect(canvas.getByRole("button", { name: /Run Pi/ })).toBeInTheDocument();
    });

    await expect(canvas.getByLabelText("Append to active Pi queue")).toBeChecked();

    await userEvent.type(await canvas.findByTestId("AnnotationComposer--comment"), "Open a ticket for this state");
    await userEvent.click(canvas.getByRole("button", { name: /Run Pi/ }));

    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ comment: "Open a ticket for this state" }),
        agentAction,
        "session-123",
      );
    });

    await expectDraftToReset({ canvas, page });
  },
};
