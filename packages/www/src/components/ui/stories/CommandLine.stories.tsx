import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { CommandLine } from "../CommandLine";

const meta: Meta<typeof CommandLine> = {
  title: "devhost-test-app/components/ui/CommandLine",
  component: CommandLine,
};

export default meta;

type Story = StoryObj<typeof meta>;

export const SingleLine: Story = {
  args: {
    command: "bun devhost caddy start",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("CommandLine")).toBeInTheDocument();
    await expect(canvas.getByText("bun devhost caddy start")).toBeInTheDocument();
  },
};

export const MultiLine: Story = {
  args: {
    command: `$ npm run dev\n$ open https://foo.localhost`,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("CommandLine")).toBeInTheDocument();

    const codeElements = canvas.getAllByText((content, element) => {
      if (!element) return false;
      return (
        element.tagName.toLowerCase() === "code" &&
        content.includes("npm run dev") &&
        content.includes("open https://foo.localhost")
      );
    });

    await expect(codeElements.length).toBeGreaterThan(0);
  },
};
