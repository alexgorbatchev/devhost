import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "storybook/test";

import { Textarea } from "../Textarea";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../devtools/shared/components/stories/helpers";
import { readContrastRatio } from "../../../../../../test-support/readContrastRatio";

const meta: Meta<typeof Textarea> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Textarea",
  component: Textarea,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div className="bg-card p-2">
          <Textarea {...args} />
        </div>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Dark: Story = {
  globals: { devhostTheme: "dark" },
  args: {
    "aria-label": "Change description",
    placeholder: "Describe the change",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const textarea = shadowCanvas.getByRole("textbox", { name: "Change description" });

    await expect(readContrastRatio(textarea, { pseudoElement: "::placeholder" })).toBeGreaterThanOrEqual(4.5);
    await expect(
      readContrastRatio(textarea, { property: "borderTopColor", useParentBackground: true }),
    ).toBeGreaterThanOrEqual(3);

    await userEvent.type(textarea, "Use shadcn tokens");
    await expect(textarea).toHaveValue("Use shadcn tokens");
  },
};

export const Light: Story = {
  ...Dark,
  globals: { devhostTheme: "light" },
  play: Dark.play,
};

export const EnteredDark: Story = {
  globals: { devhostTheme: "dark" },
  args: { ...Dark.args, defaultValue: "Existing annotation" },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const textarea = shadowCanvas.getByRole("textbox", { name: "Change description" });
    await expect(textarea).toHaveValue("Existing annotation");
    await expect(
      readContrastRatio(textarea, { property: "borderTopColor", useParentBackground: true }),
    ).toBeGreaterThanOrEqual(3);
    await userEvent.type(textarea, " updated");
    await expect(textarea).toHaveValue("Existing annotation updated");
  },
};

export const EnteredLight: Story = {
  ...EnteredDark,
  globals: { devhostTheme: "light" },
  play: EnteredDark.play,
};
