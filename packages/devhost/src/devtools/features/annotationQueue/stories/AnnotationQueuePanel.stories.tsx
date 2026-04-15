import type { Meta, StoryObj } from "@storybook/react";
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

const workingQueue: IAnnotationQueueSnapshot = sampleQueues[0]!;
const pausedQueue: IAnnotationQueueSnapshot = sampleQueues[1]!;
const launchingQueue: IAnnotationQueueSnapshot = {
  ...workingQueue,
  activeSessionId: null,
  queueId: "queue-launching",
  status: "launching",
};

const meta: Meta<typeof AnnotationQueuePanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/annotationQueue/AnnotationQueuePanel",
  component: AnnotationQueuePanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align="right">
          <AnnotationQueuePanel {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: sampleQueues,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const panel = await canvas.findByTestId("AnnotationQueuePanel");

    await userEvent.hover(panel);

    await expect(panel).toBeInTheDocument();
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue")).toHaveLength(2);
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue-progress")).toHaveLength(2);
    await expect(canvas.getByText("example.test/products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("AnnotationQueuePanel--comment-input")).not.toBeInTheDocument();

    const firstQueue = canvas.getAllByTestId("AnnotationQueuePanel--queue")[0]!;
    const firstQueueScope = within(firstQueue);

    await expect(firstQueueScope.getByText("1 of 2")).toBeInTheDocument();
    await userEvent.click(firstQueueScope.getByRole("button", { name: "Show details" }));
    await expect(firstQueueScope.getAllByTestId("AnnotationQueuePanel--entry")).toHaveLength(2);

    const firstEntry = firstQueueScope.getAllByTestId("AnnotationQueuePanel--entry")[1]!;
    const firstEntryScope = within(firstEntry);

    await expect(firstEntryScope.getByTestId("AnnotationQueuePanel--comment")).toHaveTextContent(
      "Then tighten the spacing around #1.",
    );
    await expect(firstEntryScope.queryByRole("button", { name: "Show annotation" })).not.toBeInTheDocument();
    await userEvent.click(firstEntryScope.getByRole("button", { name: "Edit" }));

    const firstInput = firstEntryScope.getByTestId("AnnotationQueuePanel--comment-input");
    const saveButton = firstEntryScope.getByRole("button", { name: "Save" });

    await expect(saveButton).toBeDisabled();

    await userEvent.type(firstInput, " edited");
    await expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);
    await expect(args.onSaveEntry).toHaveBeenCalled();

    await userEvent.click(await firstEntryScope.findByRole("button", { name: "Delete" }));
    await expect(firstEntryScope.getByTestId("AnnotationQueuePanel--delete-confirmation")).toBeInTheDocument();
    await userEvent.click(firstEntryScope.getByRole("button", { name: "Confirm delete" }));
    await expect(args.onRemoveEntry).toHaveBeenCalled();

    const secondQueue = canvas.getAllByTestId("AnnotationQueuePanel--queue")[1]!;
    const secondQueueScope = within(secondQueue);
    const resumeButton = secondQueueScope.getByRole("button", { name: "Resume" });

    await expect(resumeButton).toBeInTheDocument();
    await userEvent.click(secondQueueScope.getByRole("button", { name: "Show details" }));
    await expect(secondQueueScope.getByTestId("AnnotationQueuePanel--pause-reason")).toBeInTheDocument();

    await userEvent.click(resumeButton);
    await expect(args.onResumeQueue).toHaveBeenCalled();
  },
};

export const Collapsed: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: sampleQueues,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AnnotationQueuePanel")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue")).toHaveLength(2);
    await expect(canvas.queryByTestId("AnnotationQueuePanel--entry")).not.toBeInTheDocument();
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
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AnnotationQueuePanel")).toBeInTheDocument();
    await expect(canvas.getByTestId("AnnotationQueuePanel--error")).toHaveTextContent(
      "Connection lost while syncing queue.",
    );
  },
};

export const Launching: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: [launchingQueue],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Launching")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    await expect(canvas.getByText("1 of 2")).toBeInTheDocument();
  },
};

export const ResumePending: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: (queueId: string) => queueId === pausedQueue.queueId,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: [pausedQueue],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const queue = canvas.getByTestId("AnnotationQueuePanel--queue");
    const queueScope = within(queue);
    const resumeButton = queueScope.getByRole("button", { name: "Resume" });

    await expect(resumeButton).toBeDisabled();
    await userEvent.click(queueScope.getByRole("button", { name: "Show details" }));
    await expect(queueScope.getByTestId("AnnotationQueuePanel--pause-reason")).toBeInTheDocument();
  },
};

export const EntryMutationPending: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: (entryId: string) => entryId === "entry-queued",
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: [workingQueue],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const queue = canvas.getByTestId("AnnotationQueuePanel--queue");
    const queueScope = within(queue);

    await userEvent.click(queueScope.getByRole("button", { name: "Show details" }));

    const queuedEntry = queueScope.getAllByTestId("AnnotationQueuePanel--entry")[1]!;
    const queuedEntryScope = within(queuedEntry);

    await expect(queuedEntryScope.getByRole("button", { name: "Edit" })).toBeDisabled();
    await expect(queuedEntryScope.getByRole("button", { name: "Delete" })).toBeDisabled();
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
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    // Component returns null when there are no queues and no error
    await expect(canvas.queryByTestId("AnnotationQueuePanel")).not.toBeInTheDocument();
  },
};
