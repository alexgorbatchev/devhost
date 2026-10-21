import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { userEvent } from "vitest/browser";
import { PageChatScene, ShadowPageChatScene, installPageChatCatalog } from "./helpers";
import {
  devtoolsStoryShadowRootHostTestId,
  readDevtoolsStoryShadowCanvas,
  readShadowRoot,
} from "../../../../shared/components/stories/helpers";
import { PageChat } from "../PageChat";

const meta: Meta<typeof PageChat> = {
  component: PageChat,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/PageChat",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const FloatingToolsAndSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const toolbar = canvas.getByRole("toolbar", { name: "Page Annotation Tools" });
    expect(toolbar.getBoundingClientRect().top).toBeLessThan(24);
    expect(canvas.getByRole("button", { name: "Arrow" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(36);
    expect(canvas.queryByRole("combobox", { name: "Harness" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const dialog = await canvas.findByRole("dialog", { name: "Chat Settings" });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Harness" })).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Chat Settings" })).toHaveFocus());
    await expect(canvas.getByRole("button", { name: "Share Tab" })).toBeVisible();
  },
};

export const RemoveIndividualContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Remove Element 1" }));
    await expect(canvas.queryByRole("region", { name: "Page context" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Box" }));
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 80, y: 120 },
      targetPosition: { x: 220, y: 220 },
    });
    await userEvent.click(canvas.getByRole("button", { name: "Remove Box 1" }));
    await expect(canvas.queryByRole("img", { name: "box annotation" })).toBeNull();
  },
};

export const PageRemainsInteractive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Open chat" }));
    await expect(canvas.getByRole("complementary", { name: "Agent chat" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Move Chat To Left" }));
    await expect(canvas.getByRole("button", { name: "Move Chat To Right" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
    await expect(canvas.queryByRole("complementary", { name: "Agent chat" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 1" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 2" })).toBeVisible();
  },
};

export const SelectionBecomesChatContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(await canvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    await expect(canvas.getByRole("button", { name: "Page counter: 0" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear Page Context" }));
    await expect(canvas.queryByRole("region", { name: "Page context" })).not.toBeInTheDocument();
  },
};

export const DrawAndUndo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Arrow" }));
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 80, y: 120 },
      targetPosition: { x: 220, y: 220 },
    });
    await expect(canvas.getByRole("img", { name: "arrow annotation" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Page context" })).toHaveTextContent("1. arrow");
    await expect(canvas.getByRole("button", { name: "Arrow" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Undo Drawing" }));
    await expect(canvas.queryByRole("img", { name: "arrow annotation" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("region", { name: "Page context" })).not.toBeInTheDocument();
  },
};

export const AnnotateDevhostUI: Story = {
  render: () => <ShadowPageChatScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shadowRoot = readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    );
    const select = await shadowCanvas.findByRole("button", { name: "Select Elements" });
    const settings = shadowCanvas.getByRole("button", { name: "Chat Settings" });
    await userEvent.click(select);
    await userEvent.click(settings);
    await expect(await shadowCanvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    expect(shadowCanvas.queryByRole("dialog", { name: "Chat Settings" })).toBeNull();
    await userEvent.click(select);
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Box" }));
    const surface = shadowCanvas.getByRole("img", { name: "Annotation drawing canvas" });
    const chat = shadowCanvas.getByRole("complementary", { name: "Agent chat" }).getBoundingClientRect();
    const x = chat.left + 30;
    const y = chat.top + 60;
    expect(shadowRoot.elementFromPoint(x, y)).toBe(surface);
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x, y },
      targetPosition: { x: x + 120, y: y + 80 },
    });
    await expect(shadowCanvas.getByRole("img", { name: "box annotation" })).toBeVisible();
    await expect(shadowCanvas.getByRole("button", { name: "Box" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(settings);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Chat Settings" });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};
