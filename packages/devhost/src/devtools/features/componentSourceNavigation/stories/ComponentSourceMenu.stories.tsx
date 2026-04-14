import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { ComponentSourceMenu } from "../ComponentSourceMenu";

const meta: Meta<typeof ComponentSourceMenu> = {
  title: "@alexgorbatchev/devhost/devtools/features/componentSourceNavigation/ComponentSourceMenu",
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

export const Default: Story = {
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
    const itemButton = canvas.getByTestId("ComponentSourceMenu--item");
    await expect(itemButton).toBeInTheDocument();
    await userEvent.click(itemButton);
    await expect(args.onItemClick).toHaveBeenCalledWith(0);
  },
};

export const MultipleItems: Story = {
  args: {
    errorMessage: undefined,
    items: [
      {
        action: {
          kind: "external-editor",
          sourceUrl: "vscode://file/storybook/src/Button.tsx:10:5",
        },
        displayName: "Button",
        key: "Button:1",
        props: [{ name: "variant", title: "variant=primary" }],
        source: {
          columnNumber: 5,
          fileName: "storybook/src/Button.tsx",
          lineNumber: 10,
        },
        sourceLabel: "Button.tsx:10:5",
      },
      {
        action: {
          kind: "external-editor",
          sourceUrl: "vscode://file/storybook/src/App.tsx:20:2",
        },
        displayName: "App",
        key: "App:1",
        props: [],
        source: {
          columnNumber: 2,
          fileName: "storybook/src/App.tsx",
          lineNumber: 20,
        },
        sourceLabel: "App.tsx:20:2",
      },
    ],
    onItemClick: fn(),
    position: { x: 20, y: 20 },
    title: "Select Component to Open",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const items = canvas.getAllByTestId("ComponentSourceMenu--item");
    await expect(items.length).toBe(2);

    await expect(canvas.getByText("<Button>")).toBeInTheDocument();
    await expect(canvas.getByText("<App>")).toBeInTheDocument();

    await userEvent.click(items[1]);
    await expect(args.onItemClick).toHaveBeenCalledWith(1);
  },
};

export const WithErrorMessage: Story = {
  args: {
    errorMessage: "Failed to resolve source file path.",
    items: [
      {
        action: {
          kind: "external-editor",
          sourceUrl: "vscode://file/unknown:0:0",
        },
        displayName: "UnknownComponent",
        key: "Unknown:1",
        props: [],
        source: {
          columnNumber: 0,
          fileName: "unknown",
          lineNumber: 0,
        },
        sourceLabel: "unknown:0:0",
      },
    ],
    onItemClick: fn(),
    position: { x: 20, y: 20 },
    title: "Open in VS Code",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ComponentSourceMenu")).toBeInTheDocument();
    await expect(canvas.getByRole("alert")).toHaveTextContent("Failed to resolve source file path.");
  },
};

export const Empty: Story = {
  args: {
    errorMessage: undefined,
    items: [],
    onItemClick: fn(),
    position: { x: 20, y: 20 },
    title: "Open in VS Code",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("ComponentSourceMenu")).not.toBeInTheDocument();
  },
};
