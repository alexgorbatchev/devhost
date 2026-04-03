import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { ComponentSourceMenu } from "../ComponentSourceMenu";

const meta: Meta<typeof ComponentSourceMenu> = {
  component: ComponentSourceMenu,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <ComponentSourceMenu {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    errorMessage: undefined,
    items: [
      {
        action: {
          kind: "external-editor",
          sourceUrl: "vscode://file/storybook/src/example.tsx:1:1",
        },
        displayName: "Button",
        key: "Button:1",
        props: [{ name: "label", title: "label=Save" }],
        source: {
          columnNumber: 1,
          fileName: "storybook/src/example.tsx",
          lineNumber: 1,
        },
        sourceLabel: "example.tsx:1:1",
      },
    ],
    onItemClick: fn(),
    position: { x: 20, y: 20 },
    title: "Open in VS Code",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: /button/i }));
    await expect(args.onItemClick).toHaveBeenCalledWith(0);
  },
};

export { Default as ComponentSourceMenu };
