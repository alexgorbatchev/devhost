import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { AnnotationQueuePanel } from "../AnnotationQueuePanel";
import type { IAnnotationQueueSnapshot } from "../types";

const sampleQueues: IAnnotationQueueSnapshot[] = [
  {
    activeSessionId: "session-1",
    entries: [
      {
        annotation: {
          comment: "Replace #1 with the new CTA.",
          markers: [
            {
              accessibility: 'role="button"',
              boundingBox: { height: 24, width: 120, x: 16, y: 40 },
              computedStyles: "color: rgb(17, 24, 39)",
              computedStylesObj: { color: "rgb(17, 24, 39)" },
              cssClasses: "cta-button",
              element: 'button "Save changes"',
              elementPath: ".toolbar > button",
              fullPath: "body > div.toolbar > button",
              isFixed: false,
              markerNumber: 1,
              nearbyElements: 'a "Docs"',
              nearbyText: "Save your work",
              selectedText: "Save changes",
            },
          ],
          stackName: "hello-stack",
          submittedAt: 1_743_362_700_000,
          title: "Example page",
          url: "https://example.test/products",
        },
        createdAt: 1_743_362_700_000,
        entryId: "entry-active",
        state: "active",
        updatedAt: 1_743_362_700_000,
      },
      {
        annotation: {
          comment: "Then tighten the spacing around #1.",
          markers: [],
          stackName: "hello-stack",
          submittedAt: 1_743_362_710_000,
          title: "Example page",
          url: "https://example.test/products",
        },
        createdAt: 1_743_362_710_000,
        entryId: "entry-queued",
        state: "queued",
        updatedAt: 1_743_362_710_000,
      },
    ],
    pauseReason: null,
    queueId: "queue-working",
    status: "working",
  },
  {
    activeSessionId: null,
    entries: [
      {
        annotation: {
          comment: "Retry the header cleanup.",
          markers: [],
          stackName: "hello-stack",
          submittedAt: 1_743_362_720_000,
          title: "Settings page",
          url: "https://example.test/settings",
        },
        createdAt: 1_743_362_720_000,
        entryId: "entry-paused",
        state: "paused-active",
        updatedAt: 1_743_362_720_000,
      },
    ],
    pauseReason: "session-exited-before-finished",
    queueId: "queue-paused",
    status: "paused",
  },
];

const meta: Meta<typeof AnnotationQueuePanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/annotationQueue/AnnotationQueuePanel",
  component: AnnotationQueuePanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align={args.panelSide}>
          <AnnotationQueuePanel {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultLeft: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: sampleQueues,
    panelSide: "left",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AnnotationQueuePanel")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue")).toHaveLength(2);
    await expect(canvas.getAllByText("Annotation queue")[0]).toBeInTheDocument();
    await expect(
      canvas.getByText("Session exited before the annotation finished. Resume to retry."),
    ).toBeInTheDocument();

    // Test text area interaction
    const commentInputs = canvas.getAllByTestId("AnnotationQueuePanel--comment-input");
    await expect(commentInputs.length).toBeGreaterThan(0);
    const firstInput = commentInputs[0];
    
    await userEvent.type(firstInput, " edited");
    
    // Check save and remove buttons for the first editable item
    const saveButtons = canvas.getAllByRole("button", { name: "Save" });
    const removeButtons = canvas.getAllByRole("button", { name: "Remove" });
    
    await expect(saveButtons.length).toBeGreaterThan(0);
    await expect(removeButtons.length).toBeGreaterThan(0);
    
    await userEvent.click(saveButtons[0]);
    await expect(args.onSaveEntry).toHaveBeenCalled();
    
    await userEvent.click(removeButtons[0]);
    await expect(args.onRemoveEntry).toHaveBeenCalled();

    // Check resume button for paused queues
    const resumeButton = canvas.getByRole("button", { name: "Resume" });
    await expect(resumeButton).toBeInTheDocument();
    
    await userEvent.click(resumeButton);
    await expect(args.onResumeQueue).toHaveBeenCalled();
  },
};

export const DefaultRight: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: sampleQueues,
    panelSide: "right",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AnnotationQueuePanel")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue")).toHaveLength(2);
  },
};

export const WithError: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: "Connection lost while syncing queue.",
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: sampleQueues,
    panelSide: "left",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AnnotationQueuePanel")).toBeInTheDocument();
    await expect(canvas.getByTestId("AnnotationQueuePanel--error")).toHaveTextContent(
      "Connection lost while syncing queue.",
    );
  },
};

export const Empty: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: [],
    panelSide: "left",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    // Component returns null when there are no queues and no error
    await expect(canvas.queryByTestId("AnnotationQueuePanel")).not.toBeInTheDocument();
  },
};