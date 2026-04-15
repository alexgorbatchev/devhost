import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Surface } from "../Surface";

const meta: Meta<typeof Surface> = {
  title: "devhost-test-app/components/ui/Surface",
  component: Surface,
  render: (args) => {
    return <Surface {...args} data-testid="Surface" />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    children: "Surface body",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Surface body")).toBeInTheDocument();
    await expect(canvas.getByTestId("Surface").tagName).toBe("DIV");
  },
};

export const SubtleTone: Story = {
  args: {
    children: "Subtle surface",
    tone: "subtle",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Surface")).toHaveClass("bg-surface-subtle");
  },
};

export const NoShadow: Story = {
  args: {
    children: "Flat surface",
    shadow: "none",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const surface = canvas.getByTestId("Surface");

    await expect(surface).not.toHaveClass("shadow-[var(--shadow-soft)]");
    await expect(surface).not.toHaveClass("shadow-[var(--shadow-raised)]");
  },
};

export const RaisedShadow: Story = {
  args: {
    children: "Raised surface",
    shadow: "raised",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Surface")).toHaveClass("shadow-[var(--shadow-raised)]");
  },
};

export const ArticleElement: Story = {
  args: {
    children: "Article surface",
    element: "article",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Surface").tagName).toBe("ARTICLE");
  },
};

export const AsideElement: Story = {
  args: {
    children: "Aside surface",
    element: "aside",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Surface").tagName).toBe("ASIDE");
  },
};

export const SectionElement: Story = {
  args: {
    children: "Section surface",
    element: "section",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("Surface").tagName).toBe("SECTION");
  },
};

export { Default as Surface };
