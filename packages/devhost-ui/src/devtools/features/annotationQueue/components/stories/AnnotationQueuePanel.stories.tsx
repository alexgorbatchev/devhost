import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { AnnotationQueuePanel } from "../AnnotationQueuePanel";
import type { IAnnotationQueueSnapshot } from "../../types";

const sampleQueues: IAnnotationQueueSnapshot[] = [
  {
    activeSessionId: "session-1",
    entries: [
      {
        actionId: "agent",
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
          title: "@alexgorbatchev/devhost-ui/devtools/features/annotationQueue/components/AnnotationQueuePanel",
          url: "https://example.test/products",
        },
        createdAt: 1_743_362_700_000,
        entryId: "entry-active",
        state: "active",
        updatedAt: 1_743_362_700_000,
      },
      {
        actionId: "agent",
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
        actionId: "agent",
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
  title: "@alexgorbatchev/devhost-ui/devtools/features/annotationQueue/components/AnnotationQueuePanel",
  component: AnnotationQueuePanel,
  args: {
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: fn(async () => true),
    onResumeQueue: fn(async () => "session-2"),
    onSaveEntry: fn(async () => true),
    queues: sampleQueues,
  },
  // Rendered in the light DOM: `userEvent.type` from storybook/test does not deliver keystrokes into inputs inside a
  // shadow root, and these stories edit annotation comments. The preview loads the same devtools stylesheet.
  render: (args, context) => (
    <StorybookThemeProvider globals={context.globals}>
      <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
        <AnnotationQueuePanel {...args} />
      </DevtoolsToolbar>
    </StorybookThemeProvider>
  ),
};

export default meta;

type Story = StoryObj<typeof meta>;

type StoryCanvas = ReturnType<typeof within>;

async function openQueuesPanel(canvasElement: HTMLElement, triggerName: string): Promise<StoryCanvas> {
  const canvas = within(canvasElement);

  await userEvent.click(await canvas.findByRole("button", { name: triggerName }));
  await waitFor(() => expect(canvas.getByRole("region", { name: "Annotation queues" })).toBeVisible());

  return canvas;
}

export const Default: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 3 annotations, 1 paused");
    const queues = canvas.getAllByTestId("AnnotationQueuePanel--queue");

    await expect(queues).toHaveLength(2);
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue-progress")).toHaveLength(2);
    await expect(canvas.getByText("example.test/products")).toBeVisible();

    const firstQueueScope = within(queues[0]!);

    await expect(firstQueueScope.getByText("1/2")).toBeVisible();
    await userEvent.click(firstQueueScope.getByRole("button", { name: "Show annotations" }));
    await expect(firstQueueScope.getByRole("button", { name: "Hide annotations" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(firstQueueScope.getAllByTestId("AnnotationQueuePanel--entry")).toHaveLength(2);

    const queuedEntryScope = within(firstQueueScope.getAllByTestId("AnnotationQueuePanel--entry")[1]!);

    await expect(queuedEntryScope.getByTestId("AnnotationQueuePanel--comment")).toHaveTextContent(
      "Then tighten the spacing around #1.",
    );
    await userEvent.click(queuedEntryScope.getByRole("button", { name: "Edit annotation" }));

    const commentInput = queuedEntryScope.getByTestId("AnnotationQueuePanel--comment-input");
    const saveButton = queuedEntryScope.getByRole("button", { name: "Save" });

    await expect(saveButton).toBeDisabled();
    await userEvent.type(commentInput, " edited");
    await expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);
    await expect(args.onSaveEntry).toHaveBeenCalledWith("entry-queued", "Then tighten the spacing around #1. edited");

    await userEvent.click(await queuedEntryScope.findByRole("button", { name: "Delete annotation" }));
    await expect(queuedEntryScope.getByTestId("AnnotationQueuePanel--delete-confirmation")).toHaveTextContent(
      "Delete this annotation?",
    );
    await userEvent.click(queuedEntryScope.getByRole("button", { name: "Delete" }));
    await expect(args.onRemoveEntry).toHaveBeenCalledWith("entry-queued");

    const pausedQueueScope = within(queues[1]!);

    await userEvent.click(pausedQueueScope.getByRole("button", { name: "Show annotations" }));
    await expect(pausedQueueScope.getByTestId("AnnotationQueuePanel--pause-reason")).toHaveTextContent(
      "Session exited before the annotation finished. Resume to retry.",
    );
    await userEvent.click(pausedQueueScope.getByRole("button", { name: "Resume" }));
    await expect(args.onResumeQueue).toHaveBeenCalledWith("queue-paused");
  },
};

export const Collapsed: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 3 annotations, 1 paused");

    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue")).toHaveLength(2);
    await expect(canvas.queryByTestId("AnnotationQueuePanel--entry")).toBeNull();
  },
};

export const DeleteCancelled: Story = {
  args: {
    queues: [workingQueue],
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 2 annotations");

    await userEvent.click(canvas.getByRole("button", { name: "Show annotations" }));

    const queuedEntryScope = within(canvas.getAllByTestId("AnnotationQueuePanel--entry")[1]!);

    await userEvent.click(queuedEntryScope.getByRole("button", { name: "Delete annotation" }));
    await userEvent.click(queuedEntryScope.getByRole("button", { name: "Cancel" }));

    await expect(queuedEntryScope.queryByTestId("AnnotationQueuePanel--delete-confirmation")).toBeNull();
    await expect(args.onRemoveEntry).not.toHaveBeenCalled();
  },
};

export const WithError: Story = {
  args: {
    errorMessage: "Connection lost while syncing queue.",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 3 annotations, 1 paused, error");

    await expect(canvas.getByRole("alert")).toHaveTextContent("Connection lost while syncing queue.");
  },
};

export const Launching: Story = {
  args: {
    queues: [launchingQueue],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 2 annotations");

    await expect(canvas.getByText("launching")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Resume" })).toBeNull();
    await expect(canvas.getByText("1/2")).toBeVisible();
  },
};

export const ResumePending: Story = {
  args: {
    isQueueResumePending: (queueId: string) => queueId === pausedQueue.queueId,
    queues: [pausedQueue],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 1 annotation, 1 paused");

    await expect(canvas.getByRole("button", { name: "Resume" })).toBeDisabled();
  },
};

export const EntryMutationPending: Story = {
  args: {
    isEntryMutationPending: (entryId: string) => entryId === "entry-queued",
    queues: [workingQueue],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await openQueuesPanel(canvasElement, "Annotation queues: 2 annotations");

    await userEvent.click(canvas.getByRole("button", { name: "Show annotations" }));

    const queuedEntryScope = within(canvas.getAllByTestId("AnnotationQueuePanel--entry")[1]!);

    await expect(queuedEntryScope.getByRole("button", { name: "Edit annotation" })).toBeDisabled();
    await expect(queuedEntryScope.getByRole("button", { name: "Delete annotation" })).toBeDisabled();
  },
};

export const Empty: Story = {
  args: {
    queues: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("toolbar", { name: "devhost" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /^Annotation queues/ })).toBeNull();
  },
};
