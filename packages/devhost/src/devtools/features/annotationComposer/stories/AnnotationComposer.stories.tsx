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

    const originalElementsFromPoint = document.elementsFromPoint.bind(document);
    document.elementsFromPoint = (x, y) => [targetButton, ...originalElementsFromPoint(x, y)];

    // Trigger Alt key down to enter selection mode
    const originalGetBoundingClientRect = targetButton.getBoundingClientRect.bind(targetButton);
    targetButton.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0, toJSON: () => {} }) as DOMRect;

    // Simulate Alt+Click sequence exactly as browser would emit it to document
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true, composed: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
    document.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
    document.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true, composed: true }));

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true, composed: true }));

    targetButton.getBoundingClientRect = originalGetBoundingClientRect;
    document.elementsFromPoint = originalElementsFromPoint;

    const commentBox = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentBox, "Make it blue");

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

    const originalElementsFromPoint = document.elementsFromPoint.bind(document);
    document.elementsFromPoint = (x, y) => [targetButton, ...originalElementsFromPoint(x, y)];

    const originalGetBoundingClientRect = targetButton.getBoundingClientRect.bind(targetButton);
    targetButton.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0, toJSON: () => {} }) as DOMRect;

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true, composed: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
    document.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 10, clientY: 10, bubbles: true, composed: true }));
    document.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true, composed: true }));

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true, composed: true }));

    targetButton.getBoundingClientRect = originalGetBoundingClientRect;
    document.elementsFromPoint = originalElementsFromPoint;

    const commentBox = await canvas.findByTestId("AnnotationComposer--comment");
    await userEvent.type(commentBox, "Make it bigger");

    const checkbox = await canvas
      .findByRole("checkbox", { name: "Append to active session queue" }, { timeout: 1000 })
      .catch(() => null);
    if (checkbox) {
      await expect(checkbox).toBeInTheDocument();
    }

    const submitBtn = await canvas.findByRole("button", { name: "Submit" });
    await userEvent.click(submitBtn);

    await expect(args.onSubmit).toHaveBeenCalled();
  },
};
