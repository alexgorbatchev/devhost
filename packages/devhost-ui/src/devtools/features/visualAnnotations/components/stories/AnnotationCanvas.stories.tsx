import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, waitFor, within } from "storybook/test";
import { userEvent } from "vitest/browser";

import { AnnotationCanvas } from "../AnnotationCanvas";

const meta: Meta<typeof AnnotationCanvas> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/visualAnnotations/components/AnnotationCanvas",
  component: AnnotationCanvas,
  args: { shapes: [], tool: "arrow", onDraw: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const DrawArrow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 100, y: 120 },
      targetPosition: { x: 240, y: 200 },
    });
    await expect(args.onDraw).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "arrow",
        start: { x: 100, y: 120 },
        end: { x: 240, y: 200 },
      }),
    );
  },
};

export const DrawBoxBackwards: Story = {
  args: { tool: "box" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 240, y: 200 },
      targetPosition: { x: 100, y: 120 },
    });
    await expect(args.onDraw).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "box",
        start: { x: 100, y: 120 },
        end: { x: 240, y: 200 },
      }),
    );
  },
};

export const DrawLine: Story = {
  args: { tool: "line" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 100, y: 120 },
      targetPosition: { x: 240, y: 120 },
    });
    await expect(args.onDraw).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "line",
        start: { x: 100, y: 120 },
        end: { x: 240, y: 120 },
      }),
    );
  },
};

export const PageRemainsInteractive: Story = {
  args: { tool: null, shapes: [{ id: "box", kind: "box", start: { x: 20, y: 20 }, end: { x: 300, y: 220 } }] },
  render: (args) => (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.textContent = "Page clicked";
        }}
      >
        Page action
      </button>
      <AnnotationCanvas {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Page action" }));
    await expect(canvas.getByRole("button", { name: "Page clicked" })).toBeVisible();
    await expect(canvas.getByRole("img", { name: "box annotation" })).toBeVisible();
  },
};

export const ScrollablePage: Story = {
  args: {
    tool: null,
    shapes: [{ id: "box", kind: "box", start: { x: 100, y: 400 }, end: { x: 300, y: 500 } }],
  },
  render: (args) => (
    <>
      <div className="h-[200vh]">Scrollable page</div>
      <AnnotationCanvas {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const originalGutter = document.documentElement.style.scrollbarGutter;
    try {
      document.documentElement.style.scrollbarGutter = "stable";
      window.scrollTo(0, 200);
      await waitFor(() => {
        const bounds = canvas.getByRole("img", { name: "box annotation" }).getBoundingClientRect();
        expect(window.scrollY).toBe(200);
        expect(bounds.x).toBeCloseTo(100);
        expect(bounds.y).toBeCloseTo(200);
        expect(bounds.width).toBeCloseTo(200);
        expect(bounds.height).toBeCloseTo(100);
      });
    } finally {
      document.documentElement.style.scrollbarGutter = originalGutter;
      window.scrollTo(0, 0);
    }
  },
};
