import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TerminalSnippet } from "../TerminalSnippet";

const meta: Meta<typeof TerminalSnippet> = {
  component: TerminalSnippet,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    snippets: ["bun devhost caddy start", "bun devhost --manifest ./devhost.toml"],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("TerminalSnippet")).toBeInTheDocument();
    await expect(canvas.getByText("bun devhost caddy start")).toBeInTheDocument();
  },
};

export { Default as TerminalSnippet };
