import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "storybook/test";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { AnnotationSelectionHint } from "../AnnotationSelectionHint";

const meta: Meta<typeof AnnotationSelectionHint> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/annotationComposer/components/AnnotationSelectionHint",
  component: AnnotationSelectionHint,
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <AnnotationSelectionHint {...args} />
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Visible: Story = {
  args: {
    isVisible: true,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const hint = await shadowCanvas.findByRole("status", { name: "Annotation selection" });

    await waitFor(() => expect(hint).toBeVisible());
    await expect(hint).toHaveTextContent("Annotateclick to mark elementsEsc");
  },
};

export const Hidden: Story = {
  args: {
    isVisible: false,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.queryByRole("status", { name: "Annotation selection" })).toBeNull();
  },
};
