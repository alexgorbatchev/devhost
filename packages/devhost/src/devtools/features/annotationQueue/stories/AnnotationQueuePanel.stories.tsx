import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
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
  component: AnnotationQueuePanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <AnnotationQueuePanel {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    agentDisplayName: "Pi",
    errorMessage: null,
    isEntryMutationPending: () => false,
    isQueueResumePending: () => false,
    onRemoveEntry: async () => true,
    onResumeQueue: async () => "session-2",
    onSaveEntry: async () => true,
    queues: sampleQueues,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AnnotationQueuePanel")).toBeInTheDocument();
    await expect(canvas.getAllByTestId("AnnotationQueuePanel--queue")).toHaveLength(2);
    await expect(canvas.getByText("Annotation queue")).toBeInTheDocument();
    await expect(
      canvas.getByText("Session exited before the annotation finished. Resume to retry."),
    ).toBeInTheDocument();
  },
};

export { Default as AnnotationQueuePanel };
