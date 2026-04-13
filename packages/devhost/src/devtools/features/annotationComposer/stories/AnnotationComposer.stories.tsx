import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { AnnotationComposer } from "../AnnotationComposer";

const meta: Meta<typeof AnnotationComposer> = {
  title: "@alexgorbatchev/devhost/devtools/features/annotationComposer/AnnotationComposer",
  component: AnnotationComposer,
  render: (args) => {
    return (
      <div>
        <button type="button">Host action</button>
        <div data-devhost-devtools="">
          <ThemeProvider colorScheme="dark">
            <AnnotationComposer {...args} />
          </ThemeProvider>
        </div>
      </div>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    agentDisplayName: "Pi",
    onSubmit: async () => {
      return { success: true };
    },
    stackName: "story-stack",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("button", { name: "Host action" })).toBeInTheDocument();
    await expect(canvas.getByTestId("AnnotationComposer")).toBeInTheDocument();
  },
};

export { Default as AnnotationComposer };
