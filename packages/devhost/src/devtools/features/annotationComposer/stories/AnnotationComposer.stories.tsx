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

async function triggerAnnotationSelection(targetElement: HTMLElement): Promise<void> {
  const originalElementsFromPoint = document.elementsFromPoint.bind(document);
  document.elementsFromPoint = (x, y) => [targetElement, ...originalElementsFromPoint(x, y)];

  const originalGetBoundingClientRect = targetElement.getBoundingClientRect.bind(targetElement);
  targetElement.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0, toJSON: () => {} }) as DOMRect;

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true, composed: true }));

  await new Promise((resolve) => setTimeout(resolve, 50));

  document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
  document.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
  document.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true, composed: true }));

  document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true, composed: true }));

  targetElement.getBoundingClientRect = originalGetBoundingClientRect;
  document.elementsFromPoint = originalElementsFromPoint;
}

export const Default: Story = {
  args: {
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
  },
};
